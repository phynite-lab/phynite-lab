# Phynite Lab component guidelines

Use native components from the **Design System** page in FigCraft. Start from an instance, keep its source context, and switch its semantic mode for Light or Dark. The original application map remains an editable visual reference, separate from the new reusable library.

Values below are extracted unless marked **inferred** or **proposed**. Specimen widths and explanatory copy are documentation choices, not new product constraints. See [design-system.md](design-system.md) for the audit and [design-tokens.json](design-tokens.json) for values and provenance.

## Working in FigCraft

1. Open **Assets** and choose the required family. The Button, Select, Checkbox and Switch sets expose variant properties.
2. Place an instance. Edit exposed `Label` or `Value` properties where available.
3. Set **Phynite · Semantic → Light / Dark** on the containing frame. Children and instances inherit that mode.
4. Resize basic actions and fields. Their auto layout keeps text and icons aligned. Compound navigation, dialogs and tables retain their documented geometry and need a context-specific layout when resized.
5. Keep proposals separate. A component marked Error or Pressed can demonstrate a recommendation without implying that the application implements it.

The Light & Dark playground contains real instances of the same masters. Use it to check mode inheritance and field resizing. The library is local to this file; it has not been published to an online team library.

## Actions

| Component | Anatomy and dimensions | Typography and appearance | Behavior and use |
| --- | --- | --- | --- |
| Button / Primary | Default min h40, r6, padding8×13, gap8. | Geist13/1.45, 500; neutral accent / on-accent; border1. | Use for the main action. Hover uses accent-strong. Focus uses the source shell ring in the state set. |
| Button / Home | Min h36, r8, padding8×12, gap8. | Geist12; neutral primary treatment. | Use in Home heading actions. Coarse-pointer policy raises target to44. |
| Button / Secondary | Default h40/r6; same alignment as primary. | Surface, ink, line1. | Reversible or supporting action. Hover uses subtle surface and muted border. |
| Button / Quiet | Same control geometry; transparent default border/fill. | Muted text. | Supporting link-like action. Keep its hit area and focus treatment. |
| Button / Danger | Same default geometry; danger text on surface. | Status danger; text states the action. | Destructive action. Confirm only where the existing flow does. Color is not the only cue. |
| Icon button / Home | 36×36, r8, centered16 px icon. | Lucide/currentColor. | Accessible name required; hover/focus must also reveal actions hidden by default. Coarse pointer uses44×44. |

The Button set exposes Tone, State and Size for supported combinations. Default/Hover/Focus use source styling. Disabled action opacity `.5` is an **inferred** convention from existing selects; it is not claimed as a uniform captured button rule. Pressed reuses the hover tone as a **proposed** standard. Not every Cartesian combination is supplied.

Keep focus rings inside the main component tree but outside clipped content, so a Focus variant retains its ring when instanced. Label edits must not collide with icons or shrink the hit area.

Source: [lab actions](app/lab-ui.css), [Home overrides](app/research-shell.css), [touch/density overrides](app/device-preferences.css).

## Fields and selection

