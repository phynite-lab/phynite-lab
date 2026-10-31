# Bundled SSSP cutoff metadata

These JSON files are the machine-readable cutoff recommendations from SSSP
1.3.0 PBE. Phynite uses them to resolve a shared `ecutwfc` and `ecutrho` from
the strictest recommendation among every atomic species in a structure.

- `SSSP_1.3.0_PBE_efficiency.json`: SSSP efficiency recommendations.
- `SSSP_1.3.0_PBE_precision.json`: SSSP precision recommendations.

The files intentionally contain metadata only, not UPF binaries. The local
worker still resolves the actual UPF file from its installed SSSP library,
verifies the library checksum, and records the selected file plus SHA-256 in
the result provenance.

Do not hand-edit individual cutoffs. When the worker's SSSP release changes,
replace both JSON files from the same installed SSSP distribution and rerun
`npm run test:structures` plus the backend worker tests.

## Upstream attribution and license

Source: Gianluca Prandini, Antimo Marrazzo, Ivano E. Castelli, Nicolas Mounet,
Elsa Passaro, Jusong Yu and Nicola Marzari, *A Standard Solid State
Pseudopotentials (SSSP) library optimized for precision and efficiency*,
Materials Cloud Archive, version 1.3.0 (2023-04-13),
[doi:10.24435/materialscloud:f3-ym](https://doi.org/10.24435/materialscloud:f3-ym).
The [original archive record](https://archive.materialscloud.org/records/rcyfm-68h65)
also links the associated [journal article](https://doi.org/10.1038/s41524-018-0127-2).

These metadata files are distributed under **Creative Commons Attribution 4.0
International (CC-BY-4.0)**, as stated in the archive's original
[LICENSE.txt](LICENSE.txt) and [record metadata](https://archive.materialscloud.org/api/records/rcyfm-68h65).
They retain that license independently of Phynite's AGPL license. The bundled
JSON bytes are unchanged from the official archive downloads, verified on
2026-10-31:

| File | SHA-256 |
| --- | --- |
| `SSSP_1.3.0_PBE_efficiency.json` | `2c8642a70308ecd072a209a30c160bf51423560bb202116cb31fd5275eff814a` |
| `SSSP_1.3.0_PBE_precision.json` | `7b7b648915e54c8397cd8143a7385c17eeed3104ad1236cecd905126d338a4e3` |

Original files are available at the record's
`api/records/rcyfm-68h65/files/FILE_NAME/content` endpoint. The original downloaded
license file has SHA-256
`8028d9d7fcad7932bb5551dc0a60cff6c6b7f7aa2bd480f516a2faaa09d943a1`.
The local license copy normalizes indentation and final blank lines; its license
words are unchanged.
Its separate pseudopotential-family terms still apply to downloaded potential
files; the metadata's CC-BY-4.0 license does not replace those terms.
