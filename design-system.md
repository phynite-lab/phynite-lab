# Phynite Lab design system

The live **Design System** page in `phynite-lab-ui` contains a proposed **Core** library and a **Reference** catalog of the current application. Core makes repeated roles consistent while retaining Geist, Geist Mono, Geist Pixel Square and the neutral Light/Dark identity. Reference preserves contextual measurements and exceptions. The original application screens and application code are unchanged.

Start new library work from `Core/*`. Use `Reference/*` to reproduce an existing screen or understand its provenance. Adopting Core in the application requires a separate implementation change.

The page has eight Core boards followed by 20 Reference boards. Core contains 90 main components, including variant members and icons, 12 variant sets, eight text styles, one effect style and 56 variables. Reference retains 95 main components, four variant sets, 14 text styles, one effect style and 106 variables. The complete file therefore has 162 variables and 24 styles. These are library assets, not counts of unique application screens.

The unchanged baseline contains 13 pages, 801 frames and 198,623 nodes. It covers Home, Settings, project editors, local menus and dialogs, Guide articles, and six captured viewport widths. Theme and device variants account for many frames.

Use [design-tokens.json](design-tokens.json) for values and [component-guidelines.md](component-guidelines.md) for anatomy, states and reuse. The JSON retains extracted values at the top level and adds the proposed `core` namespace. It is an annotated reference, not application CSS or a DTCG schema conformance claim.

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

## Core standard

### Consistency with a reason

The rules apply proximity, similarity, alignment and visual hierarchy. Related labels and controls stay closer than separate groups; components with the same role share geometry; typography expresses function; selection remains distinct from hover and focus. Consistency means the same contract for the same role. A dialog, a scientific canvas and an article do not need identical geometry.

The 4 px rhythm, exact type sizes and radii below are Phynite conventions, not universal laws of design. Hairlines, scaled SVG strokes and derived centering values are explicit exceptions. Source exceptions remain in Reference instead of becoming competing Core masters.

| Contract | Core rule |
| --- | --- |
| Spacing | 4, 8, 12, 16, 24, 32, 48, 64 px. Label/control and heading/description gap 8; card sections 16; form groups 24. |
| Shape | Radius 8 controls and compact feedback; 12 containers/menus; 16 dialogs; pill 999 only for round tracks. A menu row 8 + inset 4 fits its container 12. |
| Boundaries | Border 1. Meaningful control boundaries use `border/control`; decorative dividers use `border/subtle`. |
| Focus | Outline 2 + offset 2. Bounds follow both axes when a component resizes; parents must not clip it. |
| Icons | Source Lucide paths, 24×24 viewBox, stroke 2, rendered 16 by default. Preserve round caps and joins; keep the hit area separate from the glyph. |
| Elevation | Flat cards; one floating effect for menus/tooltips: offset 0/8, blur 24, spread 0; black alpha 31/255 Light, 82/255 Dark. |
| Content | Preserve units and exact scientific values. Feedback names the problem and the next action; no fabricated results. |

### Semantic roles and modes

Set **Core · Theme → Light / Dark** on the containing frame. Component aliases point to semantic roles in that same collection, so one inherited mode changes the entire composition. Do not create a second master to represent a theme.

| Role | Light | Dark |
| --- | --- | --- |
| `canvas` | `#FCFCFC` | `#000000` |
| `surface/default` | `#FFFFFF` | `#111111` |
| `surface/raised` | `#FFFFFF` | `#151515` |
| `surface/hover` | `#F0F0F0` | `#1E1E1E` |
| `surface/pressed` | `#E5E5E5` | `#2B2B2B` |
| `text/primary` | `#171717` | `#EDEDED` |
| `text/secondary` | `#595959` | `#AAAAAA` |
| `border/control` | `#808080` | `#808080` |
| `border/subtle` | `#E5E5E5` | `#1D1D1D` |
| `focus/outline` | `#171717` | `#EDEDED` |
| `action/primary` | `#18181B` | `#F4F4F5` |
| `action/on-primary` | `#FFFFFF` | `#090A0D` |
| `action/hover` | `#000000` | `#FFFFFF` |
| `action/pressed` | `#303033` | `#D4D4D8` |

Success, warning, danger and information preserve the source semantic colors listed in Reference. The stronger secondary text, control boundary and focus roles are proposals. `button/fill`, `button/ink`, `field/fill`, `field/border`, `selection/fill`, `selection/ink` and `nav/selected` are aliases, not independent palettes.

