# Crystal database imports

Open **Crystal database** from a Crystal module, a project structure library or MD
Lab. Select the source, then search a formula, element list or returned source ID.
Sources are selected explicitly; a failure never substitutes another database.
Materials Project alone requires an API key, stored through Settings → Compute.
Public OPTIMADE requests never receive that key.

| Source | Property filters | Sort | Paging |
| --- | --- | --- | --- |
| COD | None | Source order | Pages within the returned coordinate-record list |
| Materials Project | Space group, site counts, band gap, energy above hull | Sites, gap, energy above hull | Offset |
| OQMD | Space group, site counts, gap, stability distance | Stability distance | Offset |
| AFLOW | Space group, site counts, gap | Source order | Page number |
| JARVIS-DFT | Site counts | Source order | Fixed first page; narrow the query |
| Alexandria PBE | Space group, site counts, gap, energy above hull | Sites, gap, energy above hull | Offset |
| NOMAD | Space group and site counts | Sites | Offset |

Provider endpoints come from the [OPTIMADE provider registry](https://providers.optimade.org/).
The adapters follow the [OPTIMADE specification](https://github.com/Materials-Consortia/OPTIMADE/blob/master/optimade.rst)
and the source-specific fields advertised by each provider. The UI exposes the
controls each adapter supports. Page requests rebuild a fixed HTTPS endpoint;
untrusted `links.next` URLs are never fetched.

AFLOW requires element lists such as `Si-O` for compounds; exact formula matching
is unavailable. Some AFLOW records use bulk composition fractions where per-site
occupancies are required. Those records are omitted with a source note rather
than silently changing occupancies. JARVIS ignores paging and sort parameters and
can match additional elements in an element-list search; its first-page limitation
is explicit. Outages, rate limits and invalid source records remain visible.

The browser retrieves up to 30 records per page (JARVIS returns up to 20), and
accepts structures with up to 5,000 sites. Invalid or singular cells, unresolved
implicit atoms and unsupported assemblies are rejected. Missing properties remain
unavailable; JARVIS's `-99999` missing-value sentinel is never displayed as a real
result. Other reported numerical values, including negative stability distances,
are retained. Band gaps use eV, energy above hull/stability distances use eV/atom,
densities use g/cm³ and lattice vectors use Å. No stability label is inferred from
an unreported boolean.

## Inspect and choose the cell

Click a result to preview the exact imported geometry with the shared crystal
viewport. Inspect its lattice, site count, periodicity, properties, source URL and
checksum. Check the records to import; the selection applies to the current page.

**Cell from source** preserves its normalized geometry. **Primitive cell** and
**Conventional cell** use `spglib.standardize_cell` in the already installed local
DFT runtime. Install that runtime in Settings → Compute if needed. Conversion
runs in the existing native sandbox, with a displayed symmetry tolerance in Å,
`angle_tolerance=-1` and `no_idealize=True`. Basis lengths, angles and atomic
positions are not idealized. The method, spglib version and parameters are saved.
See [spglib's API](https://spglib.readthedocs.io/en/v2.8.0/api/autodoc/spglib.html#spglib.standardize_cell).

Standardization accepts fully periodic, ordered structures with at most 2,000
sites. A source with partial/mixed occupancies, nonperiodic axes or reported
magnetic ordering without per-site magnetic symmetry must retain its source cell
or use an appropriate ordered configuration. No approximate reduction is applied.
The runtime checks composition ratios and volume per site before returning a cell.

Supercell repeats create actual imported sites, independently of the viewport's
display repeats. Each axis accepts 1–16 repeats, subject to the 5,000-site import
limit. They retain species, occupancies, periodicity and a transformation record.
Nonperiodic axes stay nonperiodic. Repeats duplicate the finite system and its
cell spacing without enabling periodic boundary conditions.

## Retained evidence

Each import retains the source CIF or serialized JSON record, its SHA-256,
database/source ID, official URL, retrieval time, source modification time when
reported, normalized source-geometry SHA-256 and terms URL. Source JSON is an
individual record serialized by the adapter, rather than the entire HTTP response.
Derived-cell hashes and operations are stored separately from original provenance.

MD imports keep an original CIF when it is unchanged. Derived and JSON-source
geometries use extended XYZ with explicit cell vectors and periodic axes, without
decimal rounding or rotating a tilted cell into a different coordinate frame.
Its source record and transformation history remain attached. Mixed or partially
occupied structures need an ordered configuration before a derived atomic XYZ
can be written.

AI search supports the same seven sources and page offsets. It returns source
IDs and checksums, while importing refetches and checks the chosen record before
the existing project-owned change/approval flow. An import does not start a solver.
