# Phynite Lab design system

The visual library lives on **Design System** in the existing `phynite-lab-ui` FigCraft document. It adds reusable references to the current local application; it does not restyle the original screens or change application code.

The audit baseline contains 13 pages, 801 frames and 198,623 nodes. It covers Home, Settings, project editors, local menus and dialogs, Guide articles, and six captured viewport widths. Theme and device variants account for many of those frames.

Use [design-tokens.json](design-tokens.json) for values and [component-guidelines.md](component-guidelines.md) for anatomy, state behavior and reuse. The JSON is an annotated reference, not a drop-in CSS file or a claim of DTCG schema conformance.

The new page has 20 boards covering the 11 requested sections and the quality audit. It contains 95 main components (including icons and variant members), four variant sets, 20 instances, 14 text styles and one effect style. Its three variable collections hold 42 contextual colors, 63 metrics and one proposed focus color.

## Evidence and classification

| Label | Meaning |
| --- | --- |
| Extracted | Read from the existing design, a DOM/SVG capture, or the corresponding source rule. |
| Inferred | A role name, alias, assembly or reuse convention derived from observed patterns. |
| Proposed | A new recommendation. It has not been applied to existing application screens. |

The native canvas is the visual source. Source CSS helps distinguish intended geometry from imported path geometry and explains responsive behavior. For example, a rectangle with a centered 1 px stroke and radius 7.5 can represent an 8 px CSS control. Fractional path values are not automatically inconsistencies.

Representative source frames are Home Light `4294968082`, Home Dark `4294973334`, Appearance Light `4294967558`, Appearance Dark `4294970709`, Mobile Home Light `73014444033`, and Mobile Appearance Light `4294973780`. The baseline source revision is `deb6d3dcc839e079ec27c2afe53161d8514172db`.

## Visual principles

These principles are inferred from the product:

- Keep the interface quiet around scientific content. Neutral surfaces and compact chrome let structures, parameters and results carry attention.
- Keep units beside exact inputs and retain provenance. Missing data must remain visibly missing.
- Expose detail as the task develops: Home, project workspace, editor, then local configuration.
- Keep local work independent of login. Cloud login does not imply project upload or sync.

## Foundations

### Color

The **Phynite · Semantic** variable collection has Light and Dark modes. It includes canvas, surface, raised, subtle surface, ink, muted ink, borders, rail, sidebar, action and status roles.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#FCFCFC` | `#000000` |
| Surface | `#FFFFFF` | `#111111` |
| Raised | `#FFFFFF` | `#151515` |
| Subtle surface | `#F0F0F0` | `#1E1E1E` |
| Ink | `#171717` | `#EDEDED` |
| Muted ink, shell default | `#737373` | `#999999` |
| Line | `#E5E5E5` | `#1D1D1D` |
| Strong line | `#AAAAAA` | `#555555` |
| Primary action | `#18181B` | `#F4F4F5` |
| On primary | `#FFFFFF` | `#090A0D` |
| Success | `#216B40` | `#76D69B` |
| Warning | `#95520E` | `#F3AE62` |
| Danger | `#AD3039` | `#FF9299` |
| Information | `#3F3F46` | `#D4D4D8` |

The primary action is neutral. The secondary-action name is an inferred surface alias, not a second brand palette. Appearance uses `#3978FF` for focus and selection. Scientific switches and sliders have their own slate controls. Guide captures use `#FAFAFA` / `#0A0A0A` backgrounds and `#202329` / `#F2F1ED` text. Preserve these scopes until a deliberate product decision changes them.

Menus mounted in a body portal can resolve global tokens outside the shell scope. Their surface is `#FAFBFC` / `#000000`, raised surface `#FFFFFF` / `#14161A`, ink `#202936` / `#F0F2F5`, and selected surface `#F4F6F9` / `#191B20`. The `portal/*` tokens preserve this context.

Captured Settings muted text uses `#828282` in Dark in the audited preference context. The shell default is `#999999`; contrast preferences and scope affect the final computed value. Do not normalize the two without checking that context.

