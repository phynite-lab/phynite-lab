# Local AI provider accounts

The bilingual guide at https://phynitelab.com/guide/ai-providers includes the
provider icons, settings screenshots, and a step-by-step login and capability
check walkthrough. Use it alongside this maintainer reference when the CLI
reports a different model or usage state.

## Local application: your provider accounts

The npm application uses the user's own supported Codex, Claude Code or Antigravity CLI.
Open **Settings → AI provider accounts** to connect one supported CLI account,
inspect connection status, and read available model and usage information. Complete authentication through the provider's official
flow. Phynite Cloud login is separate and is not required for local AI. Phynite
does not import another application's cookies or session files.

After login, model discovery and capability checks run automatically. The live
provider catalog, current account entitlement, and verified tools/attachment
capabilities determine availability; Phynite Cloud model settings do not constrain
a local account. A failed or rate-limited request does not silently switch provider
or account. Canvas actions retain their existing validation and approval checks.

AI source attachments no longer have the old 10 MB browser quota. The browser
hashes and streams each file directly to the configured object store, and the
original bytes remain available with their checksum. Format readers still apply
safe parser limits; a larger source is retained and shown with an extraction
warning instead of being silently truncated. The model provider may have its own
input limit for visual attachments, so use a smaller derivative when the provider
cannot accept the original image or PDF.

When a provider is connected, choose the account and model from the provider
account page or chat composer. A model is usable only after text, streaming, and
any requested tools or attachments pass the host capability probe. If that probe
fails, the model remains unavailable and the application keeps the diagnostic
instead of asking you to guess a permission mode. Provider login and Phynite Cloud
login are separate sessions; local AI does not use hosted Phynite AI.

Usage reflects the provider's own reported limits, percentages, windows, and reset
times. Unavailable measurements remain unavailable; they are never converted into
invented token balances or reset dates. Credentials stay server-side in the local
credential store or provider-managed CLI files. They do not belong in browser
storage, logs, exported projects, or Cloud Sync. AI prompts are sent to the
provider the user selected, independently of optional Phynite Cloud services.

See [settings and preferences](settings-preferences.md) for account, usage, and
notification navigation. Provider CLI installation and subscription requirements
remain separate from the scientific-compute runtime.

## Crystal database tools

For a manual import, open or add a Crystal structure module and choose
**Crystal database** inside its editor. Importing a selected record fills that
module while retaining its Canvas connections.

In a project Canvas, the AI can search public structure records with
`search_crystal_structures` and import a selected record with
`import_crystal_structure`. COD searches need no API key. Materials Project
searches use your key from **Settings → Compute → Materials Project**.

Paste the key into the password field and choose **Save API key**, then **Test
connection**. Changes apply immediately to manual crystal searches and AI tools;
no restart is needed. The saved key is write-only: Settings shows its status, not
its value. **Remove saved key** removes this connection's saved credential.

The native service stores the key in the operating-system credential store when
available. If that store is unavailable, Settings labels the key **Session only**;
enter it again after restarting Phynite Lab. The key stays outside projects,
exports, Cloud Sync, browser storage, and logs. Search requests send it only to
the fixed official Materials Project API endpoint.

`MP_API_KEY` in the launcher/server environment remains an optional fallback.
A saved Settings key takes priority; removing it reveals an existing environment
key. To remove the environment fallback, unset it and restart the launcher.

Open **Crystal structure → Crystal database → Materials Project** to search.
Never paste keys into AI chat or commit them in a repository. If a real key was
exposed in chat or a terminal transcript, revoke it in Materials Project and
create a replacement.

Search is read-only and accepts public material queries. An import refetches the
selected source record and verifies its checksum before preparing the normal
reviewed change. The application preserves coordinates and source provenance;
the model does not transcribe atom positions. Import creates a structure module
and does not start a solver. Check the physical model, occupancies,
pseudopotentials and convergence settings before running a calculation.
