"""Explicit source model transfer for generated workflow consumers.

Manual legacy jobs keep their original pipeline. This compiler never attempts to
split arbitrary manual inputs into a new shared-SCF workflow.
"""
from __future__ import annotations
import re
from typing import Any
from backend.local_api.domain.phynite_core import ApiError

CARD = re.compile(r"(?im)^[ \t]*(ATOMIC_SPECIES|ATOMIC_POSITIONS|CELL_PARAMETERS|K_POINTS|HUBBARD|CONSTRAINTS|OCCUPATIONS|ATOMIC_FORCES)\b[^\n]*(?:\n|$)")


def card(text: str, name: str) -> str | None:
    cards = list(CARD.finditer(text))
    for index, match in enumerate(cards):
        if match.group(1).upper() == name:
            return text[match.start():cards[index + 1].start() if index + 1 < len(cards) else len(text)].rstrip() + "\n"
    return None


def replace_card(text: str, name: str, value: str) -> str:
    original = card(text, name)
    return text.replace(original.rstrip(), value.rstrip(), 1) if original else text.rstrip() + "\n" + value


def inherit_scf_model(source: str, target: str) -> str:
    system = re.search(r"(?ims)&SYSTEM\b(.*?)^\s*/", source)
    target_system = re.search(r"(?ims)&SYSTEM\b(.*?)^\s*/", target)
    if not system or not target_system:
        raise ApiError(422, "Shared SCF requires generated, explicit SYSTEM namelists.", "SCF_MODEL_MISMATCH")
    body = system.group(1)
    for name in ("nbnd", "occupations", "smearing", "degauss"):
        pattern = rf"(?im)^\s*{name}\s*=\s*[^,\n/]+,?"
        value = re.search(pattern, target_system.group(1))
        body = re.sub(pattern, "", body)
        if value:
            body += "\n" + value.group().strip() + "\n"
    target = target[:target_system.start()] + "&SYSTEM" + body + "/" + target[target_system.end():]
    for name in ("ATOMIC_SPECIES", "ATOMIC_POSITIONS", "CELL_PARAMETERS", "HUBBARD"):
        value = card(source, name)
        if value:
            target = replace_card(target, name, value)
        elif name == "HUBBARD" and card(target, name):
            raise ApiError(422, "A consumer cannot add Hubbard terms to the shared SCF model.", "SCF_MODEL_MISMATCH")
    for name in ("prefix", "outdir", "pseudo_dir"):
        pattern = rf"\b{name}\s*=\s*['\"][^'\"]*['\"]"
        source_value = re.search(pattern, source, re.I)
        if source_value:
            target = re.sub(pattern, source_value.group(), target, flags=re.I)
    return target.rstrip() + "\n"


def apply_structure(text: str, structure: dict[str, Any]) -> str:
    atoms = structure["atoms"]
    vectors = structure["lattice"]["vectors"]
    species = card(text, "ATOMIC_SPECIES") or ""
    labels = {line.split()[0] for line in species.splitlines()[1:] if line.strip()}
    if set(atom["species"] for atom in atoms) != labels:
        raise ApiError(422, "The frame element mapping differs from this module's pseudopotentials. Configure the new structure first.", "WORKFLOW_ELEMENTS_CHANGED")
    text = re.sub(r"\bnat\s*=\s*\d+", f"nat = {len(atoms)}", text, flags=re.I)
    text = replace_card(text, "ATOMIC_POSITIONS", "ATOMIC_POSITIONS crystal\n" + "\n".join(f"{atom['species']} {atom['x']:.16g} {atom['y']:.16g} {atom['z']:.16g}" for atom in atoms) + "\n")
    return replace_card(text, "CELL_PARAMETERS", "CELL_PARAMETERS angstrom\n" + "\n".join(" ".join(f"{value:.16g}" for value in row) for row in vectors) + "\n")
