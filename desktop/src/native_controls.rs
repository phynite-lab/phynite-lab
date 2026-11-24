use objc2_foundation::{ns_string, NSString, NSUserDefaults};
use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem},
    AppHandle, Manager, Url, Webview,
};

use crate::{is_workspace, Desktop, ORIGIN, WEBVIEW, WINDOW};

pub const SETTINGS_MENU: &str = "phynite-settings";

pub fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(application)) = menu.items()?.into_iter().next() {
        let settings = MenuItem::with_id(app, SETTINGS_MENU, "Settings...", true, Some("Cmd+,"))?;
        application.insert(&settings, 2)?;
        application.insert(&PredefinedMenuItem::separator(app)?, 3)?;
    }
    Ok(menu)
}

pub fn bootstrap_script() -> String {
    format!(
        r#"if (location.origin === '{ORIGIN}' && window === window.top) {{
            Object.defineProperty(window, 'phyniteDesktop', {{ value: true }});
            const invoke = (name, args) => window.__TAURI_INTERNALS__.invoke(name, args);
            Object.defineProperty(window, 'phyniteNative', {{ value: Object.freeze({{
                updateTheme: (theme) => invoke('update_theme', {{ theme }})
            }}) }});
        }}"#
    )
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
    let (theme, name) = match theme {
        Theme::System => (None, ns_string!("system")),
        Theme::Light => (Some(tauri::Theme::Light), ns_string!("light")),
        Theme::Dark => (Some(tauri::Theme::Dark), ns_string!("dark")),
    };
    if let Some(window) = app.get_window(WINDOW) {
        window.set_theme(theme).map_err(|error| error.to_string())?;
        // This native preference mirrors only the workspace theme for the
        // period before the WebView and its preference store are available.
        unsafe {
            NSUserDefaults::standardUserDefaults().setObject_forKey(Some(name), theme_key());
        }
    }
    Ok(())
}

fn theme_key() -> &'static NSString {
    ns_string!("PhyniteWorkspaceTheme")
}

pub fn startup_theme() -> Option<tauri::Theme> {
    let value = NSUserDefaults::standardUserDefaults().stringForKey(theme_key())?;
    match value.to_string().as_str() {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        _ => None,
    }
}
