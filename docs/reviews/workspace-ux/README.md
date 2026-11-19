# Home, Settings, Configure and AI review

Reviewed on macOS arm64, 19 November 2026, against local app base `47bfbe5`. Antigravity prepared the implementation plan; Codex developed the FigCraft designs, implemented the changes, and ran the checks. The task focuses on workspace setup and project interaction.

## Behavior and decisions

- Home offers a first-project action, an actionable empty search, and setup/help links. Search includes pinned projects and returns focus to the search field when cleared.
- Settings search identifies the destination section. An on-page index follows rendered, translated sections, including asynchronous panels. Individual rows opt in explicitly. Anchor navigation reveals collapsed Advanced sections before moving focus.
- DFT and MD share a radio-group mode control with arrow, Home and End navigation. It describes the selected editing view, commits pending text/number edits before pointer selection, and provides 44 px mobile targets. Inherited SCF inputs show a static label instead of an inert selector.
- AI starter cards fill and focus an unsent draft. Local setup distinguishes disconnected providers, unavailable catalogs, models being checked, and connected providers needing a model. A failed model-catalog request no longer prevents restoring saved conversations and composer drafts.

Radio semantics were chosen because these controls select an editing mode. Unknown values remain unchecked rather than implying a scientific choice. The Settings index uses explicit markers and frame-batched DOM reads to support asynchronous sections without a duplicate manifest. Provider checks follow the existing aggregated `local` catalog contract.

## Collaboration review

Antigravity's planning conversation was `f1b4f026-1285-4613-b59d-8a754d0e4f22`. Its initial detailed review returned partial text at a time limit; findings were checked against source and browser behavior. Accepted findings included pending-edit preservation, inherited-SCF labeling, active radio descriptions, selective index entries, batched updates, and pinned search results.

The final supplied-source review completed successfully in conversation `86b37882-fa21-494d-b435-9b223659f537`, with no blockers found in the supplied changes. The subsequent catalog-failure browser scenario exposed the draft restoration bug described above; it was fixed and added to regression coverage. A follow-up review of that fix also completed successfully with no blockers. The review and browser fixtures do not qualify live model execution or native solver runtimes.

## Validation

The repeatable browser check is:

```sh
npm run dev:local -- --data-dir /tmp/phynite-workspace-review --api-port 8897 --port 3107
node --experimental-strip-types scripts/verify-workspace-ux.mjs \
  http://127.0.0.1:3107 /tmp/phynite-workspace-evidence --confirm-disposable
```

Use a fresh data directory. The script rejects authenticated/cloud sessions and workspaces containing projects without its disposable-fixture marker. It intercepts AI POSTs and solver-run POSTs and asserts neither occurs. It creates only input fixtures.

Browser scenarios cover 1440×960 light/dark EN, 390×844 light/dark EN, 360×800 light ID, and 768×1024 dark EN. Assertions check creation entry, search reset/focus, collapsed Settings anchors, search destinations, exact preservation of `91.25` Ry during mode changes, keyboard selection, touch targets, horizontal overflow, catalog-error draft restoration, AI readiness, and no browser runtime errors. See [verification.json](verification.json).

Additional checks: `npm run test:structures` (865 passed), `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`, and the existing desktop/mobile HPC download regression. Lint retains one existing `no-img-element` warning in the untouched `AiProviderLogo.tsx`.

No scientific defaults, units, potentials, solver backends, or user research data were changed. No real AI turn or solver job was executed. Hosted deployments, native packaging, and native runtime qualification were not tested.

## Implemented screenshots

All screenshots use disposable inputs and explicit model-status fixtures.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Home | [Light](1440-light-en-home-empty.png) | [Indonesian, 360 px](360-light-id-home-empty.png) |
| Settings | [Light](1440-light-en-settings.png) | [Light, 390 px](390-light-en-settings.png) |
| Configure | [Dark](1440-dark-en-configure.png) | [Light, 390 px](390-light-en-configure.png) |
| AI setup | [Light](1440-light-en-ai-setup.png) | [Dark, 390 px](390-dark-en-ai-setup.png) |
| AI ready draft | [Dark](1440-dark-en-ai-ready-draft.png) | [Indonesian, 360 px](360-light-id-ai-ready-draft.png) |

The [editable FigCraft document](../../design/workspace-ux.figcraft) contains the design handoff and prototype references.
