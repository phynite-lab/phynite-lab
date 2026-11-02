import type { GuideSection } from './guide-content';

export const guideAdditions: GuideSection[] = [
  {
    id: 'quickstart-silicon', group: 'Getting started', title: 'Tutorial: a first silicon calculation',
    intro: 'Complete a small ground-state calculation before attempting a large material study. This tutorial checks the structure-to-worker-to-result workflow; its numerical settings are starting values for an exercise, not a converged production method.',
    blocks: [
      { title: 'Before you begin', bullets: ['Open the local app without login, or sign in to the hosted website with the account that owns the project.', 'In the npm app, install DFT in Settings → Compute and keep the CLI running. On the hosted website, connect Your computer through the paired worker and keep its Docker runtime active.', 'Have a diamond-cubic silicon structure in CIF, POSCAR, or another supported format. Keep its source and lattice parameter with your notes.', 'Use a primitive two-atom cell for this exercise. A conventional eight-atom cell is physically valid but has different total energy, reciprocal vectors, and computational cost.'] },
      { title: 'Create and inspect the project', steps: ['In Workspace, choose New project. Enter Silicon ground state and an optional description, then choose Create project.', 'Open the new project from the confirmation or project list. Add your silicon structure.', 'Confirm Si is the only species and the intended primitive cell has two atoms. Inspect cell lengths, angles, units, and nearest neighbors.', 'Keep a, b, and c periodic for bulk silicon. The displayed repeated cells are a visualization, not extra atoms submitted to the solver.', 'Give the structure a source-specific name. Retain the original file before changing its lattice.'] },
      { title: 'Configure the exercise', table: { headings: ['Choice', 'Starting point', 'Why to inspect it'], rows: [
        ['Workflow', 'Total energy / SCF', 'Produces the self-consistent ground state; it does not produce a band-path figure by itself.'],
        ['Method', 'PBE with matching Si pseudopotential', 'Changing the functional or pseudopotential changes the physical model and energy zero.'],
        ['Wavefunction cutoff', 'Use the resolved pseudopotential recommendation', 'A remembered cutoff from another potential is not transferable evidence of convergence.'],
        ['Charge-density cutoff', 'Use the matching recommendation', 'The appropriate ratio depends on the pseudopotential type.'],
        ['Integration mesh', '4 × 4 × 4 as an initial exercise', 'Repeat with denser meshes before interpreting small energy differences.'],
        ['Occupations', 'Review the resolved insulating occupation policy', 'Do not infer metallic behavior from a numerical smearing choice.'],
        ['Resources', 'A small allocation within the displayed account limits', 'Allocation controls available worker resources, not the accuracy of the method.'],
      ] } },
      { title: 'Run and inspect', steps: ['Inspect the generated input and select the intended compute destination.', 'Run once. Open Log and follow Queued, Running, and the final state.', 'Look for a converged SCF result in the solver output. A finished process without self-consistency is not an acceptable ground state.', 'Record total energy, atom count, executed input, pseudopotential identity, and run ID.', 'If you need a dispersion plot, add Band structure and configure a reciprocal path for this cell. Complete it, then choose Open in Figure Lab from its result.'] },
      { title: 'Expected outcome', paragraphs: ['The project contains the original structure, an editable setup, and a historical execution record with output artifacts. A separate band or DOS run supplies plottable numerical data.', 'There is no universal target energy for this tutorial: the value depends on the potential, cell, cutoffs, and conventions. Verify internal convergence and consistent method identity instead of matching an unexplained number.'], note: 'If the job stays Queued, check the destination and worker connection before submitting duplicate runs. See Execution and the troubleshooting decision table.' },
      { title: 'Failure and recovery', bullets: ['If the worker is offline, reconnect it and wait for the queued job instead of submitting another.', 'For Failed, inspect the saved input and first meaningful solver error in the log before changing a setting.', 'For Cancelled, keep the partial log and submit a new run only after the prior job reaches a final state.'] },
    ],
  },
  {
    id: 'quickstart-md', group: 'Getting started', title: 'Tutorial: a first local MD simulation',
    intro: 'Use a small argon system to learn the structure-to-settings-to-execution-to-result path in MD Lab. This is a workflow exercise, not a validated physical study.',
    blocks: [
      { title: 'Prepare your computer and structure', steps: ['In the npm app, install MD/analysis in Settings → Compute and keep the CLI running; no Phynite login is required. The hosted website instead needs a signed-in account and a connected personal worker.', 'Open MD Lab and create a project named Argon equilibration.', 'Import or build a small argon structure with a physically suitable periodic box. Check atom count, element identity, coordinates, box lengths, units, and atomic masses. An XYZ with Ar species or a LAMMPS data file with Masses works; a type-only dump has no mass for dynamics.', 'Retain the original structure file and record its source. A visual repeat does not add atoms to the simulation.'] },
      { title: 'Review the simulation', steps: ['Open the configuration drawer and choose Guided mode. Select the built-in Lennard-Jones model for Ar; do not use Generic parameters without recording their source.', 'Choose a short equilibration recipe. Inspect temperature, timestep, boundary conditions, random seed, unit system, potential parameters, and output interval.', 'Run browser preflight and read the generated LAMMPS input. Confirm it uses the intended structure and potential.'] },
      { title: 'Execute once and inspect', steps: ['Select Your computer and submit one run. Follow Queued and Running in the job record and check the worker connection.', 'If the worker is offline, reconnect it and wait for the queued job; do not submit a duplicate.', 'After completion, open the log, thermo data, trajectory, and retained input from the project. Check for LAMMPS errors and inspect whether temperature and energy behavior support the intended equilibration.', 'Completed means the process finished; it does not validate the force field, timestep, equilibration, or scientific conclusion.'] },
      { title: 'Failure and recovery', bullets: ['For Failed, inspect the first meaningful LAMMPS error and saved input before changing settings.', 'For Cancelled, review the partial log and submit a new run only after the previous job reaches a final state.', 'For a missing trajectory, check output settings and retained artifacts. An empty viewer is not a physical result.'], note: 'There is no universal target energy or temperature trace. Record the actual input, potential identity, run ID, and output before comparing systems.' },
    ],
  },
  {
    id: 'convergence', group: 'Calculations', title: 'Procedure: design a convergence study',
    intro: 'A convergence study establishes how numerical choices affect a reported physical quantity. Define the quantity and tolerance first, then vary a controlled parameter while preserving all other inputs.',
    blocks: [
      { title: 'Define a comparison that answers the paper', paragraphs: ['For a phase-energy comparison, converge the energy difference using comparable cells and normalization. For relaxation, inspect force and stress stability. For a band edge, transport coefficient, or phonon mode, converge that observable directly.', 'A stable total energy does not imply every response property has converged. Keep the target tolerance in your project description or method notes.'] },
      { title: 'Run a controlled series', steps: ['Duplicate a reference setup and give each variant a name containing the varied parameter and unit.', 'Vary ecutwfc with a compatible ecutrho. Keep geometry, pseudopotentials, k mesh, spin, occupations, and SCF threshold fixed.', 'At a sufficiently high cutoff, vary the uniform k mesh. Inspect smearing sensitivity independently for metals.', 'For low-dimensional systems, vary actual vacuum separation without changing the slab geometry or in-plane cell.', 'Run the necessary combinations near the chosen settings to check that separately converged choices remain sufficient together.', 'Retain every run and calculate the difference from the most resolved reference. Export the observations as a numerical table for plotting.'] },
      { title: 'Record a minimal results table', code: 'cutoff_Ry,k_mesh,energy_Ry,atoms,delta_meV_per_atom,run_id\n40,4x4x4,<measured>,2,<derived>,<run-id>\n50,4x4x4,<measured>,2,<derived>,<run-id>\n60,4x4x4,<measured>,2,<derived>,<run-id>', paragraphs: ['Replace placeholders with observed values; the table is a recording template, not simulated data. For the same composition and cell, delta per atom = (E - E_reference) / atom_count. Convert Ry to the unit reported in the paper consistently.', 'Do not subtract raw total energies of unrelated compositions as if they were a formation energy. Such comparisons require defined reference chemical potentials and stoichiometry.'] },
      { title: 'Choose a stopping rule', table: { headings: ['Observable', 'Inspect', 'Frequent mistake'], rows: [
        ['Energy difference', 'Change between successively more resolved calculations', 'Choosing a universal threshold without regard to the effect being studied.'],
        ['Forces and stress', 'Largest relevant component and equilibrium geometry', 'Relaxing at low cutoff, then assuming a high-cutoff single point fixes the geometry.'],
        ['Band extrema', 'k sampling and the actual location of extrema', 'Assuming the band gap always lies on the plotted high-symmetry path.'],
        ['Phonons', 'SCF/DFPT thresholds, k/q meshes, acoustic behavior', 'Removing negative modes cosmetically before understanding them.'],
        ['Transport', 'Dense electronic sampling, interpolation, chemical potential and temperature', 'Treating an interpolated smooth curve as evidence of convergence.'],
      ] } },
    ],
  },
  {
    id: 'slab-workflow', group: 'Structure & physics', title: 'Procedure: prepare a two-dimensional slab',
    intro: 'Use this procedure for a sheet or slab whose surface spans the a-b plane. Quantum ESPRESSO requires a finite three-dimensional cell with converged vacuum.',
    blocks: [
      { title: 'Geometry prerequisites', bullets: ['Start from a physically meaningful termination, composition, and surface orientation.', 'Inspect fractional and Cartesian coordinates. A tilted cell needs vacuum measured normal to the surface, not merely the length of c.', 'Check that the slab has the intended thickness and no unintended cross-boundary bonds.', 'Duplicate the structure before changing the cell so the original bulk or slab remains available.'] },
      { title: 'Prepare the model', steps: ['Orient the surface in the a-b plane. Verify the lattice-vector geometry instead of relying only on camera orientation.', 'Set cell repetition along c to 1 (e.g. 2 × 2 × 1) to inspect the in-plane extended surface without repeating along the vacuum direction.', 'Use the explicit vacuum action for the a-b surface. Inspect the updated cell and confirm interatomic Cartesian distances remain appropriate.', 'Choose an in-plane mesh N × M × 1, with N and M established by convergence.', 'Review the electrostatic treatment in the generated or expert QE input. Asymmetric, polar, and charged slabs need specific consideration.', 'Converge slab thickness, vacuum, and in-plane sampling against the quantity of interest.'] },
      { title: 'Understand a strained slab', paragraphs: ['Biaxial in-plane strain modifies the in-plane metric. Record the strain tensor, reference lattice, and whether atoms are relaxed at fixed in-plane cell.', 'Changing vacuum height changes the three-dimensional cell volume without changing the physical sheet thickness. A reported stress or conductivity normalized by this arbitrary volume may require a clearly defined two-dimensional conversion.', 'The c-vacuum helper does not construct every wire, arbitrary Miller-index slab, or isolated cluster. Import or prepare the appropriate geometry when the required operation is outside the builder tools.'] },
      { title: 'Validate before submission', table: { headings: ['Check', 'Evidence to retain'], rows: [
        ['Surface and orientation', 'Cell vectors, coordinates, termination, and original source.'],
        ['Vacuum', 'Normal separation and at least two tested separations around the selected value.'],
        ['Sampling', 'Executed k mesh and in-plane convergence results.'],
        ['Electrostatics', 'Exact QE settings and their physical justification.'],
        ['Relaxation', 'Fixed and free degrees of freedom, force threshold, and final geometry.'],
      ] } },
    ],
  },
  {
    id: 'field-reference', group: 'Reference', title: 'Reference: calculation fields and units',
    intro: 'Use the labels and units shown by the active calculation panel. These entries explain common QE inputs; the exact set of exposed controls depends on the workflow and whether generated or expert input is selected.',
    blocks: [
      { title: 'Geometry and electronic setup', table: { headings: ['Field or QE keyword', 'Unit / form', 'Interpretation'], rows: [
        ['CELL_PARAMETERS', 'Three lattice vectors; read the card unit', 'Defines the simulated cell, including vacuum.'],
        ['ATOMIC_POSITIONS', 'crystal or a stated length unit', 'crystal means fractional coordinates in the supplied lattice basis.'],
        ['ecutwfc', 'Ry', 'Maximum plane-wave kinetic energy for the wavefunctions.'],
        ['ecutrho', 'Ry', 'Charge-density and potential cutoff; converge with the chosen potential.'],
        ['K_POINTS automatic', 'N1 N2 N3 s1 s2 s3', 'Mesh counts and offsets for reciprocal integration; offsets are not fractional atom shifts.'],
        ['K_POINTS crystal_b', 'Reciprocal path vertices and weights', 'A line-mode path for band sampling; it is not the SCF integration mesh.'],
        ['nbnd', 'Integer', 'Number of electronic states calculated at each k point.'],
        ['tot_charge', 'Electron-charge convention used by QE', 'Positive values remove electrons; review periodic-charge treatment.'],
        ['nspin / noncolin / lspinorb', 'Discrete settings', 'Spin model and spin-orbit coupling; compatible pseudopotentials are required.'],
      ] } },
      { title: 'Convergence and relaxation', table: { headings: ['Keyword', 'Meaning', 'Interpretation'], rows: [
        ['conv_thr', 'SCF threshold in Ry', 'Controls the estimated electronic energy error; not a force threshold.'],
        ['electron_maxstep', 'Maximum electronic iterations', 'A limit; reaching it does not establish convergence.'],
        ['mixing_beta', 'Density-mixing parameter', 'Can affect convergence stability; no single value fits all systems.'],
        ['degauss', 'Smearing width in Ry', 'An integration/occupation choice, not automatically a physical lattice temperature.'],
        ['forc_conv_thr', 'Force threshold in Ry/bohr', 'Used with ionic relaxation; electronic convergence must be sufficiently tight.'],
        ['press', 'Target pressure in kbar', 'Relevant to cell relaxation; distinguish applied pressure from residual stress.'],
        ['cell_dofree', 'Allowed cell degrees of freedom', 'Defines which metric components can relax; inspect suitability for a slab or constrained strain.'],
      ] } },
      { title: 'Numerical entry and units', paragraphs: ['Numeric fields accept intermediate drafts while you type. Enter or leaving the field commits a valid value; Escape cancels a draft in supported controls. An empty axis bound means automatic, while a zero is an explicit physical bound.', 'Do not convert all scientific values to display-region formatting. QE inputs, CSV source files, and code use the syntax required by their parser. The interface language does not rewrite a solver input or change a numerical dataset.'], note: 'Refer to the installed QE version and its official INPUT_PW documentation for precise keyword semantics. This reference does not promise support for every QE module in the Phynite form.' },
    ],
  },
  {
    id: 'publication', group: 'Results & Figure Lab', title: 'Procedure: prepare a publication figure',
    intro: 'Prepare the scientific comparison first, then the page geometry, typography, and export. Keep the editable source with every figure you deliver.',
    blocks: [
      { title: 'Check source compatibility', steps: ['Open a completed result in Figure Lab or select retained datasets from the results library.', 'Read quantity, units, geometry identity, energy reference, and k-path metadata for each source.', 'Choose a grid for distinct k paths; use overlay only when coordinates and references are scientifically comparable.', 'For Band + DOS, confirm the pair describes compatible geometry and electronic assumptions. Review the linked energy range.', 'State the alignment convention. Each Fermi = 0 compares relative electronic structure and does not establish absolute band offsets.'] },
      { title: 'Set the page', table: { headings: ['Control', 'Practical choice', 'Verification'], rows: [
        ['Width / height', 'Use the target journal dimensions', 'A column-width PDF viewed at 100% remains readable.'],
        ['Typography', 'One publication font, restrained hierarchy', 'Axis labels, tick values, legends, and panel letters have distinct roles.'],
        ['Line style', 'Use color plus dash or markers when needed', 'Curves remain distinguishable in grayscale and for common color-vision differences.'],
        ['Bounds', 'Use explicit comparable bounds where justified', 'No data is hidden by an unexplained crop; curve strokes stay clipped inside the axes.'],
        ['Legend', 'Material or condition names with units', 'Avoid run IDs as the sole scientific description.'],
        ['Inset', 'A clearly located detail with explicit bounds', 'The reader can identify which source and region it represents.'],
      ] } },
      { title: 'Export and verify', steps: ['Wait for Figure Lab to confirm the latest save. Native local work stays on this computer; another device needs a portable export or confirmed, explicitly enabled Cloud Sync.', 'Choose PDF or SVG for vector line art, or set physical size and DPI before exporting PNG.', 'Open the exported file in the application used for the manuscript. Inspect the final physical scale, Greek symbols, font rendering, panel labels, and clipped boundaries.', 'Export the Source package separately. Store it next to the figure and executed simulation inputs.', 'If you change a dataset or method, replace the source explicitly, review every legend and reference, and produce a new export.'] },
      { title: 'Caption recording template', code: 'Quantity and material:\nStructure source and cell:\nMethod, functional, pseudopotentials:\nk/q sampling and numerical convergence:\nEnergy reference and normalization:\nParameter values and units:\nMeaning of colors, lines, and panels:\nSource package and run identifiers:', paragraphs: ['This is a checklist for the author, not an automatically generated scientific claim. Include only information supported by the executed calculation and retained numerical sources.'] },
    ],
  },
  {
    id: 'billing', group: 'Account & compute', title: 'Manage plans, billing, and resource usage',
    intro: 'Billing manages Phynite Cloud purchases and invoices on the hosted website. The local app opens https://phynitelab.com/billing; local compute, AI accounts, and device preferences are managed separately in Settings.',
    blocks: [
      { title: 'Review your account', steps: ['Open Billing on the Phynite website. From the local application, the link opens https://phynitelab.com/billing.', 'Read the active plan, subscription status, and per-run allocation. These values come from your account.', 'Open Recorded usage and choose Refresh after a calculation finishes or cloud files change.', 'Review Figure Lab retained bytes and current cloud files. Paid storage shares one total allowance across cloud files and pending uploads.', 'Choose Export usage to download a dated JSON record. The export contains resource measurements, not a payment receipt.'] },
      { title: 'Plan actions', table: { headings: ['Plan', 'Action', 'Effect'], rows: [
        ['Free', 'Use Free', 'Includes local DFT and MD runs. The npm app uses native runtimes without login; the hosted website uses a connected personal worker.'],
        ['Cloud', 'Top up Quanta', 'Early-access accounts use verified production credit; public visitors stay on the waitlist. Payment never starts a job.'],
        ['Enterprise', 'Discuss requirements', 'Opens the contact route for institutional capacity and terms.'],
      ] } },
      { title: 'Interpret time and storage', paragraphs: ['Paid usage lists each resource profile, measured solver/analysis time, actual Quanta charge and refund, with total, reserved and available credit shown separately. Recorded run time sums valid worker-start-to-completion intervals. It can include setup and result upload, as well as failed or cancelled runs that have valid timing.', 'Allocated CPU-hours multiply recorded duration by allocated cores. They do not measure CPU utilization, electricity consumption, or a tariff.', 'Current cloud storage counts current object versions. Older versions, metadata records, and your local disk are outside that number. A plus sign means the inventory reached its object limit and the displayed size is a lower bound.', 'The Figure Lab allowance counts retained datasets, figure documents, templates, and revisions. Archiving a figure does not remove those records or free that allowance.'] },
      { title: 'Payments and invoices', paragraphs: ['Billing opens Phynite checkout at /billing/checkout after merchant activation. Choose Direct Virtual Account or QRIS when available; DOKU processes the payment. Virtual Account adds Rp4,000; QRIS has no surcharge. Quanta sells at Rp18,000 per Quanta, starting at 0.5 Quanta (Rp9,000 base, Rp13,000 via VA). /billing/payments/[id] shows instructions and verified status; /billing/history lists 20 purchases per page with status filters. Existing hosted invoices retain their original amounts. Order creation, verified fulfillment, failed attempts and confirmed expiry create inbox notifications; transactional emails are enabled only after SES verification, from and reply-to support@phynitelab.com. Email failures do not cancel payments. The page does not collect card numbers. Tax invoice issuing is not connected.', 'Early-access accounts can use the Cloud workflows available in the current catalog after a verified production top-up, according to balance and capacity. MD stays on personal compute until its Cloud service is supported. Pilot remains controlled by admin grants. Institution capacity follows agreed terms. Local compute is free, but your hardware, internet, storage, and electricity remain your responsibility.'], note: 'Usage exports can contain calculation names and identifiers. Share them only with the intended collaborator or support contact.' },
    ],
  },
  {
    "id": "language",
    "group": "Account & compute",
    "title": "Appearance, language, and accessibility",
    "intro": "Settings → Appearance & language controls this browser. Theme, accent, density, text size, motion, and language apply immediately without changing your Phynite account or scientific inputs.",
    "blocks": [
      {
        "title": "Choose appearance",
        "steps": [
          "Choose System, Light, or Dark for this browser. System follows the OS color scheme; optional custom background/text colors require at least 4.5:1 contrast.",
          "Select the available accent and comfortable/compact density, and adjust interface and code text sizes within the shown ranges.",
          "Enable reduced motion when wanted. Restore defaults resets the device controls.",
          "These values stay in this browser and site origin. Another device, browser, or local port can use different choices; clearing site data resets them."
        ],
        "note": "Interface text scaling and theme do not change exported figure dimensions, plot samples, units, or solver settings."
      },
      {
        "title": "Choose language",
        "steps": [
          "Open Settings → Appearance & language.",
          "Choose English, Bahasa Indonesia, or automatic detection from browser preferences.",
          "Open another page or reload to confirm the choice. The preference stays in this browser rather than a cloud account default."
        ]
      },
      {
        "title": "Automatic language detection",
        "paragraphs": [
          "An explicit choice takes priority. Automatic mode reads supported browser/device languages in preference order. The initial server response can also use the language header and, on the hosted site, an edge country hint. English is the fallback when no supported language is found.",
          "Phynite does not request GPS or use a separate IP-location service to select language. A suggestion does not override an explicit choice. Different browsers may use different languages."
        ]
      },
      {
        "title": "Scientific text and data",
        "paragraphs": [
          "Solver keywords, chemical symbols, keyboard labels, numerical data, and user publication text are not translated into a different scientific meaning. QE and CSV retain their parser syntax.",
          "English documentation uses /guide/topic and Indonesian documentation /id/guide/topic. Switching language preserves the active topic; downloads use the selected language."
        ]
      },
      {
        "title": "Keyboard, notifications, and readability",
        "bullets": [
          "Tab moves among controls; the visible focus ring identifies the active control. Enter/Space activates a control and Escape closes supported menus/dialogs.",
          "Customize only the listed working application actions in Settings → Keyboard shortcuts. Editor-specific shortcuts keep their documented context and text fields keep native editing.",
          "Use Settings → Notifications for local job/runtime alerts and optional desktop permission. The app must remain open; local settings do not enable cloud email delivery.",
          "Documentation search uses Primary+K or / outside text fields. On mobile, open the table of contents only when needed.",
          "The reduced-motion device choice and supported operating-system motion preference reduce decorative transitions."
        ]
      }
    ]
  },
  {
    id: 'diagnostics', group: 'Reference', title: 'Troubleshooting: locate a failed workflow stage',
    intro: 'Identify the first stage that did not complete. Retrying a downstream action cannot repair an earlier missing structure, disconnected worker, or incompatible numerical source.',
    blocks: [
      { title: 'Decision table', table: { headings: ['What you see', 'Likely stage', 'Next check'], rows: [
        ['New project is unavailable', 'Account workspace initialization', 'Allow the workspace to load. On a cloud error, reload; do not clear browser data containing unsynchronized edits.'],
        ['Structure will not import', 'Parsing or geometry', 'Check format, encoding, lattice, coordinates, and occupancies. Keep the source file for diagnosis.'],
        ['Run is rejected immediately', 'Submission validation', 'Field messages, local runtime/isolation status, resource limits, and method; cloud authentication only for a cloud action.'],
        ['Run remains Queued', 'Worker or dependency', 'Check destination, private worker heartbeat, shared availability, and predecessors.'],
        ['Worker starts but QE exits', 'Runtime or scientific input', 'Read the first solver error. Check pseudopotential files, species names, syntax, memory, and disk.'],
        ['SCF cycles do not settle', 'Electronic self-consistency', 'Inspect geometry, occupations, magnetism, mixing, thresholds, and near-degenerate states.'],
        ['Solver finished but result unavailable', 'Persistence or upload', 'Inspect local disk/runtime and final status; hosted upload also depends on network and credentials. Keep the worker running.'],
        ['Open in Figure Lab fails', 'Numerical source retrieval', 'Retry the source. Older runs may need their original numerical file when retained datasets are absent.'],
        ['Overlay or pair warns about context', 'Scientific comparison', 'Read geometry, energy-reference, and path identity. Use independent panels when comparability is not established.'],
        ['Export fails', 'Rendering or font resources', 'Reconnect, reduce an oversized raster, and retry. Keep the figure document and source package.'],
      ] } },
      { title: 'Collect useful evidence', steps: ['Record the page and exact action, time, project, and run identifier.', 'Copy the visible error and relevant solver-log lines around the first failure.', 'Note the destination, allocation, operating system, worker image, and whether the problem repeats.', 'For a plot issue, retain the numerical dataset, figure Source package, and expected axis convention.', 'Contact support with the smallest reproducible example. Remove private credentials, cookies, passwords, and unrelated project data.'] },
      { title: 'Protect recoverable work', paragraphs: ['Keep the current browser session open when it contains an unsynchronized figure or project. Export source files before clearing site storage.', 'A retry creates or repeats work according to the active action. Inspect existing queued and running calculations before submitting duplicates.', 'Replacing a personal credential invalidates the old worker. Finish or cancel active work before rotating it so a completed solver can still upload its result.'] },
    ],
  },
];
