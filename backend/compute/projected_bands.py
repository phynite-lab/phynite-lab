"""QE 7.5 atomic_proj.xml with explicit projector and band/spin correspondence."""
from __future__ import annotations

import hashlib
import math
import re
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

import numpy as np

RY_EV = 13.605693122994
ORBITALS = {0: ['s'], 1: ['pz', 'px', 'py'], 2: ['dz2', 'dxz', 'dyz', 'dx2-y2', 'dxy']}


def projector_states(text: str) -> list[dict[str, Any]]:
    states = {}
    for match in re.finditer(r"state\s*#\s*(\d+)\s*:\s*atom\s*(\d+)\s*\(\s*([^\s)]+)\s*\)\s*,\s*wfc\s*(\d+)\s*\(([^)]*)\)", text, re.I):
        index, atom, species, radial, quantum = match.groups()
        numbers = {key.lower(): float(value) for key, value in re.findall(r"(m_j|s_z|l|m|j)\s*=\s*([+\-\d.]+)", quantum)}
        angular = numbers.get('l')
        if angular is None or not angular.is_integer() or not 0 <= angular <= 6:
            raise ValueError('Projection log has no supported angular momentum identity.')
        l = int(angular)
        if 'j' in numbers or 'm_j' in numbers:
            if not {'j', 'm_j'}.issubset(numbers):
                raise ValueError('SOC projection needs both j and m_j; real-orbital labels cannot be substituted.')
            orbital = f"l={l}, j={numbers['j']:g}, mj={numbers['m_j']:g}"
        else:
            m = numbers.get('m')
            if m is None or not m.is_integer() or not 1 <= m <= 2*l+1:
                raise ValueError('Projection log has an invalid real-harmonic index.')
            orbital = ORBITALS.get(l, [f'l={l}, m={i}' for i in range(1, 2*l+2)])[int(m)-1]
        if 's_z' in numbers:
            if numbers['s_z'] not in (-0.5,0.5): raise ValueError('Spinor projector needs spin-z ±0.5.')
            orbital += f", sz={numbers['s_z']:g}"
        key = int(index)
        value = {'id': str(key), 'atom': int(atom), 'species': species, 'wfc': int(radial), 'orbital': orbital, **numbers, 'l': l,
                 'label': f'{species} #{atom} / wfc {radial} / {orbital}'}
        if key in states and states[key] != value:
            raise ValueError('Projection state labels are ambiguous.')
        states[key] = value
    return [states[key] for key in sorted(states)]


def numbers(text: str | None) -> list[float]:
    try:
        values = [float(value.replace('D', 'e').replace('d', 'e')) for value in (text or '').translate(str.maketrans('(),', '   ')).split()]
    except ValueError as exc:
        raise ValueError('Atomic projection contains invalid numerical data.') from exc
    if not all(math.isfinite(value) for value in values):
        raise ValueError('Atomic projection contains non-finite data.')
    return values


def parse_projected_bands(path: Path, log_text: str, kpoints: np.ndarray, energies_ev: np.ndarray) -> dict[str, Any]:
    if path.stat().st_size > 100_000_000:
        raise ValueError('Atomic projections exceed the 100 MB parser limit. Reduce the projected path/band count.')
    raw = path.read_bytes()
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('Atomic projection XML must not contain external declarations.')
    root = ET.fromstring(raw)
    def tag(node: ET.Element) -> str:
        return node.tag.split('}')[-1]
    header = next((node for node in root if tag(node) == 'HEADER'), None)
    if header is None:
        raise ValueError('Atomic projection header is missing (QE 7.5 schema required).')
    try:
        nb, nk, ns, nw = [int(header.attrib[key]) for key in ('NUMBER_OF_BANDS', 'NUMBER_OF_K-POINTS', 'NUMBER_OF_SPIN_COMPONENTS', 'NUMBER_OF_ATOMIC_WFC')]
    except (ValueError, KeyError) as exc:
        raise ValueError('Atomic projection dimensions are invalid.') from exc
    if min(nb, nk, nw) < 1 or ns not in (1, 2) or nb*nk*ns*nw > 10_000_000 or energies_ev.shape != (nk, nb*ns) or kpoints.shape != (nk, 3):
        raise ValueError('Projection dimensions do not match the retained band eigenvalues, or exceed the projection limit.')
    channels = projector_states(log_text)
    if [int(channel['id']) for channel in channels] != list(range(1, nw+1)):
        raise ValueError('Every atomic projector must have an explicit atom/orbital label in the retained projwfc log.')
    eigenstates = next((node for node in root if tag(node) == 'EIGENSTATES'), None)
    if eigenstates is None:
        raise ValueError('Atomic projection eigenstates are missing.')
    groups = [node for node in eigenstates if tag(node) == 'PROJS']
    ks = [node for node in eigenstates if tag(node) == 'K-POINT']
    es = [node for node in eigenstates if tag(node) == 'E']
    if len(groups) != nk*ns or len(ks) != nk*ns or len(es) != nk*ns:
        raise ValueError('Atomic projections have incomplete k-point/spin records.')
    series: list[dict[str, list[float]]] = [{} for _ in range(nb*ns)]
    for offset, group in enumerate(groups):
        spin, ik = divmod(offset, nk)
        k = numbers(ks[offset].text)
        energy = numbers(es[offset].text)
        if len(k) != 3 or len(energy) != nb or not np.allclose(k, kpoints[ik], rtol=0, atol=1e-8) or not np.allclose(np.asarray(energy)*RY_EV, energies_ev[ik, spin*nb:(spin+1)*nb], rtol=0, atol=1e-5):
            raise ValueError('Projection k coordinates or eigenvalues differ from the retained band stage. Recompute the matching projections.')
        seen = set()
        for node in group:
            if tag(node) != 'ATOMIC_WFC':
                continue
            index = int(node.attrib.get('index', '0'))
            if index in seen or not 1 <= index <= nw or int(node.attrib.get('spin', '0')) != spin+1:
                raise ValueError('Atomic projector/spin identity is duplicated or inconsistent.')
            seen.add(index)
            complex_values = numbers(node.text)
            if len(complex_values) != 2*nb:
                raise ValueError('Every band needs a complete complex projection amplitude.')
            for band in range(nb):
                weight = complex_values[2*band]**2 + complex_values[2*band+1]**2
                if not math.isfinite(weight) or weight > 1+1e-5:
                    raise ValueError('Löwdin projector weight is outside its supported probability range.')
                series[spin*nb+band].setdefault(str(index), []).append(weight)
        if len(seen) != nw:
            raise ValueError('Atomic projection is missing projector weights.')
    return {'version': 1, 'basis': 'orthogonalized-atomic-global-axes', 'weightScale': 'absolute', 'channels': channels, 'series': series,
            'sourceSha256': hashlib.sha256(raw).hexdigest(), 'bandCountPerSpin': nb, 'spinChannels': ns, 'kpointCount': nk}
