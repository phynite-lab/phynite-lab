# APS/PRB manuscript archives

Ask the project assistant to create an APS/PRB manuscript draft and identify the
completed calculation IDs, saved figure IDs and public DOI/arXiv references to
include. The read-only `create_manuscript` tool publishes an immutable conversation
artifact. Open its card and choose **Export** to download the ZIP. Research and
Plan mode can prepare this deliverable without applying project settings or
running calculations. Custom skill tool restrictions still apply.

The archive contains `main.tex` using `revtex4-2` with APS/PRB settings,
`references.bib`, numerical tables, vector SVG/PDF figures, exact executed inputs,
retained logs/evidence, figure settings and datasets, the source snapshot,
`manifest.json`, `SHA256SUMS`, missing information and reproduction instructions.
Font licenses accompany converted PDFs. The application never executes TeX.

Every scalar is selected from the final retained solver result with an explicit
unit, sampling scope, JSON pointer and method fingerprint. Total energy remains
in Ry; a sampled-k-path band gap keeps that scope. Inputs and final positive
convergence evidence are required. Failed, nonfinite, incomplete or unknown
convergence results cannot supply manuscript numbers. Electronic convergence
alone does not establish observable convergence or physical validity.

Figure sources must belong to the selected project and calculations. Their
checksums must match the original output inventory, and their curves are reparsed
from the exact executed CSV using the shared bounded renderer. Revisions, axis
units, energy references, transformations and source hashes are retained. The
initial archive supports standard executed CSV figures with source normalization.
Projected/unfolded sources and derived normalization require a later reviewed
extension; unsupported figures produce an explicit error. Exporting a draft never
silently substitutes another curve or drops a selected figure.

Bibliographic input consists only of public DOI/arXiv IDs. The backend retrieves
metadata from fixed Crossref/arXiv endpoints with redirects disabled. Journal,
volume, issue, pages and article numbers are included only when actually returned.
Unavailable/mismatched lookups add a missing-information entry. Missing fields stay
absent. Text and BibTeX fields are escaped; model-supplied TeX is never accepted as
an executable template.

Optional Materials Project reference structures require an original saved MP-ID,
a dated source snapshot and verified source checksum. Their units and methods
remain separate from calculation results. Missing methods remain unknown and
suppress quantitative comparison in the manuscript. The exporter does not subtract
approximate model energies from corrected Materials Project energies.

Every archive remains a **draft** pending author review of the abstract,
interpretation, physical validation, convergence study and journal requirements.
Missing authors, bibliography and provenance are listed explicitly. Exact model
or pseudopotential files and the qualified solver environment must be obtained
separately under their licenses; restricted UPF files are not copied into the ZIP.
Archive limits are twelve calculations, eight figures, twelve references and
1.8 MB of retained evidence per immutable artifact. Select a smaller study when
its evidence exceeds the limit; evidence is never silently truncated.

Before saving a snapshot, the backend checks the project stamp and every source
revision again. Concurrent edits invalidate creation. Replaying the same tool call
returns the same immutable artifact; reusing it for different sources fails.
Older artifact types remain readable and receive no new project authority.

`SHA256SUMS` covers every payload file and `manifest.json`; it does not hash itself.
The manifest covers the payload files without a recursive self-hash. Its original
manifest hash identifies the full retained solver manifest; the archived result
JSON is an explicit scoped projection. Reproduction instructions describe
verification, exact scientific inputs, external model/runtime requirements and an
offline TeX build with shell escape disabled. Build only reviewed generated drafts
in a disposable sandbox. The application does not run that build.
