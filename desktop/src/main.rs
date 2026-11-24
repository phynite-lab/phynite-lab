mod cloud_mark;
mod native_controls;
mod startup;

use std::{
    cell::OnceCell,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    sync::{Condvar, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use startup::StartupView;
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder},
    window::WindowBuilder,
    AppHandle, LogicalPosition, Manager, RunEvent, Url, WebviewUrl, WindowEvent,
};

const ORIGIN: &str = "http://127.0.0.1:47739";
const WINDOW: &str = "workspace";
const WEBVIEW: &str = "workspace-view";

thread_local! {
    static STARTUP: OnceCell<StartupView> = const { OnceCell::new() };
}

#[derive(Default)]
struct Service {
    input: Option<ChildStdin>,
    running: bool,
    ready: bool,
    presenting: bool,
    quitting: bool,
}

struct Desktop {
    service: Mutex<Service>,
    stopped: Condvar,
    data_dir: Option<PathBuf>,
}

fn with_startup(action: impl FnOnce(&StartupView)) {
    STARTUP.with(|startup| {
        if let Some(view) = startup.get() {
            action(view);
        }
    });
}

fn is_workspace(url: &Url) -> bool {
    url.origin().ascii_serialization() == ORIGIN
}

fn open_external(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = Command::new("/usr/bin/open").arg(url.as_str()).spawn();
    }
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(webview) = app.get_webview(WEBVIEW) {
        let _ = webview.hide();
    }
    with_startup(|view| view.error(message));
}

fn start(app: &AppHandle) {
    with_startup(StartupView::loading);
    if let Err(error) = spawn_launcher(app) {
        show_error(app, &error);
    }
}

fn spawn_launcher(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<Desktop>();
    let mut service = state.service.lock().unwrap();
    if service.running || service.quitting {
        return Ok(());
    }
    let payload = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("payload");
    let mut command = Command::new(payload.join("node"));
    command
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .arg(payload.join("launcher.mjs"))
        .args(["--port", "47739"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = &state.data_dir {
        command.arg("--data-dir").arg(path);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the bundled launcher. {error}"))?;
    service.input = child.stdin.take();
    service.running = true;
    let errors = child.stderr.take().unwrap();
    let output = child.stdout.take().unwrap();
    let app = app.clone();
    thread::spawn(move || {
        let errors =
            thread::spawn(move || BufReader::new(errors).lines().map_while(Result::ok).last());
        let mut display_error = None;
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if line != "PHYNITE_DESKTOP_READY" {
                continue;
            }
            let state = app.state::<Desktop>();
            {
                let mut service = state.service.lock().unwrap();
                if service.quitting || service.ready {
                    continue;
                }
                service.ready = true;
                service.presenting = true;
            }
            let main = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(error) = open_workspace(&main) {
                    let state = main.state::<Desktop>();
                    let mut service = state.service.lock().unwrap();
                    service.ready = false;
                    service.presenting = false;
                    service.input.take();
                    drop(service);
                    show_error(&main, &format!("Could not open the workspace. {error}"));
                }
            });
        }
        let result = child.wait();
        let error = errors.join().ok().flatten();
        let state = app.state::<Desktop>();
        {
            let mut service = state.service.lock().unwrap();
            service.input.take();
            service.running = false;
            service.presenting = false;
            state.stopped.notify_all();
            if service.quitting {
                drop(service);
                app.exit(0);
                return;
            }
            if service.ready
                || error.is_some()
                || result.as_ref().is_err()
                || !matches!(result, Ok(code) if code.success())
            {
                display_error = Some(error.unwrap_or_else(|| match result {
                    Ok(code) => format!("The local launcher stopped ({code})."),
                    Err(error) => format!("Could not wait for the local launcher. {error}"),
                }));
            }
            service.ready = false;
        }
        if let Some(message) = display_error {
            let main = app.clone();
            let _ = app.run_on_main_thread(move || show_error(&main, &message));
        }
    });
    Ok(())
}

