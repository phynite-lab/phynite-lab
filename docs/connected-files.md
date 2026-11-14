# Connected Files

Open **Files** in a saved project. **Project files** holds selected verified imports;
scientific run inputs, logs and outputs remain in the existing artifact explorer.
Connect a named absolute root on **This computer / WSL** or an explicitly chosen
**HPC** profile. Merely configuring an HPC profile never grants folder access.
Roots start read-only. **Grant write access** separately permits edited copies.
**Revoke folder** rejects new access and cancels pending transfers for every agent.
Already sent AI messages keep their original evidence; a revoked snapshot cannot be
read again as new context.

The browser lists 200 entries per page and filters only the current directory.
It never recursively scans. Symlinks are visible but are not followed; devices,
FIFOs and sockets cannot be previewed, edited or transferred. Preview reads 64 KiB,
with explicit expansion to 256 KiB. The editor accepts UTF-8 up to 2 MiB and retains
BOM and existing newline conventions when saving a copy. Export your draft before
reloading: Files editor drafts stay mounted across tab closure but do not have the
independent durable draft recovery provided by Project Notes.

**Review edited copy** checks the source identity and SHA-256, shows a diff, and
requires **Save this copy** to write a new file. The original is preserved. A
changed source reports a conflict and retains editor text. A disconnected or
uncertain write is never automatically repeated. **Replace original** starts unavailable. After granting write access, choose
**Test replacement with temporary files** to exercise the actual helper in a private
scratch directory on that connected folder's filesystem. Successful checks enable
replacement for that exact root, helper, permission revision and current core
session. Restarting the core or changing permissions requires another test. The
checks verify UTF-8/BOM/newlines, exclusive copies, reviewed replacement, fsync,
checksums, mode preservation, conflicts and refusal of symlinks, traversal and special
files; they remove only their own scratch files.

**Review replacing original** prepares a diff without writing. Only
**Replace this reviewed original** applies it. Oversized replacement diffs are
rejected; save an edited copy instead. A qualified replacement still cannot promise
a transaction against external editors. An uncertain commit is retained and is
never repeated automatically.

Select 1–20 regular files, at most 1 GiB total, to import. Transfers are queued with
two active globally and one per source (this computer or HPC cluster). Progress,
disk requirements, Cancel and failures are visible. Every chunk and completed file
is checksum verified before it becomes a Project file. Interrupted partials and
already verified imports are retained; explicitly start a new transfer after
inspection. Project files can be downloaded through the same-origin artifact API.

**Add saved file to AI context** captures immutable selected UTF-8 text, checksum,
source identity and capability revision. Each file is limited to 32 KiB, with at
most eight files per parent and additional model/context limits. Unsaved editor
text never replaces the selected source silently. Folder contents cannot grant
tool permission.

The same fixed versioned Python stdlib helper runs locally and via the existing
OpenSSH transport. HPC requires Python 3.10+, verified host keys and a matching
profile. It consumes bounded structured requests, not `ls` output or agent shell
commands. No public listener is added. Native Windows folder access is outside v1;
run Phynite inside WSL2 to access that distro's `/home` and `/mnt/c`.

Local archives include file provenance and force restored roots to reconnect.
Cloud Sync has a separate allowlist and never carries connected roots. The core
flag `PHYNITE_CONNECTED_FILES=0` independently disables this API. Automated POSIX
and protocol tests do not qualify WSL2, `/mnt/c`, an HPC host, or replacement writes;
those require direct platform testing before activation claims. A root-local test
does not qualify unrelated filesystems, other WSL mount points, or another HPC host.

For an isolated real-filesystem report without touching a research project:

```sh
python3 scripts/qualify-connected-folder.py --root /absolute/test-folder \
  --output .agent-state/filesystem-qualification.json
```

This creates a temporary project/core and uses scratch files in the chosen folder.
It does not enable replacement in an already running application: test the connected
root there as well, then review each diff. No WSL2 or HPC target was available for
the initial macOS qualification; those platforms remain unqualified until directly
exercised.
