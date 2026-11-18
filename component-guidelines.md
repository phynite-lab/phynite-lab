# Phynite Lab component guidelines

Use **Core/** assets on the live **Design System** page. The 13 application pages now use Core paints, typography and native instances. **Reference/** retains captured application measurements. Canvas control surfaces and spacing have changed; application code is unchanged.

[design-system.md](design-system.md) explains the audit and [design-tokens.json](design-tokens.json) records values and provenance. Core rules describe the library contract. The applied-screen rules below describe the canvas migration; application adoption still requires code changes. Reference retains extracted and inferred values.

## Working with Core in FigCraft

1. In Assets, choose a `Core/*` component and place an instance. Keep the master link.
2. Set **Core · Theme → Light / Dark** and **Core · Density → Compact / Default / Touch** on the containing frame. Descendants inherit both; do not duplicate masters for a theme or size.
3. Switch exposed properties. Button has `Tone` and `State`; Checkbox/Switch have `Checked` and `State`; fields expose `Value`; actions and navigation expose `Label`.
4. Resize the containing layout. Use Fill for flexible content, Hug for content height and a fixed width for glyphs/actuators. Keep text styles, token bindings and focus constraints intact.
5. For dialog actions, use equal Fill widths and Hug heights. Labels wrap, minimum height follows density, and the row aligns at the bottom. Do not force a wrapped label into a fixed-height instance.
6. Keep new product behavior separate from a library specimen. Visual states cannot implement focus handling, announcements or disabled behavior.

Core · Metrics holds the spacing, radius and geometry contract. Core · Density sets minimum height 32/40/44, inline padding 12/12/16 and button block padding 5/9/11. These values are px in Compact/Default/Touch order. Native text styles are Core/Brand, Display, Heading, Section, Body, Label, Caption and Code. Do not change local font values to make an instance fit.

## Editing an existing linked screen

Select the `Applied / <family>` instance, then edit the original text/icons inside its `Applied content · <family>` slot. Keep `Default content=false` on migrated screen instances. Turn it on for a normal library specimen. The native skin still inherits its Core master.

Change shared colors in **Core · Theme**, type families/sizes in **Core · Typography**, and spacing in **Core · Metrics**. `Core/Applied/*` text styles preserve captured metrics while sharing font tokens. Use one applied profile for each role: inline 12 for ordinary controls, inline 8 for compact toolbars, inline 16 for touch contexts, and gap 8. Keep numeric suffixes visible. Settings groups use 24 (block 16 for shallow text notices), Appearance panels 16 inline/8 block, workflow/configuration cards 12, notices 16 and menus 4 outside their row content. Values are px.

Edit the `Shared layout` frame inside the slot for content alignment. Its padding and gap bindings must remain attached. Fields flex their value independently of suffixes/icons. Container bodies preserve captured rows/columns and use edge constraints. Avoid an instance-specific offset that conceals a wrong shared inset.

Scaled Guide illustrations, theme preview artwork, empty surfaces and some compound controls retain source geometry with shared paints/type. Inspect these contexts before changing their structure. Full-screen captures remain discrete responsive examples; they are not complete responsive auto-layout implementations.

## Core component contracts

All control borders are 1 px. Controls share radius 8, containers 12 and dialogs 16. Focus uses a 2 px outline with 2 px offset. The outline follows resized bounds and must remain outside clipped content. Use semantic token roles rather than copied hex colors.

| Family | Anatomy and geometry | Properties and behavior | Content and responsive rule |
| --- | --- | --- | --- |
| Button | Neutral action, optional semantic danger tone; Label 13/20 centered; gap 8. Minimum height follows density. | Tone Primary/Secondary/Quiet/Danger × State Default/Hover/Pressed/Focus/Disabled: 20 tuples. | Bounded width + Fill label + Hug height. Long labels wrap and preserve padding. One principal action per action group. |
| Icon button | Source Lucide 16 glyph in a square density target. | Five interaction states; icon color follows theme. | Accessible name required in implementation; tooltip supplements it. Never reduce the target to the glyph bounds. |
| Input | Body 14/20; field fill; strong control boundary; inline padding follows density. | Default/Hover/Focus/Error/Disabled; exposed Value. | Fill available width; single-line values truncate visually. Preserve the full value in implementation. |
| Select | Same field contract; fixed 32 px actuator and 16 px chevron. | Same five field states; exposed Value. | Value flexes independently of actuator. Menu clamping, keyboard behavior and accessible labels require runtime checks. |
| Textarea | Same shape/value style as fields; padding 12; minimum height 96. | Same five field states; exposed Value. | Fill width, Hug height; content grows rather than spilling below a fixed box. |
| Field group | Persistent Label 13/20, control, optional Caption 12/16 helper; gap 8 throughout. | Default/Error. Error specimen pairs an empty value with “Enter a project name.” | Label and helper fill width and wrap. Put 24 px between independent groups. Validation does not imply focus. |
| Checkbox / Switch | Checkbox 16×16/r4; switch 32×20 with 16 px thumb. Label 13/20, gap 8. | Checked Off/On × five interaction states: 10 tuples per family. | Full row has density minimum height; wrapped labels grow the row. Linked text is part of the hit area. |
| Navigation item / Tab | Label 13/20; density height; radius 8. Selected nav has a 2 px leading marker; selected tab a 2 px underline. | Default/Hover/Selected/Focus/Disabled: 5 tuples each. | Navigation labels fill and truncate; tab labels center. Preserve the accessible full name and scrolling in implementation. |
| Menu | Radius 12, inset 4, gap 4; nested navigation rows have radius 8. Raised surface and shared floating effect. | Rows use the same navigation master and its state contract. | Fill rows inside the menu; clamp the menu to the viewport in code. |
| Card | Radius 12, padding 24; heading/description gap 8; action section gap 16. Flat surface. | Passive container; nested Button provides the action. | Headings/body wrap. The container does not need Hover/Pressed/Disabled variants. |
| Dialog | Radius 16; width 480 default; padding 24, narrow example 16; heading/description gap 8; section gap 24. | Nested field groups, textarea and Button instances inherit theme/density. | Resize through the root. Footer controls share available width and grow vertically. Runtime constrains the modal to the viewport and handles scrolling, focus trap, Escape and focus return. |
| Alert / Status | Alert radius 12, padding 16, gap 8. Status dot 6 + gap 8 + Caption 12/16. | Tone Info/Success/Warning/Danger: 4 tuples each. Title/message or visible status word accompanies color. | Alert text fills and wraps. These are UI specimens, not evidence of a run result. |
| Table | Radius 12; minimum width 420; equal flexible cells; header Label 13/20, body 14/20; inline padding 16. | Header and rows share density height; separators use subtle borders. | Scroll horizontally below minimum width. Keep semantic headers, units and full values in implementation. |
| Tooltip / Loading / Empty | Tooltip radius 8, padding 8×12, minimum 32; Loading glyph 16 and gap 8; Empty radius 12/padding 24. | Shared floating effect for tooltip; loading and empty are passive feedback. | Text wraps within bounds. Empty uses heading/body gap 8 and action gap 16. Loading needs reduced motion and suitable announcements in runtime. |

For interactive controls, Hover is transient pointer feedback; Pressed is a transient activation state; Selected is a persistent route/choice; Focus identifies keyboard location. Do not substitute one for another. Error is independent validation information: preserve error text while showing focus in implementation. The field variant sets show separate Focus and Error specimens; they do not exhaust every combined runtime state.

Disabled opacity uses 50 percentage points (`.5` in CSS). Disabled behavior and explanations belong in implementation. Do not require contrast on inactive controls as if they were active, or use disabled styling for an ordinary secondary action.

## Acceptance and maintenance

Before changing a Core contract:

- Change the shared variable/style/master first. Update all affected variant tuples and nested compositions together.
- Check both themes and all three densities. Preserve minimum target height, field actuator width and a non-clipped focus outline.
- Test long text and narrow containers; inspect text bounds after the layout resolves. An instance created before a master change may retain sizing overrides: inspect the nested instance as well as the master.
- Check normal text at 4.5:1 and meaningful control/state indicators at 3:1 on the actual adjacent fill, without rounding a failing ratio up to the threshold.
- Keep the saved source baseline and Reference assets available. Record the reason for any new exception; do not add a near-duplicate token or standalone master merely to fit one specimen.

Native checks covered 480 variant instances, narrow/long-content dialogs, 48 composition resize cases and 24 long-content cases for selection rows, field groups and alerts. Contrast passed 86 resolved token pairs; fonts and asset links resolved. These checks verify the design library. Keyboard operation, screen-reader semantics, browser zoom, focus visibility in the running app and populated scientific/login states need their own evidence.

## Reference catalog

These values describe the current application, not Core defaults. Specimen widths and explanatory copy are documentation choices. Set **Reference · Semantic → Light / Dark** for Reference instances. The Reference Button, Select, Checkbox and Switch sets expose supported variants; they do not provide the complete Core density matrix. Basic actions/fields use auto layout, while compound specimens retain source geometry. The file-local library has not been published to an online team library.

### Actions

| Component | Anatomy and dimensions | Typography and appearance | Behavior and use |
| --- | --- | --- | --- |
| Button / Primary | Default min h40, r6, padding 8×13, gap 8. | Geist13/1.45, 500; neutral accent / on-accent; border1. | Use for the main action. Hover uses accent-strong. Focus uses the source shell ring in the state set. |
| Button / Home | Min h36, r8, padding 8×12, gap 8. | Geist12; neutral primary treatment. | Use in Home heading actions. Coarse-pointer policy raises target to44. |
| Button / Secondary | Default h40/r6; same alignment as primary. | Surface, ink, line1. | Reversible or supporting action. Hover uses subtle surface and muted border. |
| Button / Quiet | Same control geometry; transparent default border/fill. | Muted text. | Supporting link-like action. Keep its hit area and focus treatment. |
| Button / Danger | Same default geometry; danger text on surface. | Status danger; text states the action. | Destructive action. Confirm only where the existing flow does. Color is not the only cue. |
| Icon button / Home | 36×36, r8, centered16 px icon. | Lucide/currentColor. | Accessible name required; hover/focus must also reveal actions hidden by default. Coarse pointer uses44×44. |

The Reference Button set exposes Tone, State and Size for supported combinations. Default/Hover/Focus use source styling. Disabled action opacity `.5` is an **inferred** convention from existing selects; it is not claimed as a uniform captured button rule. Pressed reuses the hover tone as a **proposed** standard. Not every Cartesian combination is supplied.

Keep focus rings inside the main component tree but outside clipped content, so a Focus variant retains its ring when instanced. Label edits must not collide with icons or shrink the hit area.

Source: [lab actions](app/lab-ui.css), [Home overrides](app/research-shell.css), [touch/density overrides](app/device-preferences.css).

### Fields and selection

| Component | Anatomy and dimensions | States and use | Narrow layout |
| --- | --- | --- | --- |
| Settings input | Min h40, r8, border1, padding 10×12, Geist13. | Persistent label outside field; value is editable. Error text must identify a correction. A stronger error border is proposed, not extracted as a universal input rule. | Fill available width; preserve labels. Profile fields use a two-column grid where space permits. |
| Select | Default h40/r6; value inline padding 10; actuator32 wide; chevron14. Compact h28, actuator26, value padding 8. Compute context can use32 height. | Default/Hover/Focus/Disabled in the native set. Focus currently changes border to line-strong with no outer ring; this is an audited weakness. Error danger border is proposed. | Trigger fills available width. Keep actuator fixed; truncate value visually without losing the accessible full label. |
| Select menu | r9, border1, padding 5; default options min h38, r6, internal gap 9, padding 6×7×6×10, inter-option gap 6. Compact options min h30, internal gap 8, padding 5×8, inter-option gap 2. Detail options min h42. | Selected and highlighted options use subtle surface. Disabled trigger opacity.5; disabled option.45. | Menu clamps to viewport/portal; JS chooses above or below; preserve scrolling. |
| Search / Home | Min h38/r8, border1, inline padding 10, gap 10, icon16. | Placeholder plus input and optional clear action; focus-within uses shell ring. | Touch min44. Avoid losing the clear target or clipping entered text. |
| Textarea / Project | r4, padding 10×12, body14/1.5. Captured specimen h94; source min42. | Multiline project description. Height is content/context dependent. | Fill dialog width; keep vertical resizing where the app supports it. |
| Number + unit | Dense h36/r6, number in Geist Mono11, small unit suffix. | `<input>` is a placeholder; no scientific output is supplied. | Keep suffix adjacent to the value. Do not hide units or change settings to fit. |
| Checkbox / Lab | Visual box16×16/r4/border1, label gap 9, Geist11/1.35 at500. | Off/On/Focus/Disabled variants; disabled opacity.42. Linked label remains part of the control. | Measure the whole hit target and its spacing, not just the16 px square. |
| Switch / Lab | Track30×17; thumb11 with 2 px inset, 13 px travel. | Off/On; slate palette; focus comes from the linked input. | Row can grow while track stays fixed. |
| Switch / Appearance | Track34×21; thumb15; Appearance blue when active. | Off/On; source context differs from lab switch. | Preserve the text-rich row wrapping and touch target. |

Select menus rendered in a body portal use `portal/*` colors from the global scope. Keep these separate from the shell surface roles; the Menus & Overlays board shows both themes.

The select's JS supports arrows, Escape, Tab closure, type-ahead and focus return in source. Verify those paths in the running application, including dialog portals, before claiming keyboard conformance. Disabled controls must remain inoperable in code; a visual opacity variant cannot enforce that.

Source: [UiSelect CSS](components/UiSelect.css), [UiSelect behavior](components/UiSelect.tsx), [settings fields](app/account/settings.css), [lab controls](app/lab-controls.css), [project dialog](app/secondary-ui.css).

### Navigation and containers

| Component | Anatomy | Variants/states and use | Responsive behavior |
| --- | --- | --- | --- |
| Navigation / Rail | Desktop width 52; target 36/r10; gap 8; icon18. | Default, hover, selected and focus follow shell roles. Selected state needs more than a tiny color shift. | At≤960: drawer rail64, target 44/r12. |
| Navigation / Settings | Width280; search246×41/r10; item min h40/r9, padding 9×10, gap 10; label13. | Default and selected specimen items; hover uses contextual surface. Do not infer that all nav families share the same geometry. | Drawer replaces the docked layout at shell breakpoint. |
| Navigation / Editor tabs | Topbar44; tabs r7, internal gap 4; ordinary tab max220; close actuator26. | Selected uses raised surface; hover/focus-within reveals close action. Unsaved/close rules belong to the app. | Horizontal scrolling and compact controls. Verify roving focus in runtime. |
| Menu / Home sort | Min width 210, r10, padding 5, option min34/r5/label12. | Selected sort option, hover/focus treatment. No destructive action is invented in this sort menu. | Max width viewport−40; keep menu inside viewport. |
| Container / Settings group | Border 1, r14, surface, content padding 24; generic row padding 22×24, gap 28. | Noninteractive container. Hover/pressed/disabled do not apply to the whole card unless it is actually an action. | Row controls flex around260 px, wrap/stack in settings container≤540. |
| Container / Appearance panel | Border 1, r18, canvas, inline17; rows min48 and gap 16. | Theme previews and compact controls retain their specific selection states. | Inline13 at narrow container; rich rows wrap; mode previews shrink to74×58. |
| Card / Workflow node | Width230, min h92, padding 14/r6; heading13/1.45, 500; footer11. | Selected source uses workflow focus; statuses include ready, failed/blocked and queued/pending. The specimen is “Not run”. | Canvas navigation/zoom handles dense graphs. Do not fabricate populated results for the card. |

The component sidebar is a representative subset, not a replacement navigation tree. The original map remains the reference for all existing menus and routes. Compound component internal layout is fixed where the original map supplies only fixed geometry.

Source: [shell](app/research-shell.css), [settings](app/account/settings.css), [workflow](app/project-workflow.css).

### Dialogs, tables and feedback

| Component | Anatomy and appearance | States/usage | Responsive and interaction requirements |
| --- | --- | --- | --- |
| Dialog / Create project | Width min(480, viewport−32), r6, border1, padding 28; heading22; fields r4; footer gap 10. | Empty, entered and validation behavior belong to the local flow. The specimen includes editable fields and nested action instances. | Mobile padding 22; max height viewport−32. Verify Escape, focus trap, labelled title and focus return. |
| Data / Guide table | Wrapper r3/border1; min width 420; text13/1.7; cells13×16 padding; header600, row header500. | Source header, row and hover patterns. Specimen rows describe UI metadata, not research results. | Horizontal overflow; keep headers associated with cells. Numeric result grids require data-specific review. |
| Navigation / Article pagination | Two columns, gap 24; top border; top padding 26, margin42; label12/title13. | Previous/Next articles. This is not numbered result pagination. | Gap18 in narrow Guide styles; readable labels and arrow targets. |
| Feedback / Tooltip | MD context h28, r5, padding 0×10, border1; raised; text12/500; shadow0 8 20 black24%. | Hover and keyboard focus show it. No interactive content inside a tooltip. | Must not obscure the focused control; check dismissal/persistence behavior in runtime. |
| Status badge | Dot6 + gap 5 + text12/1.5. | Ready/Pending/Blocked specimens demonstrate semantic color and a word. They do not assert actual run states. | Keep label visible; never rely on dot color alone. |
| Validation notice | Example assembly uses notice padding 14×16/r10 and captured local validation text. | **Inferred** assembly. Pair the problem with a corrective action; no vague “something failed”. | Wrap text/actions; use alert/live semantics appropriate to urgency in implementation. |
| Loading | Spinner16, stroke 1.5, label12/18, gap 9; inline version spinner12; source spin800 ms. | Source-derived visual specimen is static on the reference board. | Reduced motion disables animation; announce useful status without repeatedly interrupting. |
| Empty | Source panel min160, padding 24, centered feedback; example uses captured create/import prompt. | **Inferred** composition from local feedback patterns. Tell the person how to start. | Wrap text and keep the next action reachable. |
| Error | Source alert color uses status-danger. Captured validation sentence names the unverified input identity. | **Inferred** composition; it does not claim the solver ran or failed. | Keep error text associated with its field/action; preserve units and exact input. |

Source: [project dialogs](app/secondary-ui.css), [Guide tables/navigation](app/public-pages.css), [feedback](app/workspace-feedback.css), [MD tooltips](app/md-studio.css).

### State rules

- Default communicates the current value/action. Hover supports discovery; it must not be the only way to reach an essential action.
- Focus must remain visible, unobscured and attached to the component when instanced. The extracted shell ring is documented alongside a stronger proposed token.
- Selected describes a persistent choice or current route. Pressed describes a transient pointer/key press; its distinct treatment is proposed where source evidence is absent.
- Disabled is visual documentation plus an implementation state. Explain unavailable actions in nearby text when the reason is useful.
- Error identifies the problem in words. A proposed red border alone is insufficient.
- Hover, focus, pressed, disabled and error do not apply to every passive container. Do not manufacture meaningless variants.

### Adopting a correction

Choose the feature context, verify the source and expected behavior, then make a separate application change. Test keyboard paths, contrast on actual adjacent fills, target hit areas, zoom and the affected viewport widths. Promote a proposal only after that verification. Preserve scientific units, values, provenance and third-party assets throughout.