### Density and typography

Set **Core · Density** once on a layout. Controls inherit the same minimum target height; density does not alter the type role or create another variant family.

| Metric | Compact | Default | Touch |
| --- | --- | --- | --- |
| Control minimum height | 32 | 40 | 44 |
| Button/field inline padding | 12 | 12 | 16 |
| Button block padding | 5 | 9 | 11 |

All values are px. Button block padding derives from a 20 px label and a 1 px border. Buttons and linked checkbox/switch rows can grow for wrapped labels; input/select values remain single line. Icon actions remain square. A 44 px Touch target is the product policy, not the universal WCAG AA threshold. Textarea minimum 96 is independent of density and grows with content.

| Native text style | Family / face | Size / line height | Tracking |
| --- | --- | --- | --- |
| Core/Brand | Geist Pixel / Square | 16 / 20 | 0 |
| Core/Display | Geist / Medium | 28 / 36 | −0.56 |
| Core/Heading | Geist / Medium | 20 / 28 | −0.4 |
| Core/Section | Geist / Medium | 16 / 24 | 0 |
| Core/Body | Geist / Regular | 14 / 20 | 0 |
| Core/Label | Geist / Medium | 13 / 20 | 0 |
| Core/Caption | Geist / Regular | 12 / 16 | 0 |
| Core/Code | Geist Mono / Regular | 12 / 20 | 0 |

Size, line height and tracking are px. All Core text layers link to these native styles. Use functional roles rather than inventing H1–H6 steps. Fallbacks and font licensing remain as documented in Reference. Center button labels; left-align field labels, navigation and explanatory text. Reflow text through auto layout rather than adding local font sizes or manual offsets.

### Library organization and verification

The eight Core boards cover Rules & Tokens, Actions & Density, Fields & Validation, Selection & Icon Actions, Composition & Responsive Behavior, Consistency Review & Quality Gates, Navigation & Surfaces, and Feedback & Data.

The consistency review corrected competing masters, incomplete density coverage, unlinked typography, two clipped reference labels, weak focus/boundary contrast, inconsistent label proximity and text overflow. Shared masters now govern all tones/states; heading/description groups use gap 8; dialog sections use gap 24. Footer buttons share available width, grow with their labels and align at the bottom.

Native MCP checks exercised all 80 unique variant tuples under Light/Dark × Compact/Default/Touch: 480 instances. They checked inherited colors, target heights, select actuator width and focus bounds. Additional checks covered long action labels in 320/390/480 px dialogs, a long textarea and a wrapping focused button. Composition resizing covered Dialog, Menu, Card, Tooltip, Loading and Empty at widths 288/320/390/480 in both themes. A further 24 cases checked long checkbox/switch labels, field-group labels and alert copy at width 288 across all six theme/density combinations. These are component widths, not a claim that the complete app reflows at every viewport.

Contrast uses resolved native variable values and the WCAG sRGB formula without rounding before comparison. Across 86 checked pairs, normal text/status text and action labels meet 4.5:1; meaningful control boundaries/focus meet 3:1. Minimum ratios are 4.775:1 for checked text pairs and 3.135:1 for checked non-text pairs. The boundary token was strengthened after Dark `#737373` against pressed `#2B2B2B` measured 2.986:1. Disabled and decorative separators are excluded from these acceptance gates.

The checks also verify text-style links, duplicate variant tuples, static text bounds, finite geometry, asset references, installed fonts and exact preservation of every baseline node. Runtime keyboard operation, screen readers, zoom/reflow and combined focus/validation behavior still require application tests.

