# macOS Apple Silicon desktop preview

Open the disk image and drag Phynite Lab to Applications. The internal
preview uses an ad-hoc signature. Verify the download against `SHA256SUMS`.
If Gatekeeper blocks the first launch because it cannot verify the developer,
open **System Settings → Privacy & Security → Open Anyway** for this app.
See [Apple's guide to opening an app safely](https://support.apple.com/en-us/102445).

Distribution without that approval prompt requires a **Developer ID Application**
certificate, hardened runtime signing for the app and its bundled executables,
and [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
Attach the notarization ticket to the distributed app or disk image and verify
Gatekeeper on a fresh installation.

Phynite Lab opens with a native macOS startup screen. The pixel cloud
assembles while local services start on the default Phynite canvas colors.
On later launches, the screen follows the remembered workspace theme.
macOS Reduce Motion displays the
assembled cloud immediately. Startup errors and Retry use native controls.

The workspace opens in WKWebView. Local services use bundled Node.js and
the frozen native core. The app uses
`~/.phynite-lab`, including projects, results and installed runtimes saved by
the npm application. Stop the npm launcher before opening the same workspace
in the desktop app. Install any additional solvers in **Settings → Compute**.
Open Settings from the gear or with **Cmd+,**. The page uses the regular
workspace Settings layout and opens in the same desktop window.

Closing the window leaves local jobs running. Click the Dock icon to return
to the workspace. Quit with **Cmd+Q** to stop the local services. External
links and provider sign-in open in the default browser. Desktop exports
download to the macOS Downloads folder.

Use the existing export and import commands to move browser-only drafts,
figures and trajectories. The desktop app stores new WebView preferences
under its fixed loopback origin. If another app occupies the port or another
launcher owns the workspace, stop that process and use **Try again**.

## Build on Apple Silicon

Build from the exact clean source commit for the preview. These are build
commands. The packaged app runs without a separate Node.js or Python
installation.

```sh
brew install python@3.12
# Install Rust with the wasm32-unknown-unknown target and Apple's developer tools.
rustup target add wasm32-unknown-unknown
mkdir -p build/desktop-tools
curl -fL https://nodejs.org/dist/v22.23.5/node-v22.23.5-darwin-arm64.tar.gz \
  -o build/desktop-tools/node.tar.gz
tar -xzf build/desktop-tools/node.tar.gz -C build/desktop-tools
export PATH="$PWD/build/desktop-tools/node-v22.23.5-darwin-arm64/bin:$PATH"
npm ci
npm run build:local
"$(brew --prefix python@3.12)/bin/python3.12" -m venv build/desktop-core-venv
build/desktop-core-venv/bin/python -m pip install -r scripts/local-core-requirements.txt
build/desktop-core-venv/bin/python scripts/build-local-core.py --desktop --output build/desktop-core
node scripts/package-desktop.mjs \
  --node-archive build/desktop-tools/node.tar.gz \
  --core-dir build/desktop-core/darwin-arm64/phynite-core \
  --output build/desktop-preview
```

The package script checks the Node archive hash, locks Rust resolution, reuses
the npm distribution verifier, and collects third-party license texts. Use a
new output directory and run one packaging command at a time per checkout.

The output folder contains the app, a ZIP for transferring the app bundle, a
DMG, a corresponding source archive and `SHA256SUMS`. Bundled notices and the
build manifest are inside `Contents/Resources/payload`. The native runtime's
notice and source inventory use the same formats as the npm distribution.
Archive and transfer the preview through the internal review channel.
