# Linux sandbox bootstrap notices and source

The packaged bootstrap contains bubblewrap 0.13.1 and `libcap.so.2` from libcap
2.78. Both pinned Linux ARM64 and x64 ELF payloads were inspected: bubblewrap
needs libcap plus the operating system's glibc/ELF loader; libcap needs only those
system libraries. This inspection does not qualify execution on either target.
The actual files copied into a release are listed with SHA-256 in
`bootstrap/manifest.json`.

## Original licenses and attribution

- Bubblewrap declares `LGPL-2.0-or-later`. Its original, unmodified `COPYING`
  contains the GNU Lesser General Public License 2.1 and is preserved in
  [bubblewrap-COPYING.txt](bubblewrap-COPYING.txt). Original source copyright and
  permission notices are preserved in [bubblewrap-COPYRIGHT.txt](bubblewrap-COPYRIGHT.txt).
- Libcap offers `BSD-3-Clause OR GPL-2.0-only` in its original `License` file.
  This distribution uses the offered BSD 3-clause option. The complete original
  dual-license text is preserved in [libcap-LICENSE.txt](libcap-LICENSE.txt),
  together with source notices in [libcap-COPYRIGHT.txt](libcap-COPYRIGHT.txt).
  Explicit per-file notices remain applicable.
- Original conda-forge recipes retain their BSD 3-clause notice in
  [conda-forge-LICENSE.txt](conda-forge-LICENSE.txt). Target-specific recipe trees
  are preserved under [recipes/](recipes/).

These components keep their own licenses. Phynite's AGPL license does not replace
them. Micromamba, patchelf, compiler runtimes and the rest of the build prefix are
build ingredients; the bootstrap assembler copies only the executable and its
non-system dependency closure. Their metadata and notices are retained by the
builder, but this document does not claim their executables are shipped in the
bootstrap. Scientific solver runtime notices are separate.

## Exact corresponding source

The public source release includes these original upstream archives, verified
against the exact source checksums in the conda recipes:

| Component | Included source archive | SHA-256 |
| --- | --- | --- |
| bubblewrap 0.13.1 | [bubblewrap-0.13.1.tar.gz](../../sources/bootstrap/bubblewrap-0.13.1.tar.gz) | `b5cdc362b4bbe8906318ec68418de1fb050a8c6701534a81c0e94088ad74c22e` |
| libcap 2.78 | [libcap-2.78.tar.xz](../../sources/bootstrap/libcap-2.78.tar.xz) | `0d621e562fd932ccf67b9660fb018e468a683d7b827541df27813228c996bb11` |

[sources.json](sources.json) records the original package URLs/checksums and the
exact conda-forge feedstock commits: bubblewrap
`4c35b3826535ecd25c5c43821a29c9baad387814` and libcap
`e5a4f7c9a9ca78963b89324b60f12e216df73536`.
The recipes include their upstream build scripts and per-target build settings.
The public [bootstrap assembler](../../../scripts/build-native-bootstrap.py)
and [lock](../../../backend/local_api/native-bootstrap-lock.json) specify
installation, dependency selection and ELF relocation. Phynite changes ELF
RPATH to relative `$ORIGIN` paths; it does not patch upstream program source.

Every binary release must provide equivalent access to a corresponding-source
archive on the same release service, including these upstream archives, recipes
and the matching Phynite build scripts. A link to an upstream project alone is
not that release artifact. Preserve the complete `distribution/sources/bootstrap`
and `distribution/notices/bootstrap` trees in the public source archive, rather
than shipping only this notice. No written source offer is substituted here.

## Rebuild and replace the library

Use the included source archives and original recipes on the matching native
Linux target. Building requires a development C toolchain, make, Meson, Ninja,
pkg-config and patchelf; these are developer requirements, not npm user
requirements. The recorded recipe trees contain the exact original compiler,
sysroot, flags and package build settings. A build with a different toolchain is
not claimed to reproduce the original binary bytes.

For a local source rebuild in a new, user-writable directory:

```sh
tar -xf bubblewrap-0.13.1.tar.gz
tar -xf libcap-2.78.tar.xz
PHYNITE_BOOTSTRAP_PREFIX="$PWD/rebuilt-prefix"
make -C libcap-2.78 CC=cc OBJCOPY=objcopy lib=lib
make -C libcap-2.78 prefix="$PHYNITE_BOOTSTRAP_PREFIX" lib=lib \
  SBINDIR="$PHYNITE_BOOTSTRAP_PREFIX/sbin" \
  PAM_LIBDIR="$PHYNITE_BOOTSTRAP_PREFIX/lib" RAISE_SETFCAP=no install
PKG_CONFIG_PATH="$PHYNITE_BOOTSTRAP_PREFIX/lib/pkgconfig" \
  meson setup bubblewrap-0.13.1/_builddir bubblewrap-0.13.1 \
  --prefix="$PHYNITE_BOOTSTRAP_PREFIX" -Dselinux=disabled
meson compile -C bubblewrap-0.13.1/_builddir
meson test -C bubblewrap-0.13.1/_builddir
meson install -C bubblewrap-0.13.1/_builddir
```

The shipped `bwrap` loads `libraries/libcap.so.2` dynamically through
`$ORIGIN/libraries`, so a compatible rebuilt library can replace that file.
Preserve the rebuilt library's ABI and set its own search path to `$ORIGIN` as
the assembler does. Recompute the bootstrap manifest and outer package checksum
inventory when assembling a modified release; they are integrity metadata, not
permission restrictions. Preserve corresponding source and license notices for
the changed version. The native write/network confinement probe must pass for
the resulting bootstrap before use. The source trees and build scripts remain
modifiable under their respective licenses.
