use std::cell::{Cell, OnceCell};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem},
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Url, Webview, Window,
};

use crate::{
    is_workspace,
    project_tabs::{ProjectTabs, Tab, TabAction, HEIGHT as TAB_HEIGHT},
    Desktop, ORIGIN, WEBVIEW, WINDOW,
};

pub const SETTINGS_MENU: &str = "phynite-settings";

thread_local! {
    static TABS: OnceCell<ProjectTabs> = const { OnceCell::new() };
    static TABS_VISIBLE: Cell<bool> = const { Cell::new(false) };
}

pub fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(application)) = menu.items()?.into_iter().next() {
        let settings = MenuItem::with_id(app, SETTINGS_MENU, "Settings...", true, Some("Cmd+,"))?;
        application.insert(&settings, 2)?;
        application.insert(&PredefinedMenuItem::separator(app)?, 3)?;
    }
    Ok(menu)
}

pub fn attach(window: &Window) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    let tabs = ProjectTabs::new(window, move |action| {
        let detail = match action {
            TabAction::Select(id) => json!({ "action": "select", "id": id }),
            TabAction::Close(id) => json!({ "action": "close", "id": id }),
            TabAction::New => json!({ "action": "new" }),
        };
        let _ = send(&app, "phynite:native-project-tab", detail);
    })?;
    TABS.with(|value| assert!(value.set(tabs).is_ok()));
    Ok(())
}

pub fn bootstrap_script() -> String {
    format!(
        r#"if (location.origin === '{ORIGIN}' && window === window.top) {{
            Object.defineProperty(window, 'phyniteDesktop', {{ value: true }});
            const invoke = (name, args) => window.__TAURI_INTERNALS__.invoke(name, args);
            Object.defineProperty(window, 'phyniteNative', {{ value: Object.freeze({{
                updateProjectTabs: (tabs, active) => invoke('update_project_tabs', {{ tabs, active }}),
                updateTheme: (theme) => invoke('update_theme', {{ theme }})
            }}) }});
        }}"#
    )
}

pub fn layout(window: &Window) -> tauri::Result<()> {
    if let Some(webview) = window.app_handle().get_webview(WEBVIEW) {
        let size = window
            .inner_size()?
            .to_logical::<f64>(window.scale_factor()?);
        let top = TABS_VISIBLE.with(|visible| if visible.get() { TAB_HEIGHT } else { 0.0 });
        webview.set_bounds(Rect {
            position: Position::Logical(LogicalPosition::new(0.0, top)),
            size: Size::Logical(LogicalSize::new(size.width, (size.height - top).max(0.0))),
        })?;
    }
    Ok(())
}

pub fn reset_tabs(app: &AppHandle) {
    if let Some(window) = app.get_window(WINDOW) {
        TABS_VISIBLE.with(|visible| visible.set(false));
        TABS.with(|tabs| {
            if let Some(tabs) = tabs.get() {
                tabs.set_visible(false);
                tabs.update(&[], "");
            }
        });
        let _ = layout(&window);
    }
}

fn send(app: &AppHandle, event: &'static str, detail: Value) -> tauri::Result<()> {
    if let Some(webview) = app.get_webview(WEBVIEW) {
        webview.eval(format!(
            "window.dispatchEvent(new CustomEvent('{event}', {{ detail: {detail} }}));"
        ))?;
    }
    Ok(())
}

pub fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    let Some(webview) = app.get_webview(WEBVIEW) else {
        return Ok(());
    };
    let Ok(url) = verified_url(&webview) else {
        return Ok(());
    };
    if let Some(workspace) = app.get_window(WINDOW) {
        workspace.show()?;
        workspace.set_focus()?;
    }
    if url.path() != "/account/appearance" {
        webview.eval(
            "if (window.phyniteDesktop && window.dispatchEvent(new Event('phynite:native-settings', { cancelable: true }))) window.location.assign('/account/appearance');",
        )?;
    }
    Ok(())
}

fn verified_url(webview: &Webview) -> Result<Url, String> {
    let ready = webview
        .app_handle()
        .state::<Desktop>()
        .service
        .lock()
        .unwrap()
        .ready;
    let url = webview.url().map_err(|error| error.to_string())?;
    if !ready || webview.label() != WEBVIEW || !is_workspace(&url) {
        return Err("Native controls require the local workspace.".into());
    }
    Ok(url)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TabUpdate {
    id: String,
    label: String,
    closable: bool,
}

#[tauri::command]
pub fn update_project_tabs(
    webview: Webview,
    tabs: Vec<TabUpdate>,
    active: String,
) -> Result<(), String> {
    let url = verified_url(&webview)?;
    if tabs.len() > 128
        || active.len() > 256
        || (!tabs.is_empty() && !url.path().starts_with("/projects/"))
        || tabs
            .iter()
            .any(|tab| tab.id.is_empty() || tab.id.len() > 256 || tab.label.chars().count() > 512)
    {
        return Err("Invalid project tabs.".into());
    }
    let tabs: Vec<_> = tabs
        .into_iter()
        .map(|tab| Tab {
            id: tab.id,
            label: tab.label,
            closable: tab.closable,
        })
        .collect();
    let app = webview.app_handle().clone();
    webview
        .run_on_main_thread(move || {
            if app
                .get_webview(WEBVIEW)
                .and_then(|view| view.url().ok())
                .is_none_or(|current| current.path() != url.path())
            {
                return;
            }
            let visible = !tabs.is_empty();
            TABS_VISIBLE.with(|shown| shown.set(visible));
            TABS.with(|view| {
                if let Some(view) = view.get() {
                    view.update(&tabs, &active);
                    view.set_visible(visible);
                }
            });
            if let Some(window) = app.get_window(WINDOW) {
                let _ = layout(&window);
            }
        })
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[tauri::command]
pub fn update_theme(webview: Webview, theme: Theme) -> Result<(), String> {
    verified_url(&webview)?;
    let app = webview.app_handle().clone();
    let theme = match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    };
    if let Some(window) = app.get_window(WINDOW) {
        window.set_theme(theme).map_err(|error| error.to_string())?;
    }
    Ok(())
}
