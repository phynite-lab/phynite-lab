import { localComputeGuide } from './guide-local-compute.ts';
export type GuideBlock = {
  title: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
  table?: { headings: string[]; rows: string[][] };
  code?: string;
  note?: string;
  links?: { label: string; href: string }[];
  visuals?: GuideVisual[];
};
export type GuideVisual = {
  kind: 'screenshot' | 'diagram' | 'icon';
  src: string;
  alt: string;
  caption?: string;
  lightSrc?: string;
  darkSrc?: string;
  width?: number;
  height?: number;
  mobileSrc?: string;
  mobileWidth?: number;
  mobileHeight?: number;
};
export type GuideSection = { id: string; group: string; title: string; intro: string; blocks: GuideBlock[] };

export const guideSections: GuideSection[] = [
  {
    id: 'workflow', group: 'Start here', title: 'From structure to a paper figure',
    intro: 'A project is the container for a material study. It connects structures, calculation setups, execution records, numerical datasets, and reusable figures. Start with the physical question, then choose the calculations and comparisons that answer it.',
    blocks: [
      { title: 'Your first complete workflow', steps: [
        'Open the local application without login, or sign in when using the hosted website. Workspace contains projects and research tools; local identity is independent from optional Phynite Cloud login.',
        'In Workspace, choose New project and enter a meaningful name such as Silicon convergence or MoS2 strain study. Open the project to continue in DFT Lab.',
        'Add a structure by importing a file, building a cell, or using Materials Project. Check units, lattice vectors, species, and atom count before calculating.',
        'Inspect the real-space structure. Choose periodic directions for the physical model; add vacuum explicitly where an isolated slab, wire, or molecule needs it.',
        'Open Calculate and add a Total energy or Structural relaxation setup. Review the generated inputs, occupation policy, pseudopotentials, cutoffs, and k-point mesh.',
        'Choose the compute destination. The npm app uses runtimes installed in Settings → Compute for Your computer; the hosted website uses a paired personal worker. Optional Phynite Cloud uses available paid Quanta or pilot grants and a supported CPU/RAM profile.',
        'Run the setup and follow its execution log. A completed process is not automatically a converged or scientifically adequate result: inspect energy, convergence, forces, and messages.',
        'Add band structure, DOS, phonon, or transport calculations as required. Use a completed compatible relaxation as a structure source when appropriate.',
        'Choose Open in Figure Lab on a completed plottable run. Its existing figure reopens, or its numerical data creates a new figure automatically.',
        'Compose comparisons, set scientific alignment, tune physical dimensions and typography, then export the figure and a Source package. Check the actual save status. A local save stays on this computer; another device needs an exported copy or explicitly enabled, confirmed Cloud Sync.',
      ] },
      { title: 'A useful division of work', table: { headings: ['Place', 'What belongs here'], rows: [
        ['Workspace', 'Choose a study, find recent projects, compare plans, open tools.'],
        ['DFT Lab / Project', 'Organize projects and structures.'], ['DFT Lab / Inspect', 'Prepare geometry and check the physical system.'],
        ['DFT Lab / Calculate', 'Configure calculations, select dependencies, run, and inspect execution.'],
        ['Figure Lab', 'Reuse numerical data, compare results, style and export publication figures.'],
        ['Settings', 'Separate appearance, notifications, keyboard, compute, AI provider accounts, Account, Usage, and Storage pages.'],
        ['Billing', 'Cloud purchases and invoices on the Phynite website; local mode opens the hosted site.'],
      ] } },
      { title: 'Before calling a result final', bullets: ['Record the source structure and computational cell used by every run.', 'Converge the quantities you will report against relevant cutoffs, k/q meshes, vacuum, smearing, and solver thresholds.', 'Check energy units and references before overlaying results.', 'Keep the exact inputs and numerical source package alongside the exported figure.', 'Describe the method, pseudopotential family, exchange-correlation functional, spin treatment, and normalization in the paper.'] },
    ],
  },
  {
    id: 'project', group: 'Start here', title: 'Projects, structures, and calculation records',
    intro: 'Use one project for a coherent study, then keep material variants as separate named structures within it. A calculation setup is editable; each execution is a historical record of a submitted input.',
    blocks: [
      { title: 'Organize a study', steps: ['In Workspace, choose New project, enter a name (up to 100 characters) and optional description (up to 500 characters), then choose Create project. The Project panel in DFT Lab provides another creation route.', 'Name it by question or dataset: strain response, alloy comparison, or convergence study.', 'Add structures and give variants explicit names, such as MoS2 strain -2 percent, 0 percent, and +2 percent.', 'Add the relevant calculation stack under each structure. Duplicate a setup when the same method should be reused.', 'Use project or structure menus for rename and duplicate. Read the confirmation before deleting anything.'] },
      { title: 'Understand the identities', paragraphs: ['A local structure, its uploaded cloud structure, and a submitted calculation are linked but distinct records. Editing the current structure does not rewrite a completed calculation.', 'A figure references immutable numerical datasets. Replacing data in a figure is an explicit action; changing a setup or source metadata does not silently alter existing published comparisons.'], note: 'The visual supercell repeat is a preview. Increasing the displayed repeats does not automatically submit a larger computational supercell.' },
      { title: 'Find and reopen work', bullets: ['Workspace searches project names, descriptions, and the primary chemical formula.', 'Click Name, Activity, or Last edited to sort the project list; click again to reverse the direction. Open a row to resume its DFT Lab workspace.', 'The URL preserves project and Figure Lab view. Browser Back/Forward returns to that view after the account workspace loads.', 'An unavailable project link does not open an unrelated project figure. Select an existing project or restore the intended data.'] },
      { title: 'Open an older project', paragraphs: ['Older local project links are recognized and migrated into the current Canvas only when the destination has no saved revision. Exact legacy configurations and run history are retained; an existing Canvas revision is not overwritten.', 'If the workflow service or linked project is unavailable, a verified local copy can open in the original editor. Other opening failures keep their error and may offer Open original editor when a matching local copy exists. Do not clear browser data as a troubleshooting step; export a backup of important research before further recovery.'] },
    ],
  },
  {
    id: 'structure', group: 'Projects & structures', title: 'Import and inspect a structure',
    intro: 'DFT Lab shows direct, real space: lattice vectors and atoms. Reciprocal-space k-points and band paths belong to calculation configuration and result interpretation.',
    blocks: [
      { title: 'Choose an input route', table: { headings: ['Route', 'What to check'], rows: [
        ['New structure', 'Set the cell lengths and angles, species, and atom positions explicitly.'],
        ['CIF', 'Check occupancies, disorder, fractional coordinates, and whether the intended cell is primitive or conventional.'],
        ['POSCAR / VASP', 'Verify the scale factor, element ordering, and Direct versus Cartesian positions.'],
        ['XSF / XYZ / PDB', 'Confirm that the file contains a usable simulation cell; isolated coordinates alone do not define periodicity.'],
        ['Quantum ESPRESSO input/output', 'Check the imported cell and whether the positions correspond to the intended ionic step.'],
        ['Materials Project', 'Inspect source identity, composition, cell convention, and the suitability of the database structure for your question.'],
      ] } },
      { title: 'Import a file', steps: ['Select the destination project.', 'Use Add structure / Import, or drop one supported structure file into the workspace.', 'Inspect the structure record, formula, number of atoms, and cell.', 'Rotate and repeat the cell visually to find misplaced atoms or unexpected neighbors.', 'Resolve parser warnings or partial occupancies before using the model for an ordered QE calculation.'] },
      { title: 'Search a crystal database', paragraphs: ['Open or add a Crystal structure module, then choose Crystal database inside its editor to search public structure records. Crystallography Open Database (COD) works without an API key. In the local app, Materials Project uses your API key from Settings → Compute → Materials Project. Search uses the provider shown in the browser, and a provider failure stays visible.', 'Save the key in Settings → Compute → Materials Project and test the connection. Manual searches and AI crystal tools use it immediately. The native service uses the OS credential store when available; a Session only label means the key must be entered again after restarting. Keep the key out of browser storage, project exports, logs, and chat. Select and import the intended record, then inspect its formula, lattice, atom count, occupancies, and source identity. Database structures are starting models, not proof that a phase, magnetic state, or calculation setup is appropriate. Unreported numerical properties remain unavailable.'], steps: ['Open the destination Crystal structure module and choose Crystal database from its editor toolbar.', 'Choose the database and enter a chemical formula, element list, material name, or supported source ID.', 'Review the results and import one selected structure into that module. The Canvas connections and module identity remain in place.', 'For an AI-assisted import, ask Phynite AI to search the database and use a specific record. Search is read-only; applying an import follows the conversation permission mode and its action review.', 'Read the imported source identity and checksum. Check the geometry and pseudopotentials before connecting the structure to a calculation.'], note: 'Database access needs an internet connection. Materials Project credentials stay server-side and outside project exports and Cloud Sync. An optional MP_API_KEY environment value is used only when no Settings key is saved. Never paste an API key into chat or include it in a project export. If a real key was exposed, revoke it and create a replacement.', links: [{ label: 'Crystallography Open Database', href: 'https://www.crystallography.net/cod/' }, { label: 'Materials Project documentation', href: 'https://docs.materialsproject.org/' }] },
      { title: 'Fractional and Cartesian coordinates', paragraphs: ['Fractional coordinates locate an atom by a combination of the cell vectors: r = f1 a + f2 b + f3 c. Cartesian coordinates specify x, y, and z in a length unit. A value of 0.5 in a fractional field is half a lattice vector, not half an angstrom.', 'For tilted cells, cell length and perpendicular vacuum thickness are different. Check the full cell geometry instead of assuming the c vector points along the Cartesian z axis.'], note: 'Neighbor lines are distance-based coordination guides, not calculated chemical bond orders. Their cutoff and display cap can hide or include neighbors without changing the scientific structure.' },
    ],
  },
  {
    id: 'edit', group: 'Projects & structures', title: 'Edit atoms and cell geometry',
    intro: 'Select, move, add, substitute, delete, and measure atoms in the viewport. Keep geometry changes deliberate and inspect the result before rerunning a calculation.',
    blocks: [
      { title: 'Atom tools', table: { headings: ['Tool', 'Use'], rows: [
        ['Select (V)', 'Select an atom and inspect its properties.'], ['Move (G)', 'Move a selection; choose an axis or plane, then apply or cancel the move.'],
        ['Add atom (A)', 'Open the element selection flow and place the intended species.'], ['Measure (M)', 'Select the atoms required by the distance or angle mode.'],
        ['Focus (F)', 'Center the viewport on the selected atom.'], ['Delete / Backspace', 'Delete the selected atom when the viewport has focus.'],
      ] } },
      { title: 'Constrained movement', paragraphs: ['In Move mode, X, Y, or Z constrains motion to that Cartesian axis. Shift+X, Shift+Y, or Shift+Z uses the perpendicular YZ, XZ, or XY plane. Enter applies the move; Escape cancels it.', 'Use coordinate fields when you need an exact displacement. Numeric editors allow an intermediate draft such as a minus sign or exponent; commit with Enter or by leaving the field. Escape restores the previous value.'] },
      { title: 'Cell edits and visual appearance', bullets: ['Cell metric edits change the actual lattice. Inspect whether the resulting geometry represents the strain or model you intend.', 'The vacuum action increases separation normal to the a-b plane and preserves Cartesian atomic distances; it is not a general arbitrary-axis slab builder.', 'Atom size, bond size, labels, neighbor cutoff, and displayed repeat count affect visualization.', 'Undo/redo applies to supported editor actions in the current editing session. Keep explicit structure copies for scientific variants you want to retain permanently.'] },
    ],
  },
  {
    id: 'periodicity', group: 'Projects & structures', title: 'Periodic directions, vacuum, and dimensionality',
    intro: 'Quantum ESPRESSO solves a periodically repeated three-dimensional simulation cell. Slabs and low-dimensional systems are configured via vacuum and k-point sampling in calculations.',
    blocks: [
      { title: 'Supercells, slabs, and vacuum', paragraphs: ['Cell repetition in the viewer allows inspecting extended lattices without modifying the underlying unit cell. Slabs and low-dimensional structures are constructed by explicitly introducing vacuum along the desired non-periodic direction (typically c).', 'Quantum ESPRESSO always assumes periodic boundary conditions in 3D: for a slab or 2D material, maintain sufficient vacuum separation between periodic replicas, set a single k-point along the vacuum direction (e.g. N × M × 1), and configure appropriate dipole/electrostatic corrections.'], note: 'For a slab, keep a finite simulation-cell height, add and converge vacuum explicitly, use a single k-point in the nonperiodic direction, and choose a suitable electrostatic treatment in the actual QE input.' },
      { title: 'Common systems', table: { headings: ['System', 'Display repetition', 'Computational checks'], rows: [
        ['Bulk crystal', '2 × 2 × 2', 'Converge a three-dimensional k mesh; use the intended primitive or conventional cell.'],
        ['Slab / 2D sheet in a-b plane', '2 × 2 × 1', 'Converge perpendicular vacuum and in-plane k mesh; usually one k-point along c. Review dipole or 2D isolation treatment when appropriate.'],
        ['Wire along c', '1 × 1 × 2', 'Converge vacuum in both transverse directions and sampling along the wire. The built-in c-vacuum action alone does not prepare this geometry.'],
        ['Molecule / cluster', '1 × 1 × 1', 'Use a sufficiently large 3D box; typically Gamma-only sampling. Check charged-system and dipole treatment as needed.'],
      ] } },
      { title: 'A reproducible slab check', steps: ['Orient the slab so its surface lies in the a-b plane.', 'Add vacuum along c and inspect the actual cell and positions.', 'Set cell repetition to 2 × 2 × 1 to inspect the in-plane extended surface without repeating along the vacuum direction.', 'Set the k mesh to N by M by 1; choose N and M through convergence.', 'Inspect generated or expert input for the appropriate electrostatic setup.', 'Repeat with larger vacuum and denser in-plane sampling until the target quantity is stable.'], note: 'A rendering choice is not proof that a model is physically isolated. Verify the executed input and convergence results.' },
    ],
  },
  {
    id: 'calculation', group: 'QE & DFT', title: 'Choose and connect calculations',
    intro: 'The Calculate panel separates DFT setups, the execution log, and reusable configurations. Select the scientific task first; the generated workflow then creates the required solver stages.',
    blocks: [
      { title: 'Available workflows', table: { headings: ['Calculation', 'Purpose', 'Main tools'], rows: [
        ['Total energy', 'SCF electronic ground state and energy.', 'pw.x'], ['Structural relaxation', 'Optimize ions; optionally optimize permitted cell degrees of freedom.', 'pw.x relax / vc-relax'],
        ['Band structure', 'Sample eigenvalues along a specified reciprocal-space path.', 'pw.x + bands.x'], ['Density of states', 'Sample a uniform mesh for a DOS and optional projections.', 'pw.x + dos.x / projection inputs'],
        ['Phonon dispersion', 'DFPT and real-space force constants, then a phonon path.', 'ph.x + q2r.x + matdyn.x'], ['Thermoelectric properties', 'Interpolated electronic bands and semiclassical transport.', 'QE + BoltzTraP2'],
      ] } },
      { title: 'Build a calculation stack', steps: ['Select a structure and open Calculate / DFT.', 'Choose Add calculation and select the task.', 'Configure the setup and inspect its input files.', 'For a calculation that should use a relaxed structure, select the appropriate structure source.', 'Run one calculation, Run selected, or Run all. Required predecessors can be submitted first and reused when compatible.', 'Inspect each individual run in Log; a dependency may keep a downstream job queued.'] },
      { title: 'Dependencies and reruns', paragraphs: ['A downstream job waits until its declared prerequisites have completed. Reuse is based on compatible execution records, not merely a similar display name.', 'Changing a structure, functional, charge, spin state, or cutoff may invalidate scientific reuse. If in doubt, create a new run and retain the old one as a comparison.', 'Save selected stores the calculation configurations for reuse. It does not execute a solver. Figure Lab has its own automatic save flow and does not require a Save revision button.'] },
    ],
  },
  {
    id: 'configure', group: 'QE & DFT', title: 'Configure and validate Quantum ESPRESSO',
    intro: 'Smart defaults provide a starting point. They do not replace a convergence study or knowledge of the material. Generated inputs and expert raw input have different responsibilities.',
    blocks: [
      { title: 'Core choices', table: { headings: ['Setting', 'Meaning', 'Check before running'], rows: [
        ['Functional', 'Exchange-correlation approximation.', 'Use pseudopotentials and a solver workflow compatible with it; UI selection alone does not establish method support for every advanced case.'],
        ['ecutwfc / ecutrho', 'Plane-wave wavefunction and charge-density cutoffs.', 'Converge the reported energy, forces, stress, or response; respect pseudopotential recommendations.'],
        ['k-point mesh', 'Sampling for Brillouin-zone integration.', 'Use a uniform mesh for SCF/DOS; do not substitute a high-symmetry band path.'],
        ['Occupations / smearing', 'How electronic states are filled and integrated.', 'Match metallic, insulating, spin, and temperature assumptions.'],
        ['nbnd', 'Number of computed bands.', 'Include enough unoccupied states for the target energy window or transport analysis.'],
        ['SCF thresholds / mixing', 'Self-consistency stopping and iteration behavior.', 'Inspect convergence; raising the iteration limit does not fix every physical or numerical instability.'],
        ['Charge / magnetization / spin', 'Electronic state assumptions.', 'Use compatible pseudopotentials and a justified reference state.'],
      ] } },
      { title: 'Adaptive and expert modes', paragraphs: ['Adaptive mode resolves editable occupation and cutoff defaults from the workflow and material context. User overrides remain explicit.', 'Expert raw input is authoritative for the submitted text. Adaptive occupation and cutoff resolution does not silently rewrite it. You take responsibility for compatible cards, paths, species, units, and solver options.', 'Review the executed input from the result artifacts, not only an earlier editor preview. The worker may resolve required runtime data such as pseudopotential provenance.'] },
      { title: 'Convergence example', steps: ['Fix one structure and method; create a baseline Total energy calculation.', 'Vary ecutwfc and the compatible ecutrho while keeping the k mesh fixed.', 'Track energy per atom and, when relevant, forces or stress instead of only total cell energy.', 'Choose a sufficient cutoff, then vary the k mesh.', 'For low-dimensional systems, repeat the vacuum check independently.', 'Record the tolerance used to call the reported quantity converged.'], note: 'Preset names such as Fast, Balanced, and High accuracy are setup conveniences. They are not certificates of publication accuracy.' },
    ],
  },
  {
    id: 'execution', group: 'QE & DFT', title: 'Execution, resources, and cancellation',
    intro: 'A run moves through preparation, queueing, execution, result persistence, and completion. Native results are saved locally; hosted jobs also upload required artifacts. The log identifies the stage that needs attention.',
    blocks: [
      { title: 'Read the run state', table: { headings: ['State', 'Meaning', 'Next action'], rows: [
        ['Draft / Ready', 'Configuration exists; no active solver is implied.', 'Review input and run when ready.'],
        ['Queued', 'Waiting for a worker or a dependency.', 'Check the selected destination, its connection, and prerequisite jobs.'],
        ['Running', 'The worker has claimed the job.', 'Inspect stage, log tail, and resource details; allow time for expensive stages.'],
        ['Completed', 'The required result was saved and accepted locally or by the hosted service.', 'Inspect convergence and scientific validity, then open results.'],
        ['Failed', 'Preparation, execution, local persistence, or hosted upload failed.', 'Read the reason and solver log before retrying.'],
        ['Cancellation requested', 'A running job is being asked to stop.', 'Wait for the worker heartbeat and terminal status.'],
        ['Cancelled', 'The run was stopped or removed from the queue.', 'Retain useful logs; start a new run if needed.'],
      ] } },
      { title: 'What cores and RAM mean', paragraphs: ['Recorded cores are allocated vCPUs or worker processes, and RAM is the configured job budget. These are different from actual utilization or installed physical memory. A native memory watchdog is a monitored budget, not an operating-system hard limit.', 'Expand resource details in the execution log to inspect reported backend allocation, elapsed time, MPI processes, and QE memory or timing estimates when available. Missing historical data is shown as not reported.', 'Native jobs follow the local scheduler capacity configured in Settings → Compute. Hosted personal workers also follow service-side job limits. Unsupported requests are rejected instead of silently changing scientific inputs.'] },
      { title: 'Cancel intentionally', bullets: ['A queued local job can be removed from the queue.', 'Cancellation is asynchronous. The local process supervisor or hosted worker acknowledges it before the job reaches a final state.', 'Closing the browser does not cancel a submitted calculation. Keep the native CLI or hosted worker running; inspect interrupted jobs after a restart rather than resubmitting blindly.', 'Disconnecting a personal credential revokes access and may interrupt upload; use the calculation cancellation action before replacing a credential during an active run.'] },
    ],
  },
  {
    id: 'results', group: 'Results & Figure Lab', title: 'Open and interpret calculation results',
    intro: 'Use the log for execution evidence and downloads. Use Figure Lab for plot editing, comparisons, layout, and publication export.',
    blocks: [
      { title: 'Open a result directly', steps: ['Find the completed run in Log.', 'Inspect its convergence message and recorded numerical summary.', 'Choose Open in Figure Lab when the result contains plottable data.', 'The most recently edited active figure using that run reopens. If none exists, Figure Lab imports the numerical source and prepares a figure.', 'If a retained source cannot be loaded, use Retry, check source availability, or import your original numerical file.'] },
      { title: 'Distinguish numerical data from a preview', paragraphs: ['A PNG preview is a rendered image. Numerical datasets preserve samples and metadata that allow future restyling, alignment, and export.', 'New supported calculation outputs retain a compact research dataset separately from temporary raw-artifact access. Older runs without retained data may require original CSV/text files or a new run.', 'Hosted temporary artifact links can expire; storage lifecycle cleanup is configured separately. An expired link does not prove that a retained research dataset is lost. Native project data stays in the configured workspace; export important inputs and results independently.'] },
      { title: 'Read physical claims carefully', bullets: ['A band gap estimate requires meaningful occupations or an energy reference. Unknown reference data must not be treated as zero Fermi energy.', 'DOS normalization must refer to the actual computational cell, atoms, formula units, or volume.', 'Phonon imaginary frequencies can reflect an instability or incomplete convergence; inspect the model and method.', 'Transport results depend on interpolation, sampling, temperature, chemical-potential conventions, and the relaxation-time model. Conductivity divided by relaxation time is not an absolute conductivity unless a justified time is supplied.'] },
    ],
  },
  {
    id: 'figures', group: 'Results & Figure Lab', title: 'Compose a figure',
    intro: 'Figure Lab uses a results library on the left, the publication page in the center, and an inspector on the right. On smaller screens, Results and Inspector become drawers.',
    blocks: [
      { title: 'Choose a layout', table: { headings: ['Layout', 'Best use', 'Check'], rows: [
        ['Single plot', 'One result, one message.', 'Quantity, axes, units, and title.'], ['Overlay', 'Several curves sharing a comparable physical coordinate.', 'Path compatibility, alignment, normalization, and readable legends.'],
        ['One panel per result', 'Different materials or results needing independent panels.', 'Consistent dimensions and a fair common range where justified.'],
        ['Band + DOS pairs', 'Dispersion beside corresponding density of states.', 'Matching geometry/electronic identity and energy convention.'],
        ['Parameter series', 'Ordered strain, pressure, temperature, or other variants.', 'Matching parameter name and unit plus numerical values.'],
      ] } },
      { title: 'Build the page', steps: ['Select completed results from the active project and import their numerical datasets.', 'Search the library and select the datasets you want to compare.', 'Choose a layout. A dataset can appear in multiple figures without changing its original samples.', 'Set figure width and height in millimeters. Choose a one-column or two-column size appropriate to the target journal.', 'Select a panel in the canvas or inspector. Adjust ranges, panel span, order, legend, and linked axes.', 'Use Data controls to name layers, choose channels, replace sources, and set colors and line styles.', 'Review scientific context notes, let the cloud save finish, then export.'] },
      { title: 'Canvas interaction', paragraphs: ['Use + and - to enlarge or reduce the page view; 0 or Fit returns it to the available canvas area. The zoom range is 25 to 400 percent relative to the fitted view.', 'Space+drag, Alt+drag, or middle-button drag pans an enlarged canvas. Ctrl/Cmd+wheel zooms. Clicking a plotted panel selects it for inspection.', 'Canvas zoom does not change the exported dimensions, axis limits, or numerical values. To change the plotted range, use panel minimum and maximum fields.'], note: 'Curve strokes and markers are clipped to the axis rectangle. A Γ label denotes the Brillouin-zone center; original source metadata is retained.' },
    ],
  },
  {
    id: 'alignment', group: 'Results & Figure Lab', title: 'Energy, k-path, DOS, and fair comparison',
    intro: 'A comparison can look tidy while mixing incompatible physical references. Establish the meaning of each axis before adjusting its appearance.',
    blocks: [
      { title: 'Energy alignment', table: { headings: ['Mode', 'Meaning', 'Appropriate interpretation'], rows: [
        ['Source energy', 'Keep the numerical reference as imported.', 'Use only when source conventions are understood.'],
        ['Each Fermi = 0', 'Shift every dataset by its own recorded Fermi level.', 'Compare dispersion shapes relative to each electronic chemical potential; not absolute band offsets.'],
        ['Each VBM = 0', 'Shift by a recorded valence-band maximum.', 'Compare band-edge-relative features when the VBM is meaningful.'],
        ['Vacuum alignment', 'Use a recorded vacuum reference.', 'A common-reference comparison when vacuum levels are physically justified.'],
        ['Manual shift', 'Apply a stated explicit energy offset.', 'Use a documented alignment procedure and retain the chosen offset.'],
      ] } },
      { title: 'Band + DOS', paragraphs: ['A verified pair requires matching recorded geometry and electronic source identity, along with compatible Fermi-relative data. A matching filename or material formula alone is insufficient.', 'The paired layout gives band and DOS panels a shared physical vertical energy axis, typically in a 2:1 width ratio. Adjusting a linked energy bound updates both panels.', 'Replacing one source with an unrelated calculation invalidates the verified-pair claim. Use ordinary comparison panels when sources are intentionally different.'] },
      { title: 'K-path compatibility', paragraphs: ['The labels Γ, X, or K are not enough to establish the same reciprocal coordinate. Cell basis, path endpoints, and segment coordinates matter.', 'Physical path comparisons require compatible source geometry and coordinates. Segment normalization can align corresponding endpoints when the required metadata exists, but changes the displayed horizontal scale.', 'Disconnected branches must remain separated by gaps. Do not connect their endpoints into a fictitious continuous band.'] },
      { title: 'DOS normalization and spin', bullets: ['Per-cell DOS is the default meaning of many QE outputs. Do not silently label it per atom.', 'Per-atom normalization needs a verified atom count; per-formula-unit normalization needs the formula-unit count; per-volume normalization needs a valid cell volume.', 'Spin-down mirroring reflects a channel visually to distinguish it. It does not make physical DOS negative.', 'Inspect whether a channel is total DOS, an orbital/atom projection, or an arbitrary imported column. Channel names should state the actual meaning.'] },
    ],
  },
  {
    id: 'studies', group: 'Results & Figure Lab', title: 'Workflows for material and parameter studies',
    intro: 'Choose a layout according to the scientific comparison, then reuse a stable style. Avoid forcing every result into one dense overlay.',
    blocks: [
      { title: 'Several materials in one paper', steps: ['Place the structures in one study project, with clear source names.', 'Use a method whose differences and approximations are documented consistently.', 'Run the appropriate band or DOS calculations for each material.', 'Use a grid for incompatible k-paths or very different energy scales. Use an overlay only when coordinates and references support it.', 'Name layers by material, use a small deliberate color set, and label energy references explicitly.', 'Save the layout as a template for subsequent materials.'] },
      { title: 'One material at several strains', steps: ['Duplicate the baseline structure before applying each strain.', 'Record whether the strain is uniaxial, biaxial, volumetric, or another tensor deformation; a single percent label does not encode the full tensor.', 'Use consistent relaxation constraints and electronic settings across variants.', 'For each imported dataset, record the same condition parameter name and unit plus its numerical value.', 'Choose Parameter series to order panels numerically, including negative strain values.', 'Compare the relevant quantities using a justified energy reference and explain any path normalization.'] },
      { title: 'Band structure next to DOS', steps: ['Use compatible geometry and electronic assumptions for the two calculations.', 'Load both numerical datasets in Figure Lab.', 'Choose Band + DOS pairs and inspect the compatibility notes.', 'Set a common vertical energy interval and verify the zero reference.', 'Tune line density and DOS horizontal range without distorting the shared energy scale.', 'Export a vector figure and retain its Source package.'] },
      { title: 'Convergence or temperature series', paragraphs: ['Use a generic numerical dataset for derived quantities such as energy per atom versus cutoff, or a quantity-specific transport dataset when available.', 'Record the parameter and unit explicitly. Keep error estimates and method assumptions in the caption or source metadata rather than implying precision from extra decimal places.', 'A figure template helps keep sizes and typography stable across the paper, while each dataset retains its own provenance.'] },
    ],
  },
  {
    id: 'reuse', group: 'Results & Figure Lab', title: 'Templates, replacement, history, and archives',
    intro: 'Reuse a visual method without losing the identity of the numerical sources. Templates describe a layout; figures bind that layout to concrete datasets.',
    blocks: [
      { title: 'Reuse a template', steps: ['Finish the layout, typography, panel arrangement, and layer style of an example figure.', 'Save it as a template. Source bindings become reusable slots.', 'Select replacement datasets in slot order and apply the template.', 'Inspect the rebound titles, quantities, and channel choices.', 'Edit custom captions explicitly; a template cannot know the new scientific conclusion.'] },
      { title: 'Replace a dataset without starting over', paragraphs: ['Use Replace source on the selected layer. Color, line style, and compatible channel settings are preserved. Automatically generated titles follow the replacement; custom text remains editable.', 'Editing source metadata creates a new dataset identity. Existing figures retain their original source until you explicitly replace it.', 'An inset can reuse the same source slot with independent bounds. It does not require copying or resampling the raw data.'] },
      { title: 'Undo, checkpoints, and cloud conflicts', bullets: ['Undo/redo covers up to 50 editing steps in the current Figure Lab session.', 'Routine edits save automatically; an optional Ctrl/Cmd+S keeps a deliberate checkpoint in History.', 'Automatic edits replace a working copy instead of creating endless permanent revisions.', 'History lets you inspect and restore saved versions. Restoration creates an editable current figure.', 'If another tab or device changes the cloud revision, automatic overwrite stops. Review the local and cloud versions in History before choosing the intended one.'] },
      { title: 'Archives and other projects', paragraphs: ['Archive hides a saved figure from the active list and allows Restore. Archiving is not deletion and does not free its retained history allowance.', 'Include other projects exposes your own datasets from other studies. It does not grant access to another account.', 'Importing a Source package copies the figure and its sources into the selected project, with source hashes checked where available.'] },
    ],
  },
  {
    id: 'advanced', group: 'Results & Figure Lab', title: 'PDOS, unfolding, and insets',
    intro: 'Advanced imports expose the information actually present in the file. They do not infer a missing orbital identity, calculate unfolding from ordinary eigenvalues, or establish a physical reference automatically.',
    blocks: [
      { title: 'Projected DOS columns', paragraphs: ['Import a text or CSV file using Projected DOS columns. The first numerical column is energy and subsequent columns are projections. Name the channels by their true atom/orbital/spin identity.', 'Choose visible channels and style them in Data. Record the energy unit and reference, and use normalization only when the computational-cell basis is known.'], code: '# energy_eV  site_1_s  site_1_p\n-1.0  0.20  0.05\n 0.0  0.00  0.00\n 1.0  0.10  0.30', note: 'These values illustrate the file shape; they are not scientific results.' },
      { title: 'Precomputed unfolded weights', paragraphs: ['Use an unfolded-data import for k coordinate, energy, and nonnegative spectral weight. The plot represents the supplied weights as weighted samples.', 'Ordinary band energies do not contain enough information to derive unfolding weights. Compute the spectral weights with an appropriate external method first.'], code: '# k  energy_eV  weight\n0.0 -1.0 0.10\n0.0  1.0 0.95\n1.0  0.5 0.40' },
      { title: 'Insets', steps: ['Select a panel and enable an inset.', 'Choose the intended source and bounds for the magnified region.', 'Set its position and size so it does not cover important data or axis labels.', 'Check readability at final publication size, not only while zoomed in.', 'Keep the inset reference and units consistent with the main panel or explain the difference.'] },
    ],
  },
  {
    id: 'export', group: 'Results & Figure Lab', title: 'Export and preserve a reproducible figure',
    intro: 'Set the intended physical size before exporting. A source package preserves numerical and visual provenance; a rendered image alone does not.',
    blocks: [
      { title: 'Choose an output', table: { headings: ['Format', 'Use', 'Properties'], rows: [
        ['SVG', 'Vector editing and web publication.', 'Vector paths; preserve the supplied font information.'], ['PDF', 'Paper submission and document layout.', 'Vector output with selectable text and embedded publication fonts.'],
        ['PNG', 'Raster workflows, slides, previews.', 'Pixel dimensions derive from physical millimeters and DPI; up to 40 megapixels.'],
        ['Source package', 'Archive, handoff, and later re-editing.', 'Figure JSON, used datasets, SVG, font license, source identity, and checksums.'],
      ] } },
      { title: 'Practical export checklist', steps: ['Use the journal column width as the starting size; 85 mm and 180 mm are common examples, not universal requirements.', 'Set type in points and check axes, legends, and panel letters at final size.', 'Verify min/max bounds, clipping, units, Γ labels, and energy reference.', 'Choose SVG or PDF for line art when the target supports vector output.', 'For PNG, choose an appropriate DPI and inspect the resulting dimensions.', 'Download the Source package and retain it with executed inputs and method notes.'] },
      { title: 'Fidelity and limitations', paragraphs: ['The renderer preserves all line vertices. Alignment, normalization, color, and mirrored spin display are transformations on the view, while original numerical samples remain in the dataset.', 'Publication fonts must be available from the frontend or browser cache. Export reports a failure when a required resource cannot be loaded; retry online.', 'A Source package can reproduce the figure. Rerunning a simulation also requires the computational environment, compatible pseudopotentials, complete inputs, and any required intermediate data.'] },
    ],
  },
  {
    id: 'saving', group: 'Phynite Cloud', title: 'Autosave, storage, and multiple devices',
    intro: 'DFT Lab and Figure Lab show save status for the active context. The npm app stores projects in SQLite/filesystem; browser storage holds recoverable drafts. Local projects do not upload automatically and have no fixed 10 GiB quota. The cloud save states below apply to the hosted website or a project with explicitly enabled Cloud Sync.',
    blocks: [
      { title: 'Save states', table: { headings: ['Label', 'Meaning', 'What to do'], rows: [
        ['Saving...', 'A local draft or cloud synchronization is in progress.', 'Keep working; allow a short pause before relying on another device.'],
        ['Saved to cloud', 'The current figure and its required datasets, or workspace snapshot, are confirmed remotely.', 'You can reopen the saved work with the same account.'],
        ['Saved on device / Offline', 'A browser copy exists; cloud upload has not completed.', 'Keep browser data intact and reconnect.'],
        ['Sync pending', 'The local copy is retained while upload retries.', 'Check network access and storage limits.'],
        ['Sync conflict', 'The remote revision differs from the one being edited.', 'Review the versions in History; avoid blindly overwriting another device.'],
      ] } },
      { title: 'Local storage and research archives', paragraphs: ['The local workspace defaults to ~/.phynite-lab and can be moved with phynite-lab --data-dir /path/to/workspace. SQLite stores metadata while the filesystem stores project artifacts. Settings → Storage measures inventoried project artifacts only; database metadata, solver/runtime installations, logs, browser cache, and unrelated files on the disk are excluded.', 'Local mode is limited by free disk space, not a hosted 10 GiB allowance, and local artifacts do not receive an automatic seven-day cleanup. Runtime installers and logs still consume disk. Export/import project archives and keep an independent backup for important work.'], table: { headings: ['Counted by local Storage', 'Not counted by local Storage'], rows: [['Inventoried structures, inputs, configurations, completed results, trajectories, and exported project artifacts.', 'SQLite metadata, solver/runtime installations, logs, browser cache, and unrelated disk files.'], ['Large intermediate state when it is retained as a project artifact.', 'Operating-system free space or data owned by another application.']] }, links: [{ label: 'Storage settings', href: '/account/storage' }] },
      { title: 'Quantum ESPRESSO intermediate data', paragraphs: ['QE disk_io choices and intermediate output can grow far beyond the final result. Wavefunction/tmp data may be needed for bands, DOS, phonon, projected workflows, or external interoperability; do not remove it until downstream workflows finish. Keep the exact input, pseudopotential identity and checksum, provenance, and state artifacts together.', 'Wannier90 is an external/manual workflow unless a separately documented native integration is available. Follow the official Quantum ESPRESSO and Wannier90 documentation; this guide does not claim a native Wannier90 runner.'], links: [{ label: 'Quantum ESPRESSO documentation', href: 'https://www.quantum-espresso.org/documentation/' }, { label: 'Wannier90 documentation', href: 'https://wannier.org/documentation/' }] },
      { title: 'Hosted Figure Lab autosave behavior', paragraphs: ['Figure Lab saves a local draft after approximately 350 ms without a new edit and starts cloud synchronization after approximately 1.2 seconds. Active uploads are serialized; an edit during upload is saved next.', 'Leaving Figure Lab flushes pending draft edits. Online and focus events help retry pending cloud saves. A failed save remains visible instead of being labeled successful.', 'There is no required Save revision button. Ctrl/Cmd+S is an optional explicit history checkpoint.'] },
      { title: 'Document limits and hosted storage history', table: { headings: ['Resource', 'Current limit'], rows: [
        ['Workspace snapshot', '4.5 MB per saved workspace snapshot.'], ['Research document', '4 MB per dataset, figure, or template document.'],
        ['Dataset samples', '250,000 points per dataset.'], ['Figure composition', '64 panels; 32 layers per panel.'],
        ['Figure checkpoints', '100 explicit revisions plus the current automatic working copy.'], ['Figure Lab allowance', 'Shares the total cloud allowance: 10 GiB Free, or the active paid account capacity. Retained revisions and upload reservations count.'],
        ['Data-file import', '20 MB input-file limit; resulting documents must still meet their own limits.'], ['Source package', '200 MB package/selected expanded JSON limit, plus individual document limits.'],
      ] } },
      { title: 'Keep a portable copy', bullets: ['Export a Source package for important figures and project archives for local studies.', 'Retain original structure files, executed calculation inputs, pseudopotential identity/checksum, provenance, and any intermediate state needed by a downstream workflow.', 'Browser storage has its own device quota and can be removed by clearing site data.', 'An archive still occupies storage; it is intended for organization, not deletion.', 'Account storage shows current cloud objects separately from the research-document allowance. Cloud login does not upload a local project; Cloud Sync is enabled per project.'] },
    ],
  },
  {
    "id": "account",
    "group": "Account & compute",
    "title": "Settings, accounts, profile, and usage",
    "intro": "Settings separates browser preferences, scientific compute, AI provider accounts, and optional Phynite Cloud login. Usage is based on actual execution/provider records; missing measurements are never invented.",
    "blocks": [
      {
        "title": "Find the right settings page",
        "table": {
          "headings": [
            "Page",
            "What it controls"
          ],
          "rows": [
            [
              "Appearance & language",
              "Theme, accent, density, interface/code text size, reduced motion, and language in this browser."
            ],
            [
              "Keyboard shortcuts",
              "Supported application bindings, stored in this browser."
            ],
            [
              "Notifications",
              "Local job/runtime alerts and desktop permission; hosted delivery preferences on the website."
            ],
            [
              "Compute",
              "Native runtime installation and local CPU/RAM/concurrency; hosted worker and compute defaults on the website."
            ],
            [
              "AI provider accounts",
              "Your own AI logins, active account, connection/model readiness, reported limits and reset windows."
            ],
            [
              "Account",
              "Optional Phynite Cloud login/logout and per-project sync; independent from AI login."
            ],
            [
              "Usage / Storage",
              "Recorded job measurements and provider usage / project archives and storage inventory."
            ],
            [
              "Research profile / Privacy & session",
              "Connected Phynite identity / mode-specific privacy and session controls."
            ]
          ]
        }
      },
      {
        "title": "Navigate without duplicate menus",
        "paragraphs": [
          "Settings has one category sidebar and search. Account follows AI provider accounts. On mobile, open the navigation drawer and use Escape, the close control, or backdrop to dismiss it. The account menu supports keyboard navigation. Legacy Local runtime & cloud bookmarks redirect to the appropriate category instead of opening another settings shell.",
          "An unsigned local workspace shows settings and connection actions, without a fabricated user profile. Once a Phynite account is connected, Profile opens a dedicated profile page with an Edit profile action."
        ]
      },
      {
        "title": "Edit a connected research profile",
        "steps": [
          "Connect your Phynite Cloud account before opening Profile; local projects remain available without that login.",
          "Choose Edit profile and set display name, institution, role, and research area.",
          "Choose a JPG, PNG, or WebP photo up to 20 MB. Crop, zoom, and rotate it; the browser saves a compressed 256-pixel image.",
          "Review the preview and choose Save profile. Removing a photo applies after saving. Unsaved account drafts require a decision before navigation.",
          "Use Appearance & language for device appearance. Those choices apply immediately and do not become cloud account defaults."
        ]
      },
      {
        "title": "Set a cloud sign-in username",
        "steps": [
          "Create a Phynite Cloud account with email and confirm the email first, where registration is available.",
          "Open the research-profile editor. Display name can include spaces and need not be unique.",
          "In Username, enter 3–30 characters, starting with a letter or number. Letters, digits, periods, hyphens, and underscores are supported; reserved names cannot be claimed.",
          "Choose Save username. This is separate from saving research identity; uniqueness is checked without case sensitivity.",
          "Next time, use either username or email with the same password. After changing a username, the old name stops working and may become available to someone else. Recovery uses the verified email."
        ],
        "note": "A username does not create another account, share projects, or change email. Native local work does not require a sign-in username."
      },
      {
        "title": "Configure compute where it runs",
        "paragraphs": [
          "In the local npm app, Compute includes platform/capability detection, scientific-runtime installation, isolation status, CPU/RAM/parallel-job defaults, and the Materials Project API key connection. Save, test, replace, or remove the database key here; searches use it immediately without a restart. Install the runtime before running. New defaults affect future jobs; workspace overrides apply only to the selected run. Native local compute needs neither Docker nor a cloud-paired worker.",
          "On the hosted website, Compute retains account defaults for each workload, supported Cloud profiles and estimates, and personal-worker pairing. Save defaults is explicit; Cancel restores saved values. MD stays on personal compute until its Cloud service is available. More cores are not necessarily faster; compare short controlled runs."
        ]
      },
      {
        "title": "Connect AI and read limits",
        "paragraphs": [
          "AI provider connections use the official Codex, Claude Code or Antigravity CLI with your own account. They are independent from Phynite Cloud login. After authentication, model discovery and capability checks run automatically. Tools and attachments require verified support, and Canvas changes retain approval/validation rules. The local app keeps one CLI-managed connection per provider; it has no account switcher or local gateway setup. AI source attachments are streamed without the former 10 MB browser quota; the original bytes and checksum are retained. Format readers and the selected model can still report their own safe reading limits, and a large source is retained with an extraction warning instead of being silently truncated.",
          "The local app uses the profile managed by the selected official CLI. Usage and reset information comes from the provider: percentages, windows, and dates are shown only when reported. No remaining token balance is inferred. A disconnected, rate-limited, or unsupported provider shows its actual state without silent provider switching."
        ]
      },
      {
        "title": "Notifications on this device",
        "paragraphs": [
          "Choose completed-job, failed/cancelled-job, and runtime-installation alerts separately. Local alerts observe real state changes while the app is open. Desktop alerts are optional, require browser permission, and can be checked with Send test notification.",
          "These local preferences stay in this browser. They do not schedule background cloud push or email when the app is closed. Hosted email and inbox delivery settings are separate."
        ]
      },
      {
        "title": "Read usage correctly",
        "table": {
          "headings": [
            "Metric",
            "Interpretation"
          ],
          "rows": [
            [
              "Recorded run time",
              "Valid recorded start-to-completion intervals; failed/cancelled runs count when both timestamps exist. Setup and result persistence/upload may be included."
            ],
            [
              "Allocated CPU-hours",
              "Recorded seconds × allocated cores / 3600. This is allocation, not actual CPU activity or energy use."
            ],
            [
              "Local files / cloud files",
              "Different storage inventories. Cloud object measurement excludes the native disk; local storage is not a cloud subscription."
            ],
            [
              "Unmeasured runs",
              "Records with missing/invalid timing or allocation remain unavailable or partial, never assumed to be zero."
            ],
            [
              "AI limits and reset",
              "The selected provider account’s reported measurements; independent from scientific CPU-hours and Phynite billing."
            ]
          ]
        }
      },
      {
        "title": "History and portable copies",
        "paragraphs": [
          "Usage lists recorded jobs and receipts with their timestamp, status, destination, and available allocation. Pagination changes the visible rows; account-wide totals still describe all measured records. Refresh updates the measurement.",
          "Storage contains native project archive export/import. Keep original structures, executed inputs, available results, provenance, checksums, and independent backups. Respect licenses on potential assets. Browser drafts are recoverable aids rather than the native database."
        ]
      },
      {
        "title": "Optional Cloud and website billing",
        "paragraphs": [
          "Account connects or disconnects Phynite Cloud. Login preserves local identity and does not upload projects. Enable Cloud Sync per project only after reviewing transfer scope; cloud compute has a separate input-transfer review and does not enable sync. Logout keeps local data and stops sync.",
          "Billing in local mode opens https://phynitelab.com/billing. Cloud access, price, quota, and capacity come from the current hosted catalog and account. A purchase never starts a job automatically. MD Cloud remains unavailable until its service is supported."
        ],
        "note": "Local execution uses your hardware, electricity, and disk. Once runtimes and required potentials are installed, local science can run offline. Provider AI, optional Cloud, external data lookup, and new downloads require their respective connections."
      }
    ]
  },
  localComputeGuide('en'),
  {
    id: 'shortcuts', group: 'Reference', title: 'Keyboard and pointer shortcuts',
    intro: 'Primary means Command on macOS and Control on Windows/Linux. Shortcuts are scoped to the active editor. Text fields keep their own editing behavior unless an action is explicitly listed.',
    blocks: [
      { title: 'Customize supported application shortcuts', paragraphs: ['Open Settings → Keyboard shortcuts. Rebind opening Settings, toggling the sidebar, focusing an open AI chat, or sending a message using the supported combinations. Changes apply immediately and stay in this browser; restore defaults whenever needed.', 'The tables below describe editor-specific defaults and context. Custom application bindings do not replace native text editing, geometry operations, or browser accessibility keys.'] },
      { title: 'DFT Lab', table: { headings: ['Shortcut', 'Action', 'Context'], rows: [
        ['Primary + K', 'Open command menu', 'DFT Lab workspace'], ['Space', 'Open command menu', 'Builder, outside editable controls'],
        ['Primary + Z', 'Undo', 'Builder editing history'], ['Primary + Shift + Z / Primary + Y', 'Redo', 'Builder editing history'],
        ['V', 'Select tool', 'Viewport editing'], ['G', 'Move tool', 'Viewport editing'], ['A', 'Add atom', 'Viewport editing'], ['M', 'Measure tool', 'Viewport editing'], ['F', 'Focus selection', 'A selected atom'],
        ['Delete / Backspace', 'Delete selection', 'Viewport; not a text input'], ['X / Y / Z', 'Constrain move to an axis', 'Move mode'], ['Shift + X / Y / Z', 'Constrain move to YZ / XZ / XY plane', 'Move mode'],
        ['Enter', 'Apply move', 'Move mode'], ['Escape', 'Cancel move or close the active tool/dialog', 'Depends on current interaction'], ['Arrow Left / Right', 'Resize sidebar by 16 px', 'Focused resize separator'],
      ] } },
      { title: 'Figure Lab', table: { headings: ['Shortcut', 'Action', 'Context'], rows: [
        ['Primary + Z', 'Undo figure change', 'Outside editable controls'], ['Primary + Shift + Z / Primary + Y', 'Redo figure change', 'Outside editable controls'],
        ['Primary + S', 'Keep an explicit checkpoint', 'Commits a focused number draft first; automatic saving already runs'], ['Primary + Shift + E', 'Export in the selected format', 'Ready figure outside editable controls'],
        ['+ or =', 'Zoom in', 'Canvas view'], ['-', 'Zoom out', 'Canvas view'], ['0', 'Fit figure', 'Canvas view'], ['?', 'Toggle shortcut help', 'Figure Lab'],
        ['Space + drag / Alt + drag / middle drag', 'Pan the page', 'Figure Lab canvas'], ['Primary + mouse wheel', 'Zoom the page', 'Figure Lab canvas'], ['Escape', 'Close help or a drawer', 'Figure Lab'],
      ] } },
      { title: 'Fields and custom menus', table: { headings: ['Shortcut', 'Action'], rows: [
        ['Tab / Shift + Tab', 'Move forward/backward through interactive controls.'], ['Enter / Space', 'Activate a focused button or select a highlighted menu option.'],
        ['Arrow Up / Down', 'Open or move through a custom select; navigate a command menu.'], ['Home / End', 'Move to the first/last enabled option in a custom select.'],
        ['Type letters', 'Find an option by label in an open custom select; type a command query in the command menu.'], ['Escape', 'Dismiss the current menu; cancel an uncommitted numeric draft.'],
        ['Enter / leave the field', 'Commit a numeric draft, including decimals or scientific notation where allowed.'], ['Primary + Z in text', 'Undo text editing rather than changing the figure or crystal.'],
      ] } },
      { title: 'Pointer and mobile interaction', paragraphs: ['Use the viewport camera controls to rotate, pan, and zoom the crystal. Atom tools operate on the selected atom; choose the appropriate tool before dragging.', 'On a small screen, open Results or Inspector from the Figure Lab toolbar, then close the drawer with its backdrop or Escape. The page remains scrollable when zoomed.', 'Dragging a sidebar separator adjusts its width on desktop. Keyboard users can focus the separator and use the horizontal arrow keys.'], note: 'Browser and operating-system shortcuts may intercept a key before the web page receives it. Buttons and menus provide the same primary actions.' },
    ],
  },
  {
    id: 'troubleshooting', group: 'Troubleshooting & recovery', title: 'Troubleshooting and recovery',
    intro: 'Start with the exact state and the most recent message. Repeatedly rerunning a failing input often wastes time without fixing its cause.',
    blocks: [
      { title: 'Local npm run diagnosis', table: { headings: ['Stage', 'What it means', 'Where to look'], rows: [
        ['Before solver start', 'Setup, runtime, potential, input validation, isolation, or worker readiness rejected the job. No solver output exists.', 'Run review, Settings → Compute, phynite-lab doctor, and the selected data directory logs.'],
        ['Queued', 'The job is waiting for a dependency or available local worker.', 'Job status, dependency record, worker status, and notification history.'],
        ['After solver start', 'The solver or analysis process returned an error or was interrupted.', 'Execution log, first meaningful solver error, saved input, provenance, and retained artifacts.'],
        ['Persistence/upload', 'The calculation may have finished but saving or transfer failed.', 'Result state, checksum/provenance, storage inventory, network, and Cloud transfer status.'],
      ] }, paragraphs: ['A Completed status means the process and required persistence steps finished; it does not establish convergence or scientific validity. Preserve the exact input and failed log before retrying. A new attempt should use an explicit, reviewed change.'] },
      { title: 'Launcher recovery sequence', steps: ['Run phynite-lab status with the same --data-dir used to start the app.', 'Run phynite-lab doctor and record the displayed distribution, port, runtime, and data-path diagnostics.', 'Read the latest service and worker log in the selected data directory.', 'If the instance is healthy, open the printed loopback origin rather than starting another workspace.', 'If an update or runtime activation failed, keep the previous active runtime, fix the reported cause, and retry from Settings → Compute.', 'After a restart, inspect interrupted jobs; local jobs are not automatically rerun.'] },
      { title: 'Common problems', table: { headings: ['Problem', 'What to do'], rows: [
        ['Figure opens empty', 'Check that the project has completed plottable data. Open a specific run, retry source loading, or import an original numerical file.'],
        ['Band + DOS is not verified', 'Check geometry/electronic source identity and energy metadata. Do not force unrelated calculations into a verified pair.'],
        ['Lines or labels appear too dense', 'Set final dimensions, reduce unnecessary layers, use a grid, and inspect bounds and legend placement.'],
        ['Cloud save stays pending', 'Check network, sign-in, document limits, and account allowance. Keep the local browser copy and export a Source package.'],
        ['Cloud revision conflict', 'Open History and compare local and remote versions. Resolve deliberately before further automatic synchronization.'],
        ['Outdated data after switching accounts', 'Wait for the current account workspace to load. If needed, reload and check the signed-in identity.'],
        ['SCF does not converge', 'Inspect geometry, occupations, spin, pseudopotentials, mixing, cutoffs, and solver logs before adjusting iteration limits.'],
        ['Resource check rejects a k mesh', 'Use a physically justified mesh within the deployment limits; set nonperiodic directions to one. Larger jobs need appropriate capacity.'],
        ['Export fails', 'Check data validity, output size, font availability, and network; try again after the preview completes.'],
        ['Old raw download expired', 'Open retained numerical data if available, import your original file, or run again. A preview image cannot recover missing numerical samples.'],
      ] } },
      { title: 'What to include in a support request', bullets: ['The page, action, and exact visible error.', 'Project and calculation names or IDs that you are comfortable sharing.', 'Whether the failure happens before submission, in queue, during execution, during upload, or in Figure Lab.', 'Relevant solver-log excerpts and the expected behavior.', 'Never include passwords, browser cookies, access tokens, or the private computer configuration.'] },
    ],
  },
  {
    id: 'roadmap', group: 'Reference', title: 'Availability and planned workflows',
    intro: 'The workspace distinguishes available tools from promoted future features. A coming-soon card is informational and does not submit a job.',
    blocks: [
      { title: 'Molecular dynamics', paragraphs: ['MD Lab supports Guided and validated manual LAMMPS simulations plus OVITO analysis on personal or funded Cloud compute.', 'Choose funding and resources in the lab drawer. Large source uploads use multipart; retained frame shards load on demand without changing the original data or browser safety limits.'] },
      { title: 'Managed plans', paragraphs: ['Free includes DFT Lab, MD Lab and Figure Lab, imports, templates, exports, 10 GiB total cloud storage, and DFT and MD runs on one connected personal computer per account. There is no Phynite activation or hourly local compute fee. Cloud compute uses Quanta as its primary unit; the Rupiah equivalent is the merchant credit purchase price, currently Rp18,000 per Quanta, rather than an exchange-rate conversion.', 'Paid Cloud uses verified production credit; sandbox payments cannot fund production. The rate is the selected AWS profile plus 10%, charged only for solver/analysis time with a 60-second minimum once per job. Setup, upload, cleanup, temporary disk and compute transfer are covered by Phynite. Duration estimates do not limit paid runtime. Funding renews within five minutes according to available balance; top up before its deadline to keep the same job running. Scientific failures bill actual compute; platform failures refund compute charges. Projects and results remain accessible after balance runs out. Total cloud storage offers replace the Free 10 GiB: 50 GiB Rp27,000, 100 GiB Rp55,000, 250 GiB Rp129,000, 500 GiB Rp259,000 and 1 TiB Rp519,000 per 30 days. More capacity and large transfers are quoted through support@phynitelab.com with no automatic transfer charge. Renewal is manual. The same tier adds 30 days; upgrades convert remaining paid base value into extra time without gateway fees; downgrades start after expiry. Expiry restores Free without deleting files. Accounts above quota may read, download and delete, while new writes are blocked. See /pricing for estimates and terms.'] },
    ],
  },
  {
    id: 'reference', group: 'Reference', title: 'Units, terms, and scientific references',
    intro: 'The interface exposes a connected workflow, but the scientific meaning still comes from the selected model, solver method, and numerical data.',
    blocks: [
      { title: 'Units and terms', table: { headings: ['Term', 'Meaning'], rows: [
        ['Å / angstrom', 'Length unit for atomic-scale geometry; 1 Å = 10^-10 m.'], ['Bohr', 'Atomic unit of length; approximately 0.529177 Å.'], ['eV / Ry', 'Energy units; 1 Ry is approximately 13.605693 eV. Verify which unit each input field expects.'],
        ['Fractional coordinates', 'Coefficients of the real-space cell vectors.'], ['Reciprocal coordinates', 'Coordinates in the reciprocal lattice basis; interpretation depends on the declared convention.'], ['Γ', 'The Brillouin-zone center, k = 0.'],
        ['SCF / NSCF', 'Self-consistent / non-self-consistent electronic calculation.'], ['DOS / PDOS', 'Density of states / projected density of states.'], ['DFPT', 'Density-functional perturbation theory.'],
        ['vCPU / core allocation', 'Requested execution parallelism; not measured utilization.'], ['GiB / MB', 'GiB uses 1024^3 bytes; this guide labels decimal storage totals in MB and RAM allocations in GiB.'],
        ['Provenance', 'Source identity, method, metadata, and processing history that explain where a result came from.'],
      ] } },
      { title: 'Read alongside the guide', paragraphs: ['Use the official Quantum ESPRESSO documentation for the exact semantics of pw.x, bands.x, dos.x, projwfc.x, ph.x, q2r.x, and matdyn.x options.', 'Use Materials Project documentation to understand database structure provenance and conventions; SeeK-path documentation for standardized paths; and BoltzTraP2 documentation for interpolation and transport assumptions.', 'This guide describes the implemented Phynite interface and its current behavior. It is not a substitute for a method-specific convergence study or validation against the scientific literature.'] },
    ],
  },
];