fn open_workspace(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<Desktop>();
    {
        let service = state.service.lock().unwrap();
        if !service.ready || service.quitting {
            return Ok(());
        }
    }
    let url = Url::parse(&format!("{ORIGIN}/workspace")).unwrap();
    if let Some(webview) = app.get_webview(WEBVIEW) {
        return webview.navigate(url);
    }
    let window = app.get_window(WINDOW).expect("workspace window");
    let main = app.clone();
    let builder = WebviewBuilder::new(WEBVIEW, WebviewUrl::External(url))
        .auto_resize()
        .initialization_script(native_controls::bootstrap_script())
        .on_navigation(move |url| {
            if is_workspace(url) {
                return main.state::<Desktop>().service.lock().unwrap().ready;
            }
            open_external(url);
            false
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished && is_workspace(payload.url()) {
                let app = webview.app_handle().clone();
                let _ = webview.run_on_main_thread(move || present_workspace(&app));
            }
        })
        .on_new_window(|url, _| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        .on_download(|webview, event| {
            if let DownloadEvent::Requested { destination, .. } = event {
                let Some(name) = destination.file_name().map(|name| name.to_owned()) else {
                    return false;
                };
                let Ok(downloads) = webview.path().download_dir() else {
                    return false;
                };
                let mut path = downloads.join(&name);
                if path.exists() {
                    let stamp = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis();
                    path = downloads.join(format!("{stamp}-{}", name.to_string_lossy()));
                }
                *destination = path;
            }
            true
        });
    let size = window.inner_size()?;
    let webview = window.add_child(builder, LogicalPosition::new(0.0, 0.0), size)?;
    webview.hide()
}

fn present_workspace(app: &AppHandle) {
    let Some(webview) = app.get_webview(WEBVIEW) else {
        return;
    };
    let state = app.state::<Desktop>();
    {
        let mut service = state.service.lock().unwrap();
        if !service.ready || !service.presenting || service.quitting {
            return;
        }
        service.presenting = false;
    }
    with_startup(StartupView::hide);
    let _ = webview.show();
    if app
        .get_window(WINDOW)
        .is_some_and(|window| window.is_visible().unwrap_or(false))
    {
        let _ = webview.set_focus();
    }
}

fn main() {
    let mut args = std::env::args_os().skip(1);
    let data_dir = args
        .next()
        .filter(|arg| arg == "--data-dir")
        .and_then(|_| args.next())
        .map(PathBuf::from);
    tauri::Builder::default()
        .menu(native_controls::menu)
        .on_menu_event(|app, event| {
            if event.id() == native_controls::SETTINGS_MENU {
                let _ = native_controls::show_settings(app);
            }
        })
        .invoke_handler(tauri::generate_handler![native_controls::update_theme])
        .manage(Desktop {
            service: Mutex::new(Service::default()),
            stopped: Condvar::new(),
            data_dir,
        })
        .setup(|app| {
            let window = WindowBuilder::new(app, WINDOW)
                .title("Phynite Lab")
                .theme(native_controls::startup_theme())
                .inner_size(1320.0, 860.0)
                .min_inner_size(760.0, 540.0)
                .visible(false)
                .build()?;
            let main = app.handle().clone();
            let startup = StartupView::new(&window, move || start(&main))?;
            STARTUP.with(|slot| assert!(slot.set(startup).is_ok()));

            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_window.hide();
                }
            });
            window.show()?;
            if let Err(error) = spawn_launcher(app.handle()) {
                show_error(app.handle(), &error);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not initialize Phynite Lab")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                let state = app.state::<Desktop>();
                let mut service = state.service.lock().unwrap();
                if service.running {
                    api.prevent_exit();
                    service.quitting = true;
                    service.input.take();
                }
            }
            RunEvent::Exit => {
                // AppKit's native Quit can reach Exit directly.
                let state = app.state::<Desktop>();
                let mut service = state.service.lock().unwrap();
                service.quitting = true;
                service.input.take();
                drop(
                    state
                        .stopped
                        .wait_timeout_while(service, Duration::from_secs(20), |service| {
                            service.running
                        })
                        .unwrap(),
                );
            }
            RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_window(WINDOW) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}
