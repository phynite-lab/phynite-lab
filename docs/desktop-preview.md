# macOS Apple Silicon desktop preview

Open the disk image and drag Phynite Lab to Applications. The internal
preview uses an ad-hoc signature. It has no Developer ID signature or Apple
notarization ticket. Verify the download against `SHA256SUMS` before trying
the app. macOS may ask you to approve the verified app on first launch.

Phynite Lab opens with a native macOS startup screen. The pixel cloud
assembles while local services start. macOS Reduce Motion displays the
assembled cloud immediately. Startup errors and Retry use native controls.

The workspace opens in WKWebView. Local services use bundled Node.js and
the frozen native core. The app uses
`~/.phynite-lab`, including projects, results and installed runtimes saved by
the npm application. Stop the npm launcher before opening the same workspace
in the desktop app. Install any additional solvers in **Settings → Compute**.

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