Sources: [research shell](app/research-shell.css), [global status/action values](app/globals.css), [control palette](app/lab-controls.css), [device preferences](app/device-preferences.css), and the original Guide frames.

### Typography

| Role | Family | Size / line height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| UI wordmark | Geist Pixel, Square face | 16 / 20.5 px | source face | −0.32 px |
| Appearance heading | Geist | 27 / 32.4 px | 500 | −0.675 px |
| Home heading | Geist | 22 / 28.6 px | 500 | −0.55 px |
| Settings navigation heading | Geist | 20 / 26 px | 500 | −0.5 px |
| Appearance section | Geist | 17 / 22.1 px | 500 | 0 |
| Section specimen | Geist | 14 / 21 px | 600 | −0.35 px |
| Shell body | Geist | 14 / 20.3 px | 400 | 0 |
| Navigation label | Geist | 13 / 17 px | 400 | 0 |
| Default button | Geist | 13 / 18.85 px | 500 | 0 |
| Caption | Geist | 12 / 15.5 px | 400 | 0 |
| Group label | Geist | 11 / 14 px | 500 | 0 |

The 14 text styles also include code and reading roles. Role names are inferred; values remain contextual. A synthetic H1–H6 scale would misrepresent the source. Other sections use 550 on the variable font axis; do not silently replace that with 600 in implementation.

CSS calls the brand family **Geist Pixel Square**; FigCraft stores family **Geist Pixel**, face **Square**. UI fallback is Geist, Arial, sans-serif. Code uses Geist Mono, monospace. Brand fallback is Geist Mono, monospace. Guide's Geist Public and GeistMono Public names refer to bundled subset aliases. Dense scientific labels can be 9–11.5 px; they need zoom and readability checks, not an assumption that small text is always acceptable.

Source: [typography](app/typography.css), [font declarations](app/fonts.css), and representative frames. Font licensing remains in [public/fonts/README.md](public/fonts/README.md) and the existing license files.

### Geometry, icons and effects

JSON opacity metrics use percentage points (50 means CSS opacity `.5`); motion metrics use milliseconds. Their `unit` metadata makes the conversion explicit. Native FigCraft number variables retain the same values.

The metric collection records observed spacing including 4, 6, 8, 10, 12, 16, 17, 18, 20, 22, 24, 28, 32, 40, 48, 52, 56 and 64 px. It is not a strict 4 px grid. A metric's presence does not make it suitable for every component.

Radii are contextual: lab controls 6, Home buttons and Settings inputs 8, select menu 9, project menu 10, Settings groups 14, application frame 16, Appearance panels 18, and pill controls 999 px. Borders are usually 1 px. Focus rings use 2 px with a 2 px offset; some Appearance controls use 3 px offset.

Lucide icons use a 24×24 viewBox, stroke 2, round caps and joins. Rendered sizes include 12, 14, 16, 17, 18, 20 and 24 px. Their stroke scales with SVG size. The Crystal workspace has a contextual 1.65 stroke override. Brand marks and third-party service logos are separate assets.

Floating sidebar elevation is `0 8px 30px` with black at 8% in Light and 24% in Dark. Select menus use `0 18px 46px` black 42% in Dark; the Light selector uses `#1F2834` at 18%. Elevation stays separate from focus indication.

## Responsive rules

| Context | Extracted behavior |
| --- | --- |
| Shell ≥961 px | 52 px rail, optional 280 px docked sidebar, flexible main; editor topbar 44 px. |
| Shell ≤960 px | 52 px mobile header, navigation drawer, 64 px drawer rail, 44 px rail targets, inspectors on demand. |
| Home content | Max width 840 px; padding 56×32 px; at container ≤500 px, padding 28×20 px. |
| Settings | Main max width 960 px; rows wrap/stack at container ≤540 px according to context. |
| Narrow Appearance | Mode choices reduce from 85×64 to 74×58 px; rich rows wrap; simple pairs remain paired where possible. |
| Coarse pointer | Existing button/select overrides enforce at least 44 px; linked labels and custom actuators still need review. |
| Guide data and tabs | Table min width 420 px with horizontal scrolling; editor tabs scroll horizontally. |

