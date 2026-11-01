"""Conservative, evidence-based categories for recent scientific job failures."""
from __future__ import annotations

import re


FAILURE_CATEGORIES = {
    "SCF_CONVERGENCE": "SCF convergence",
    "OUT_OF_MEMORY": "Out of memory",
    "MISSING_PSEUDOPOTENTIAL": "Pseudopotential unavailable",
    "ATOM_OVERLAP": "Unphysical atom overlap",
    "MD_INSTABILITY": "MD instability",
    "RUNTIME_OR_INFRASTRUCTURE": "Runtime or infrastructure",
    "OTHER": "Other / unclassified",
}


def classify_scientific_failure(reason: str) -> str:
    """Classify explicit failure evidence; never infer a scientific cause from a generic crash."""
    evidence = reason.lower()
    if re.search(r"out.of.memory|oom|cannot allocate memory|killed.*memory|memory.*exceed", evidence):
        return "OUT_OF_MEMORY"
    if re.search(r"scf.*(not converg|failed to converg|convergence)|convergence.*scf|electron_maxstep", evidence):
        return "SCF_CONVERGENCE"
    if re.search(r"pseudo.?potential.*(missing|not found|unavailable|cannot open)|\.upf.*(not found|missing|cannot open)", evidence):
        return "MISSING_PSEUDOPOTENTIAL"
    if re.search(r"atom.*(overlap|too close)|overlap.*atom|unphysical.*distance", evidence):
        return "ATOM_OVERLAP"
    if re.search(r"(lost atoms|non.?numeric atom|nan in.*thermo|bond atoms missing|timestep.*unstable)", evidence):
        return "MD_INSTABILITY"
    if re.search(r"worker lease expired|worker.*(crash|offline)|batch job failed|container.*(failed|exit)", evidence):
        return "RUNTIME_OR_INFRASTRUCTURE"
    return "OTHER"
