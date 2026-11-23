use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    sync::{Condvar, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Manager, RunEvent, State, Url, Webview, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

const ORIGIN: &str = "http://127.0.0.1:47739";
const STARTUP: &str = "tauri://localhost/index.html";

struct Service {
    status: String,
    input: Option<ChildStdin>,
    running: bool,
    quitting: bool,
}

struct Desktop {
    service: Mutex<Service>,
    stopped: Condvar,
    data_dir: Option<PathBuf>,
}

fn is_startup(url: &Url) -> bool {
    url.as_str() == STARTUP || url.as_str() == "tauri://localhost/"
}

fn is_workspace(url: &Url) -> bool {
    url.origin().ascii_serialization() == ORIGIN
}

fn open_external(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = Command::new("/usr/bin/open").arg(url.as_str()).spawn();
    }
}

fn start(app: &AppHandle) -> Result<(), String> {
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
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            service.status = format!("Could not start the bundled launcher. {error}");
            return Ok(());
        }
    };
    service.status = "starting".into();
    service.input = child.stdin.take();
    service.running = true;
    let errors = child.stderr.take().unwrap();
    let output = child.stdout.take().unwrap();
    let app = app.clone();
    thread::spawn(move || {
        let errors =
            thread::spawn(move || BufReader::new(errors).lines().map_while(Result::ok).last());
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if line == "PHYNITE_DESKTOP_READY" {
                let state = app.state::<Desktop>();
                let mut service = state.service.lock().unwrap();
                if service.quitting {
                    continue;
                }
                service.status = "ready".into();
                drop(service);
                if let Some(window) = app.get_webview_window("workspace") {
                    let _ = window.navigate(Url::parse(&format!("{ORIGIN}/workspace")).unwrap());
                }
            }
        }
        let result = child.wait();
        let error = errors.join().ok().flatten();
        let state = app.state::<Desktop>();
        let mut service = state.service.lock().unwrap();
        service.input.take();
        service.running = false;
        state.stopped.notify_all();
        if service.quitting {
            drop(service);
            app.exit(0);
            return;
        }
        service.status = error.unwrap_or_else(|| match result {
            Ok(code) => format!("The local launcher stopped ({code})."),
            Err(error) => format!("Could not wait for the local launcher. {error}"),
        });
        drop(service);
        if let Some(window) = app.get_webview_window("workspace") {
            if window.url().is_ok_and(|url| is_workspace(&url)) {
                let _ = window.navigate(Url::parse(STARTUP).unwrap());
            }
        }
    });
    Ok(())
}

fn verify_startup(webview: &Webview) -> Result<(), String> {
    if webview.url().is_ok_and(|url| is_startup(&url)) {
        Ok(())
    } else {
        Err("This command is only available on the startup page.".into())
    }
}

#[tauri::command]
fn startup_status(webview: Webview, state: State<'_, Desktop>) -> Result<String, String> {
    verify_startup(&webview)?;
    Ok(state.service.lock().unwrap().status.clone())
}

#[tauri::command]
fn retry_startup(webview: Webview, app: AppHandle) -> Result<(), String> {
    verify_startup(&webview)?;
    start(&app)
}

fn show_workspace(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("workspace") {
        let _ = window.show();
        let _ = window.set_focus();
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
        .manage(Desktop {
            service: Mutex::new(Service {
                status: "starting".into(),
                input: None,
                running: false,
                quitting: false,
            }),
            stopped: Condvar::new(),
            data_dir,
        })
        .invoke_handler(tauri::generate_handler![startup_status, retry_startup])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let builder =
                WebviewWindowBuilder::new(app, "workspace", WebviewUrl::App("index.html".into()))
                    .title("Phynite Lab")
                    .inner_size(1320.0, 860.0)
                    .min_inner_size(760.0, 540.0)
                    .initialization_script(format!(
                        "if (location.origin === '{ORIGIN}') Object.defineProperty(window, 'phyniteDesktop', {{ value: true }});"
                    ))
                    .on_navigation(move |url| {
                        if is_startup(url) {
                            return true;
                        }
                        if is_workspace(url) {
                            return app_handle.state::<Desktop>().service.lock().unwrap().status == "ready";
                        }
                        open_external(url);
                        false
                    })
                    .on_new_window(|url, _| {
                        open_external(&url);
                        NewWindowResponse::Deny
                    })
                    .on_download(|window, event| {
                        if let DownloadEvent::Requested { destination, .. } = event {
                            let Some(name) = destination.file_name().map(|name| name.to_owned())
                            else {
                                return false;
                            };
                            let Ok(downloads) = window.path().download_dir() else {
                                return false;
                            };
                            let mut path = downloads.join(&name);
                            if path.exists() {
                                let stamp = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis();
                                path =
                                    downloads.join(format!("{stamp}-{}", name.to_string_lossy()));
                            }
                            *destination = path;
                        }
                        true
                    });
            let window = builder.build()?;
            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_window.hide();
                }
            });
            start(app.handle()).map_err(std::io::Error::other)?;
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
                // AppKit's native Quit can reach Exit directly. Close the
                // launcher pipe and give its existing shutdown time to finish.
                let state = app.state::<Desktop>();
                let mut service = state.service.lock().unwrap();
                service.quitting = true;
                service.input.take();
                drop(
                    state
                        .stopped
                        .wait_timeout_while(service, Duration::from_secs(20), |service| service.running)
                        .unwrap(),
                );
            }
            RunEvent::Reopen { .. } => show_workspace(app),
            _ => {}
        });
}
