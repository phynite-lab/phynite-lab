# MD prototype integration

Upstream: https://github.com/jauhar-nr/md-prototype

Fork: https://github.com/muhammadakfz/md-prototype

Base commit: `fcef385d046c2425a008e798273213c073bc9ef6`.

These components were copied directly from the upstream `web-viewer/src` at
that commit and adapted inside Phynite Lab. `upstream.json` records the SHA-256
of each original file before adaptation, allowing future upstream comparisons.
The GitHub fork contains the upstream base; the Phynite integration is maintained
in this repository.

The original Three.js four-camera viewport, floating toolbar, per-camera
controls, picking and measurement overlays, interactive clipping plane, scalar
range controls, project sidebar, inspector, modifier cards, RDF chart, time
series chart, timeline, and color maps are retained.

Phynite adaptations:

- Shared Phynite dark/light theme tokens, header, navigation, and responsive
  Files/Inspector drawers.
- `MdStudio` supplies authenticated, owner-scoped device persistence, actual
  file imports, worker lifecycle and timeouts, ordered OVITO computation,
  pipeline history, processed-frame exports, and DFT transfer.
- `md-prototype-adapter` preserves particle IDs, triclinic matrices and origins,
  physical time conventions, real species/phase/scalar data, and measured
  surface volumes. It translates parameter names without mutating history.
- `ModifierParameters` exposes working inputs for every supported modifier.
  Project selection, supercell modes, periodic flags, and bond visibility are
  connected to the real workspace and pipeline.
- Time series use measured data, with explicit per-frame computation and
  cancellation; unavailable values remain missing. No fallback energies,
  guessed chemical formulas, simulated project lists, or invented DXA lines.
- Renderer integration fixes resource disposal, per-frame measurement reset,
  large-frame instance capacity, hidden-atom picking, finite-value colors,
  and camera framing. Orthogonal camera labels use Cartesian XY/XZ/YZ;
  actual lattice lengths and angles remain available in the inspector.
- PNG and GLB are generated from the active renderer and geometry. GLB rejects
  an active display-only clipping plane and explains how to use a Slice
  modifier for exportable geometry.

See `docs/md-studio.md` for setup, scientific limits, and validation.

- Scientific AI captures reuse the active WebGL renderer with per-conversation
  opt-in, scoped source binding, camera/frame/selection/cell and clipping metadata.
