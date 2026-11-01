# Phynite Lab local application

This repository is the source of truth for the AGPL-3.0-only local application.
The hosted control plane and deployment infrastructure are maintained separately.

- Preserve user changes, scientific units, exact inputs, provenance and checksums.
- Work on a task branch from current origin/main. Commit and push verified task
  changes and create a PR. Human review is optional unless requested. Merge needs
  passing applicable checks, resolved blocking findings and an explicit user
  instruction. Request a human reviewer only when the user asks for one.
- Never fabricate scientific output, claim an untested platform passed, bypass
  sandbox probes, or silently substitute solver settings or potentials.
- Browser APIs are same-origin; bind native services to loopback. Keep credentials
  server-side and out of source, logs, browser storage and source archives.
- Local work needs no login. Cloud login does not enable sync or upload projects.
- Run targeted tests, npm run test:structures, npm run lint, npm run typecheck and
  npm run build for relevant changes. Backend and scientific checks follow the
  distribution and native-runtime documentation.
- Do not publish npm, deploy services, change protections or billing, or modify
  user research data without authorization. Release workflows need all documented
  qualification evidence and corresponding source.
- Preserve third-party licenses and MD provenance. Keep AGPL corresponding source
  and build instructions available for every binary release.
