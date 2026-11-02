# Local AI provider accounts

## Local application: your provider accounts

The npm application uses the user's own supported provider CLI or an already configured
local gateway. The obsolete gateway configuration block is no longer shown in Settings.
Open **Settings → AI provider accounts** to connect a supported CLI account,
select among saved accounts, inspect connection status, and read available model
and usage information. Complete authentication through the provider's official
flow. Phynite Cloud login is separate and is not required for local AI. Phynite
does not import another application's cookies or session files.

After login, model discovery and capability checks run automatically. The live
provider catalog, current account entitlement, and verified tools/attachment
capabilities determine availability; Phynite Cloud model settings do not constrain
a local account. A failed or rate-limited request does not silently switch provider
or account. Canvas actions retain their existing validation and approval checks.

Usage reflects the provider's own reported limits, percentages, windows, and reset
times. Unavailable measurements remain unavailable; they are never converted into
invented token balances or reset dates. Credentials stay server-side in the local
credential store or provider-managed CLI files. They do not belong in browser
storage, logs, exported projects, or Cloud Sync. AI prompts are sent to the
provider the user selected, independently of optional Phynite Cloud services.

See [settings and preferences](settings-preferences.md) for account, usage, and
notification navigation. Provider CLI installation and subscription requirements
remain separate from the scientific-compute runtime.
