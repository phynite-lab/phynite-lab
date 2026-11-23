fn main() {
    const COMMANDS: &[&str] = &["update_project_tabs", "update_appearance", "open_settings"];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("could not configure the desktop UI bridge");
}
