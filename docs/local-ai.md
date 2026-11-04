# Local AI provider accounts

The bilingual guide at https://phynitelab.com/guide/ai-providers includes the
provider icons, settings screenshots, and a step-by-step login and capability
check walkthrough. Use it alongside this maintainer reference when the CLI
reports a different model or usage state.

## Local application: your provider accounts

The npm application uses the user's own supported Codex or Antigravity CLI.
Open **Settings → AI provider accounts** to connect one supported CLI account,
inspect connection status, and read available model and usage information. Complete authentication through the provider's official
flow. Phynite Cloud login is separate and is not required for local AI. Phynite
does not import another application's cookies or session files.

After login, model discovery and capability checks run automatically. The live
provider catalog, current account entitlement, and verified tools/attachment
capabilities determine availability; Phynite Cloud model settings do not constrain
a local account. A failed or rate-limited request does not silently switch provider
or account. Canvas actions retain their existing validation and approval checks.

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

In a project Canvas, the AI can search public structure records with
`search_crystal_structures` and import a selected record with
`import_crystal_structure`. COD searches need no API key. Materials Project
searches require `MP_API_KEY` in the server environment; keys must never be sent
through chat or stored in a project.

Search is read-only and accepts public material queries. An import refetches the
selected source record and verifies its checksum before preparing the normal
reviewed change. The application preserves coordinates and source provenance;
the model does not transcribe atom positions. Import creates a structure module
and does not start a solver. Check the physical model, occupancies,
pseudopotentials and convergence settings before running a calculation.
