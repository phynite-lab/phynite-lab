# Frozen lxml and GNU libiconv corresponding source

The inspected official macOS lxml 6.1.3 wheel statically links GNU libiconv 1.18.
The actual extension exports `_libiconv_version = 0x112`; the compiled libxml2
and libxslt versions are 2.14.6 and 1.1.43. Its original `LICENSES.txt` identifies
iconv as LGPL 2.1. These are dependencies of lxml, and retain their upstream
licenses.

`lxml-static-sources.json` binds all five unmodified original source archives
under `distribution/sources/native/` to their exact versions and SHA-256 hashes.
The lxml sdist was verified against its official PyPI release JSON. All four
library hashes are also present in that sdist's `buildlibxml.py`.
`pyproject.toml` contains the original wheel recipe version settings, including
zlib 1.3.2; that zlib value is recipe evidence, not a runtime version probe.
The source bundle contains the original build scripts and libxslt patch.

The core notice collector checks the actual installed lxml native versions
against this source manifest, verifies every source archive, and includes the
original GNU license and author texts in its output. It refuses unknown or
mismatched versions. This check does not replace platform build, relink and
functional qualification. Any modified native dependency must be accompanied by
its modified corresponding source and updated release evidence.

## Rebuild or modify the library

Use an isolated build environment with the matching Python headers, setuptools,
a C compiler, make, and the platform SDK/build tools. The Phynite core build
requirements provide the Python build environment; the application does not
install these tools on an end user's computer.

From the public source checkout:

```bash
python scripts/rebuild-lxml-native.py --prepare /absolute/new/build-directory
```

This verifies and extracts every source archive, then applies lxml's original
libxslt backport with its original patch implementation. Existing directories
are rejected. Modify the prepared `libraries/libiconv-1.18/` sources if desired,
then run:

```bash
python scripts/rebuild-lxml-native.py --build /absolute/new/build-directory
```

The wrapper runs the original lxml static-library build functions with these
local source directories in place of their download step. No dependency is
downloaded or installed globally. It forces rebuilding and linking, including
when only a file inside a library source directory changed. A wheel is written
under `build-directory/wheels/`. Install that wheel into an isolated Phynite core
build environment with `python -m pip install --no-deps --force-reinstall
/path/to/the/wheel.whl`, then use the public `build-local-core.py` and packaging
scripts to produce a core that uses it. Keep the modified library sources in the
corresponding-source archive for that resulting binary.

The route was exercised on the current macOS ARM64 machine: original source
build passed, a temporary marker added to GNU iconv source appeared in the
loaded rebuilt lxml extension, XML parsing passed, and the rebuilt extension was
packaged as a wheel. The marker remained local to the final shared library; its
loaded value was verified using its native symbol offset. This test source and
its binary are confined to ignored build evidence. Other platform qualification
is pending, and this is not scientific solver or complete release evidence.

## Zstandard nested code

The inspected Homebrew zstd 1.5.7 library exports `divsufsort` and contains the MIT
licensed code in `lib/dictBuilder/divsufsort.c`. Its installed root BSD license
alone omits that copyright notice. The original leading source comment is
preserved in `zstd-divsufsort-COPYRIGHT.txt` and bound to the exact verified source
archive by `supplemental-notices.json`. The unchanged upstream zstd archive is
included too. The Homebrew notice collector checks these hashes and rejects an
unreviewed zstd source version, while preserving both original installed license
texts. This does not change the upstream license choices.