| Component | Anatomy and dimensions | States and use | Narrow layout |
| --- | --- | --- | --- |
| Settings input | Min h40, r8, border1, padding10×12, Geist13. | Persistent label outside field; value is editable. Error text must identify a correction. A stronger error border is proposed, not extracted as a universal input rule. | Fill available width; preserve labels. Profile fields use a two-column grid where space permits. |
| Select | Default h40/r6; value inline padding10; actuator32 wide; chevron14. Compact h28, actuator26, value padding8. Compute context can use32 height. | Default/Hover/Focus/Disabled in the native set. Focus currently changes border to line-strong with no outer ring; this is an audited weakness. Error danger border is proposed. | Trigger fills available width. Keep actuator fixed; truncate value visually without losing the accessible full label. |
| Select menu | r9, border1, padding5; default options min h38, r6, internal gap9, padding6×7×6×10, inter-option gap6. Compact options min h30, internal gap8, padding5×8, inter-option gap2. Detail options min h42. | Selected and highlighted options use subtle surface. Disabled trigger opacity.5; disabled option.45. | Menu clamps to viewport/portal; JS chooses above or below; preserve scrolling. |
| Search / Home | Min h38/r8, border1, inline padding10, gap10, icon16. | Placeholder plus input and optional clear action; focus-within uses shell ring. | Touch min44. Avoid losing the clear target or clipping entered text. |
| Textarea / Project | r4, padding10×12, body14/1.5. Captured specimen h94; source min42. | Multiline project description. Height is content/context dependent. | Fill dialog width; keep vertical resizing where the app supports it. |
| Number + unit | Dense h36/r6, number in Geist Mono11, small unit suffix. | `<input>` is a placeholder; no scientific output is supplied. | Keep suffix adjacent to the value. Do not hide units or change settings to fit. |
| Checkbox / Lab | Visual box16×16/r4/border1, label gap9, Geist11/1.35 at500. | Off/On/Focus/Disabled variants; disabled opacity.42. Linked label remains part of the control. | Measure the whole hit target and its spacing, not just the16 px square. |
| Switch / Lab | Track30×17; thumb11 with2 px inset, 13 px travel. | Off/On; slate palette; focus comes from the linked input. | Row can grow while track stays fixed. |
| Switch / Appearance | Track34×21; thumb15; Appearance blue when active. | Off/On; source context differs from lab switch. | Preserve the text-rich row wrapping and touch target. |

Select menus rendered in a body portal use `portal/*` colors from the global scope. Keep these separate from the shell surface roles; the Menus & Overlays board shows both themes.

The select's JS supports arrows, Escape, Tab closure, type-ahead and focus return in source. Verify those paths in the running application, including dialog portals, before claiming keyboard conformance. Disabled controls must remain inoperable in code; a visual opacity variant cannot enforce that.

Source: [UiSelect CSS](components/UiSelect.css), [UiSelect behavior](components/UiSelect.tsx), [settings fields](app/account/settings.css), [lab controls](app/lab-controls.css), [project dialog](app/secondary-ui.css).

## Navigation and containers

| Component | Anatomy | Variants/states and use | Responsive behavior |
| --- | --- | --- | --- |
| Navigation / Rail | Desktop width52; target36/r10; gap8; icon18. | Default, hover, selected and focus follow shell roles. Selected state needs more than a tiny color shift. | At≤960: drawer rail64, target44/r12. |
| Navigation / Settings | Width280; search246×41/r10; item min h40/r9, padding9×10, gap10; label13. | Default and selected specimen items; hover uses contextual surface. Do not infer that all nav families share the same geometry. | Drawer replaces the docked layout at shell breakpoint. |
| Navigation / Editor tabs | Topbar44; tabs r7, internal gap4; ordinary tab max220; close actuator26. | Selected uses raised surface; hover/focus-within reveals close action. Unsaved/close rules belong to the app. | Horizontal scrolling and compact controls. Verify roving focus in runtime. |
| Menu / Home sort | Min width210, r10, padding5, option min34/r5/label12. | Selected sort option, hover/focus treatment. No destructive action is invented in this sort menu. | Max width viewport−40; keep menu inside viewport. |
| Container / Settings group | Border1, r14, surface, content padding24; generic row padding22×24, gap28. | Noninteractive container. Hover/pressed/disabled do not apply to the whole card unless it is actually an action. | Row controls flex around260 px, wrap/stack in settings container≤540. |
| Container / Appearance panel | Border1, r18, canvas, inline17; rows min48 and gap16. | Theme previews and compact controls retain their specific selection states. | Inline13 at narrow container; rich rows wrap; mode previews shrink to74×58. |
| Card / Workflow node | Width230, min h92, padding14/r6; heading13/1.45, 500; footer11. | Selected source uses workflow focus; statuses include ready, failed/blocked and queued/pending. The specimen is “Not run”. | Canvas navigation/zoom handles dense graphs. Do not fabricate populated results for the card. |