The original map contains fixed snapshots at 360, 390, 430, 768, 1024 and 1440 px. The library adds auto layout to basic actions and fields. Compound specimens retain documented geometry; they are not a fluid replica of the entire application.

## Accessibility audit

Contrast below uses the WCAG sRGB formula and opaque adjacent colors. Normal text needs 4.5:1; large text needs 3:1. Custom visual state indicators generally need 3:1 against adjacent colors under 1.4.11. A decorative separator is not automatically a failing control boundary.

| Pair | Ratio | Assessment |
| --- | --- | --- |
| Body Light `#171717` / `#FCFCFC` | 17.47:1 | Pass for normal text |
| Muted Light `#737373` / `#FCFCFC` | 4.62:1 | Pass for normal text |
| Body Dark `#EDEDED` / black | 17.94:1 | Pass for normal text |
| Captured muted Dark `#828282` / black | 5.46:1 | Pass for normal text |
| Shell focus Light `#AAAAAA` / `#FCFCFC` | 2.26:1 | Below 3:1 |
| Shell focus Dark `#555555` / black | 2.82:1 | Below 3:1 |
| Appearance focus `#3978FF` / `#FCFCFC` | 3.86:1 | Pass against this adjacent fill |
| Input line Light `#E5E5E5` / white | 1.26:1 | Review whether this boundary identifies the field |
| Input line Dark `#1D1D1D` / `#111111` | 1.12:1 | Same conditional review |
| Muted `#737373` / selected `#EBEBEB` | 3.98:1 | Unsafe for normal text if used together; conditional pairing, not a claimed observed defect |

Priority proposals are a stronger neutral focus token, a boundary review, and extending the existing touch policy to small custom targets. Proposed values live in their own collection. Disabled controls have WCAG contrast exceptions; do not treat their opacity as an automatic failure.

AA target sizing under 2.5.8 is 24×24 CSS px or its spacing/other exceptions. A 44 px target is an existing touch policy and a recommended extension, not the universal AA threshold. Visual checkbox dimensions alone cannot establish whether the linked label/hit area passes.

Keyboard and assistive-technology checks remain open: 2.1.1 keyboard operation, 2.4.3 focus order, 2.4.7 visible focus, 2.4.11 unobscured focus, 4.1.2 names/roles/values, and 4.1.3 status messages. Inspecting `UiSelect` shows keyboard handling, but does not prove its runtime behavior across every portal and dialog. Also test 320 px reflow, 200% text resizing, browser zoom and long translations.

## Standardization findings

| Priority | Finding | Recommendation |
| --- | --- | --- |
| High | Baseline has no shared styles, variables or native components. | Use the additive library for new work; migrate old screens only in a separate approved change. |
| High | Shell/select focus is weak against the base canvas. | Validate the proposed stronger focus role on every adjacent fill. |
| Review | Very subtle input boundaries may be the only field affordance. | Evaluate each control under 1.4.11 before changing border tokens. |
| Medium | Different feature scopes use different palettes and radii. | Name those families explicitly; preserve intentional exceptions. |
| Medium | Small scientific labels and compact controls need usability evidence. | Check zoom, touch targets, spacing exceptions and density overrides. |
| Informational | Imported paths contain stroke insets, scaled icons and outlined headings. | Do not count these as visual drift without comparing the source capture. |

## Limits and maintenance

This audit does not certify the application as WCAG compliant. It does not invent logged-in AI/Cloud screens, populated calculations, trajectories, figures, native OS choosers, or post-install HPC/runtime results. Those states remain marked as requiring login, data or runtime evidence.

Changes to proposals need a separate app change and applicable tests. Keep scientific values, units and provenance unchanged. Keep `.figcraft`, local backup files, reference captures and automation scripts outside the source commit. This repository contains only the portable documentation and tokens.
