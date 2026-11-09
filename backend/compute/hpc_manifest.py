"""Bind the scientific runner's sparse result files before remote harvesting."""
from __future__ import annotations

import hashlib
from pathlib import Path


def main() -> None:
    directory = Path("results")
    directory.mkdir(mode=0o700, exist_ok=True)
    entries = []
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError("Remote results must not contain symbolic links")
        if not path.is_file() or path.name == "manifest.sha256":
            continue
        relative = path.relative_to(directory).as_posix()
        if any(ord(char) < 32 or ord(char) == 127 for char in relative):
            raise ValueError("Remote result filename contains control characters")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        entries.append(f"{digest.hexdigest()}  {relative}\n")
    if not entries:
        raise ValueError("The remote runner produced no result files")
    (directory / "manifest.sha256").write_text("".join(entries), encoding="utf-8")


if __name__ == "__main__":
    main()
