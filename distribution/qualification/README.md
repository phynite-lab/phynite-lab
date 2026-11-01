# Native scientific release qualification

Run this gate on each actual target machine after building the launcher and
platform npm tarballs from the same public source commit:

```sh
python3 scripts/qualify-local-science.py \
  --launcher-tarball /path/to/phynite-lab-0.1.0.tgz \
  --runtime-tarball /path/to/phynite-lab-runtime-darwin-arm64-0.1.0.tgz \
  --output /path/to/new-evidence-directory
```

The harness itself needs Python's standard library, Node.js >=22.13 and npm.
The installed application runs with a fresh HOME, an empty PATH, and disposable
data outside its installation directory. It obtains scientific Python and
solvers through the real native setup endpoint. It never uses the harness's
Python for a scientific run. Runtime downloads may be large and require network
access; a failed download, unsupported sandbox, or absent fixture fails the gate.
Neither Docker nor cloud credentials are used.

`report.json` binds the actual host/kernel, version, public source commit and
both npm tarball SHA-256 values. WSL2 identity comes from the real kernel marker.
The gate never accepts a target-name flag or a manually written success report
as evidence. All reference runs retain actual inputs, outputs, checksummed
application artifacts, provenance, logs, and finite numerical comparisons.
The release collector publishes only the explicitly checksummed attachments,
never the raw installation, data directory, service token or process metadata.

The required cases include an actual installed-application Run: HTTP project,
structure and pseudopotential upload, saved workflow, queued QE calculation,
owned worker claim/execution, completed result import, and downloading every
artifact through the application's paginated API with SHA-256/size checks.
Its exact executed input, independently checked energy and model provenance
must match the pinned upstream fixture. A second real queued job waits on an
explicit draft dependency and is cancelled through the API before execution.
The harness stops and restarts the installed launcher, re-downloads the exact
completed manifest and checks that cancellation survives a real worker poll.
These checks never insert a result, invoke a fabricated worker, or update queue
status directly. Browser interaction remains a separate tarball/UI acceptance
gate; the application science gate uses the actual control-plane endpoints.

Separate kernel diagnostics cover QE SCF; MD Guided and manual;
OVITO coordination analysis; OS sandbox probing and command/file/network
denials; aggregate resource admission, cancel, RSS watchdog and restart; and
corrupt/interrupted installer downloads plus a failed atomic activation.
Conda fault tests preserve the real installed runtime. The activation test
downloads and installs the actual pinned MD packages into a new inactive prefix,
requires successful scientific qualification, then denies only the final atomic
inventory replacement. This adds a second MD installation to the gate; its
successful imports are never presented as a numerical simulation. Every case runs in newly created job/test
directories; an existing output directory is refused.

## Independent numerical references

`qe/fixture.json` pins the input and pre-existing golden output from the
Quantum ESPRESSO upstream test suite at commit
`770a0b2d12928a67048e2f3da8d10d057e52179e` (QE 7.5). That retained upstream
output was produced by QE 6.1 and establishes a total energy of
**-15.79449593 Ry**, with the predeclared **1e-5 Ry** regression tolerance.
The candidate must also satisfy Phynite's actual SCF convergence and checksum
contracts. Only `pseudo_dir`, `outdir`, and `prefix` IO paths are set for the
disposable run; physical parameters and QE defaults stay as supplied upstream.
The golden output is independently parsed without the application's parser.
This is a bounded software regression reference, not a convergence study or
experimental validation of silicon.

The official `Si.pz-vbc.UPF` is fetched separately from its provider only after
checking its pinned SHA-256. No UPF or solver model is included in the source
checkout, npm packages or release attachments. The provider's pseudopotential
terms apply; this fixture manifest grants no new distribution rights. If that
provider changes or removes the bytes, the check fails. A reviewed replacement
fixture may be selected with `--qe-fixture DIRECTORY`; it must have a versioned
manifest, pinned input/model/golden hashes and an independent expected energy
with a tolerance declared before execution. Local copies are accepted only
when their bytes match that contract.

MD uses the independent analytical unshifted Lennard-Jones minimum:
`r = 2^(1/6)*sigma`, `V = -epsilon`, with epsilon 0.0103 eV and sigma 3.4 Å.
Two stationary Ar particles, explicit masses, a 40 Å periodic box and an 8.5 Å
cutoff exclude interactions with periodic images. Both Guided and manual jobs
execute five NVE steps at 1 fs. Every sample must retain the analytical potential
energy and zero kinetic energy within 1e-10 eV, and the correct physical time.
OVITO independently analyses the same exact frame: each atom has one neighbour
within 4 Å, giving mean coordination 1. These cases verify small exact inputs;
they do not qualify another material, potential or research workflow.

Passing a source integration run or unit suite is insufficient for publication.
The release gate additionally requires clean tarball/UI acceptance and native
scientific evidence from all four native targets and both WSL2 architectures.
