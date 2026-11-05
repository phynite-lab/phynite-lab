# Security policy

## Supported versions

Security fixes target the latest stable Phynite Lab npm release and the current
`main` branch. Older releases do not have a separate security backport policy;
update to the latest stable release before checking whether an issue persists.

This policy covers the local application, launcher, native core, and Phynite
runtime integration. You can also use the private reporting channel for suspected
Phynite Cloud vulnerabilities; maintainers will route them to the relevant service.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/phynite-lab/phynite-lab/security/advisories/new).
If that channel is unavailable, email [support@phynitelab.com](mailto:support@phynitelab.com)
with the subject `Phynite Lab security report`.

Do not disclose an unpatched vulnerability in a public issue, pull request, or
discussion. Include:

- The affected app/package version or source commit, operating system, and runtime
  versions where relevant.
- A concise description, expected security boundary, and potential impact.
- Minimal reproduction steps or a proof of concept using data and accounts you
  control.
- Redacted logs and configuration that help reproduce the issue.

Do not include passwords, tokens, API keys, private research files, or another
person's data. If a report requires sensitive material, describe what is needed
first so maintainers can agree on a suitable transfer method.

Maintainers will review the report privately and coordinate reproduction, a fix,
and disclosure with the reporter. Response and release timing depend on severity
and available maintainer capacity; this project does not promise a fixed response
time or a bug bounty reward. Credit can be included in a coordinated advisory
with the reporter's consent.

For ordinary bugs and scientific correctness concerns without a security impact,
use the [issue forms](https://github.com/phynite-lab/phynite-lab/issues/new/choose).
