fn main() {
    const COMMANDS: &[&str] = &["update_project_tabs", "update_theme"];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("could not configure the desktop UI bridge");
}