The basis is role-based tokens and explicit layout contracts, supported by [Carbon spacing guidance](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview), [Carbon color roles](https://www.carbondesignsystem.com/building-blocks/foundations/color/tokens), [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) and [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Those sources support the principles and thresholds; they do not mandate Phynite's exact spacing, radii or type scale.

## Reference foundations

The following sections retain the extracted application measurements. Their native collection names are **Reference · Semantic**, **Reference · Metrics** and **Reference · Proposals**. They describe existing contexts; they are not competing Core defaults.

### Color

The **Reference · Semantic** variable collection has Light and Dark modes. It includes canvas, surface, raised, subtle surface, ink, muted ink, borders, rail, sidebar, action and status roles.

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

The 14 Reference text styles also include code and reading roles. Role names are inferred; values remain contextual. A synthetic H1–H6 scale would misrepresent the source. Other sections use 550 on the variable font axis; do not silently replace that with 600 in implementation.

CSS calls the brand family **Geist Pixel Square**; FigCraft stores family **Geist Pixel**, face **Square**. UI fallback is Geist, Arial, sans-serif. Code uses Geist Mono, monospace. Brand fallback is Geist Mono, monospace. Guide's Geist Public and GeistMono Public names refer to bundled subset aliases. Dense scientific labels can be 9–11.5 px; they need zoom and readability checks, not an assumption that small text is always acceptable.

Source: [typography](app/typography.css), [font declarations](app/fonts.css), and representative frames. Font licensing remains in [public/fonts/README.md](public/fonts/README.md) and the existing license files.

### Geometry, icons and effects

JSON opacity metrics use percentage points (50 means CSS opacity `.5`); motion metrics use milliseconds. Their `unit` metadata makes the conversion explicit. Native FigCraft number variables retain the same values.

The metric collection records observed spacing including 4, 6, 8, 10, 12, 16, 17, 18, 20, 22, 24, 28, 32, 40, 48, 52, 56 and 64 px. It is not a strict 4 px grid. A metric's presence does not make it suitable for every component.

Radii are contextual: lab controls 6, Home buttons and Settings inputs 8, select menu 9, project menu 10, Settings groups 14, application frame 16, Appearance panels 18, and pill controls 999 px. Borders are usually 1 px. Focus rings use 2 px with a 2 px offset; some Appearance controls use 3 px offset.

Lucide icons use a 24×24 viewBox, stroke 2, round caps and joins. Rendered sizes include 12, 14, 16, 17, 18, 20 and 24 px. Their stroke scales with SVG size. The Crystal workspace has a contextual 1.65 stroke override. Brand marks and third-party service logos are separate assets.

Floating sidebar elevation is `0 8px 30px` with black at 8% in Light and 24% in Dark. Select menus use `0 18px 46px` black 42% in Dark; the Light selector uses `#1F2834` at 18%. Elevation stays separate from focus indication.

## Reference responsive rules

| Context | Extracted behavior |
| --- | --- |
| Shell ≥961 px | 52 px rail, optional 280 px docked sidebar, flexible main; editor topbar 44 px. |
| Shell ≤960 px | 52 px mobile header, navigation drawer, 64 px drawer rail, 44 px rail targets, inspectors on demand. |
| Home content | Max width 840 px; padding 56×32 px; at container ≤500 px, padding 28×20 px. |
| Settings | Main max width 960 px; rows wrap/stack at container ≤540 px according to context. |
| Narrow Appearance | Mode choices reduce from 85×64 to 74×58 px; rich rows wrap; simple pairs remain paired where possible. |
| Coarse pointer | Existing button/select overrides enforce at least 44 px; linked labels and custom actuators still need review. |
| Guide data and tabs | Table min width 420 px with horizontal scrolling; editor tabs scroll horizontally. |

The original map contains fixed snapshots at 360, 390, 430, 768, 1024 and 1440 px. Reference specimens retain their source geometry. Core adds shared auto layout and the component resize checks described above; neither catalog claims to be a fluid replica of the whole application.

## Reference accessibility audit

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

Priority proposals are a stronger neutral focus token, a boundary review, and extending the existing touch policy to small custom targets. The earlier focus candidate remains in Reference · Proposals; the reviewed standard is in Core · Theme. Disabled controls have WCAG contrast exceptions; do not treat their opacity as an automatic failure.

AA target sizing under 2.5.8 is 24×24 CSS px or its spacing/other exceptions. A 44 px target is an existing touch policy and a recommended extension, not the universal AA threshold. Visual checkbox dimensions alone cannot establish whether the linked label/hit area passes.

Keyboard and assistive-technology checks remain open: 2.1.1 keyboard operation, 2.4.3 focus order, 2.4.7 visible focus, 2.4.11 unobscured focus, 4.1.2 names/roles/values, and 4.1.3 status messages. Inspecting `UiSelect` shows keyboard handling, but does not prove its runtime behavior across every portal and dialog. Also test 320 px reflow, 200% text resizing, browser zoom and long translations.

## Source audit and migration findings

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