The component sidebar is a representative subset, not a replacement navigation tree. The original map remains the reference for all existing menus and routes. Compound component internal layout is fixed where the original map supplies only fixed geometry.

Source: [shell](app/research-shell.css), [settings](app/account/settings.css), [workflow](app/project-workflow.css).

## Dialogs, tables and feedback

| Component | Anatomy and appearance | States/usage | Responsive and interaction requirements |
| --- | --- | --- | --- |
| Dialog / Create project | Width min(480, viewport−32), r6, border1, padding28; heading22; fields r4; footer gap10. | Empty, entered and validation behavior belong to the local flow. The specimen includes editable fields and nested action instances. | Mobile padding22; max height viewport−32. Verify Escape, focus trap, labelled title and focus return. |
| Data / Guide table | Wrapper r3/border1; min width420; text13/1.7; cells13×16 padding; header600, row header500. | Source header, row and hover patterns. Specimen rows describe UI metadata, not research results. | Horizontal overflow; keep headers associated with cells. Numeric result grids require data-specific review. |
| Navigation / Article pagination | Two columns, gap24; top border; top padding26, margin42; label12/title13. | Previous/Next articles. This is not numbered result pagination. | Gap18 in narrow Guide styles; readable labels and arrow targets. |
| Feedback / Tooltip | MD context h28, r5, padding0×10, border1; raised; text12/500; shadow0 8 20 black24%. | Hover and keyboard focus show it. No interactive content inside a tooltip. | Must not obscure the focused control; check dismissal/persistence behavior in runtime. |
| Status badge | Dot6 + gap5 + text12/1.5. | Ready/Pending/Blocked specimens demonstrate semantic color and a word. They do not assert actual run states. | Keep label visible; never rely on dot color alone. |
| Validation notice | Example assembly uses notice padding14×16/r10 and captured local validation text. | **Inferred** assembly. Pair the problem with a corrective action; no vague “something failed”. | Wrap text/actions; use alert/live semantics appropriate to urgency in implementation. |
| Loading | Spinner16, stroke1.5, label12/18, gap9; inline version spinner12; source spin800 ms. | Source-derived visual specimen is static on the reference board. | Reduced motion disables animation; announce useful status without repeatedly interrupting. |
| Empty | Source panel min160, padding24, centered feedback; example uses captured create/import prompt. | **Inferred** composition from local feedback patterns. Tell the person how to start. | Wrap text and keep the next action reachable. |
| Error | Source alert color uses status-danger. Captured validation sentence names the unverified input identity. | **Inferred** composition; it does not claim the solver ran or failed. | Keep error text associated with its field/action; preserve units and exact input. |

Source: [project dialogs](app/secondary-ui.css), [Guide tables/navigation](app/public-pages.css), [feedback](app/workspace-feedback.css), [MD tooltips](app/md-studio.css).

## State rules

- Default communicates the current value/action. Hover supports discovery; it must not be the only way to reach an essential action.
- Focus must remain visible, unobscured and attached to the component when instanced. The extracted shell ring is documented alongside a stronger proposed token.
- Selected describes a persistent choice or current route. Pressed describes a transient pointer/key press; its distinct treatment is proposed where source evidence is absent.
- Disabled is visual documentation plus an implementation state. Explain unavailable actions in nearby text when the reason is useful.
- Error identifies the problem in words. A proposed red border alone is insufficient.
- Hover, focus, pressed, disabled and error do not apply to every passive container. Do not manufacture meaningless variants.

## Adopting a correction

Choose the feature context, verify the source and expected behavior, then make a separate application change. Test keyboard paths, contrast on actual adjacent fills, target hit areas, zoom and the affected viewport widths. Promote a proposal only after that verification. Preserve scientific units, values, provenance and third-party assets throughout.
