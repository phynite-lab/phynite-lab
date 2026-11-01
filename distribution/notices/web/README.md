# Emitted web dependency notices

The build records package ownership for modules and assets actually emitted into
its client and server bundles. These notices supplement that inventory; this
directory is not a list of every dependency installed for development.

`manifest.json` contains exact package names and versions, official npm integrity
records, immutable source commits, notice paths and SHA-256 checksums. A fallback
may be used only for that exact package version after verifying the local notice
bytes. It does not establish a license for another version or package. The
original complete MIT notices for `@react-three/fiber`, `remark-math` and
`rehype-katex` were obtained from the monorepo root at each published package's
official npm `gitHead`; no copyright holder or year was invented. Whitespace-only
normalization is recorded explicitly, with the upstream notice hash retained.

## KaTeX fonts

KaTeX's root MIT license covers its JavaScript code. The fonts emitted by its CSS
have a separate license: their original TTF name-table records explicitly state
SIL Open Font License 1.1, copyright Design Science, Inc. (2009–2010) and Khan
Academy (2014–2018), and the reserved font names. The full original records are
transcribed in `katex-0.16.47-font-COPYRIGHT.txt`; the immutable canonical OFL 1.1
terms are preserved in `OFL-1.1.txt`, obtained from the SPDX license list commit
recorded in the manifest. These font notices are **supplemental**, so they must
be included even when the JavaScript package already has its root MIT license.

`katex-0.16.47-fonts.json` records all 60 font file names, sizes and SHA-256 hashes
and the 20 TTF files' original copyright/license name records. Every font byte
was compared against the official npm archive after verifying that archive's
SHA-512 integrity from the versioned npm metadata. The files are unchanged by
this notice collection. Font names, copyright and license terms come from those
actual files rather than an assumed package license. Phynite's AGPL license
does not replace the fonts' OFL license.

Updating a package or a font requires new matching provenance and notices. A
missing notice, changed checksum, or unknown package/version must stop release
assembly instead of substituting a generic license identifier.
