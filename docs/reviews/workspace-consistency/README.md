# Workspace consistency overhaul

Reviewed on macOS arm64, 19 November 2026, against local application base `47bfbe5`. This expands the [initial workspace interaction work](../workspace-ux/README.md) into shared visual foundations across Home, every locally available Settings chapter, DFT/MD Configure, and AI. Antigravity prepared the broader plan and reviewed supplied source; Codex designed in FigCraft, implemented, and verified the application.

## Result

Home, all Settings chapters, and AI welcome share `WorkspacePageHeading` with the same type hierarchy and spacing. Home has grouped project rows, real section counts, and a two-column setup directory that stacks on mobile. Settings uses shared content wells, grouped rows, panel spacing, control geometry, and semantic focus/accent colors, including Appearance, Compute/HPC, providers, account, usage, storage, privacy, keyboard, and notifications.

DFT and MD now use the same `ConfigurationNumberField`, `ConfigurationTextField`, and section heading primitives. Units remain attached to exact number inputs. Duplicate MD borders and independent DFT select sizing were removed. Readouts honor the independent code font preference while maintaining a 16 px mobile zoom floor. Cards, selectors, menus, switches, primary/secondary actions, mode controls, and configuration dialogs share geometry tokens. Compact mode remains 32 px on desktop and respects 44 px mobile/touch targets.

AI welcome, composer, model/context popups, custom skills, and MCP dialogs use the same typography, radii, shadows, and focus colors. Closing a skill or connections dialog returns keyboard focus to the persistent Add context action, including when its launching popup has unmounted. Existing model-readiness states and unsent draft restoration remain covered by regression tests.

See the [editable FigCraft handoff](../../design/workspace-ux.figcraft) and [foundation board](../../design/workspace-foundations.png). The design contains 18 artboards, six text styles, 14 Light/Dark variables, reusable native components, and 39 valid prototype destinations.

## Collaboration

Antigravity planning completed in conversation `f5c5cc16-b5fb-464c-aeeb-e68044f95051`. The supplied-source consistency review completed in `b2bf649b-8d4b-4f9f-8986-094cfa2b95ff` with no blocking findings. Its menu-row radius and Appearance padding observations were incorporated. We retained the readable 28 px page title and 40/32/44 px control geometry after evaluating its denser alternatives.

A supplementary review of final small popup, focus, and cascade changes timed out without a response (`efd56c5d-fbca-4bb3-8d0f-74f38949e959`); it is not counted as approval. Browser checks caught and corrected compact-input padding, MD duplicate borders, and mobile font cascade conflicts. Source review does not qualify runtime behavior; the checks below provide that evidence.

## Reproduce

Start a disposable local workspace, then run the checks in this order:

```sh
npm run dev:local -- --data-dir /tmp/phynite-consistency-review --api-port 8898 --port 3108
node --experimental-strip-types scripts/verify-workspace-ux.mjs \
  http://127.0.0.1:3108 /tmp/phynite-workspace-evidence --confirm-disposable
node scripts/verify-workspace-consistency.mjs \
  http://127.0.0.1:3108 /tmp/phynite-consistency-evidence --confirm-disposable
node scripts/verify-hpc-download-ui.mjs \
  http://127.0.0.1:3108 /tmp/phynite-hpc-evidence
```

The workspace scripts refuse authenticated/cloud sessions and projects without the explicit disposable-fixture marker. The consistency matrix permits only recency metadata and input configuration saves on its validated three-node fixture. Other writes, including solver and model invocations, are blocked and fail verification. HPC runs last because it creates differently marked fixtures. No actual calculation or AI turn is run.

## Validation and evidence

The cross-page Chromium matrix covers Home plus nine locally available Settings destinations at 1440 px light/dark, 390 px light/dark, and 768 px touch. It checks common headings, page overflow, create/HPC/AI dialogs, Escape and focus return, shared DFT/MD input geometry, a single input border, focus visibility, Simple/Manual/Advanced views, Compact/touch heights, enlarged UI/code fonts, and a custom accent. See [consistency.json](consistency.json).

The six behavior cases additionally cover 360 px Indonesian and 768 px dark English, exact `91.25` Ry preservation across mode changes, collapsed Settings anchors, search recovery, five AI readiness states, catalog-failure draft restoration, and unsent starters. See [verification.json](verification.json). Desktop/mobile HPC download checks cover toolbar order, ZIP paths, downloads, and unavailable-result handling.

The [validation summary](validation.json) records the source checks and tested scope. Required source checks: `npm run test:structures` (865 passed), `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`. Lint retains the existing `no-img-element` warning in untouched `AiProviderLogo.tsx`.

Scientific defaults, units, potential selection, solver backends, provenance, and user research data are unchanged. Tests use only marked disposable input projects and mocked model status. Live AI execution, native solver qualification, native packaging, and hosted deployment are outside this verification.

## Screenshots

[Before and after comparison](before-after.png) compares the preceding PR state with the overhaul using the same viewport and fixture scenario. It is a layout comparison, not a scientific comparison.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Home | [Light](1440-light-en-home-empty.png) | [Indonesian, 360 px](360-light-id-home-empty.png) |
| Appearance | [Light](1440-light-en-settings.png) | [Light](390-light-en-settings.png) |
| Compute | [Dark](1440-dark-compute.png) | [Profile dialog](390-light-compute-dialog.png) |
| AI providers | [Light](1440-light-ai-providers.png) | [Dark](390-dark-ai-providers.png) |
| DFT Configure | [Light](1440-light-scf-simple.png) | [Light](390-light-scf-simple.png) |
| MD Configure | [Dark](1440-dark-md-simple.png) | [Light](390-light-md-simple.png) |
| AI draft | [Dark](1440-dark-en-ai-ready-draft.png) | [Indonesian, 360 px](360-light-id-ai-ready-draft.png) |
| AI skills and connections | [Skills](1440-light-ai-skills.png) | [Connections](390-dark-ai-connections.png) |
