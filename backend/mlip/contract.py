"""Closed MACE protocol; pure validation is shared by core and isolated runner."""
from __future__ import annotations
import copy
import hashlib
import json
import math
from pathlib import Path

MODEL = {'id': 'MACE-MP-0b3-medium', 'sha256': '2f2be696351ac9e94fbe01cdfb6f017679acdbd2db7645209ef55fec9826b012', 'sizeBytes': 79472952,
         'url': 'https://github.com/ACEsuit/mace-foundations/releases/download/mace_mp_0b3/mace-mp-0b3-medium.model', 'license': 'MIT', 'package': 'mace-torch', 'version': '0.3.17', 'device': 'cpu', 'dtype': 'float64'}


def checksum(value) -> str:
    # SQLite/metadata round-trips integral JSON floats as integers; normalize both before binding.
    def canonical(item):
        if isinstance(item, float) and math.isfinite(item) and item.is_integer(): return int(item)
        if isinstance(item, dict): return {key: canonical(number) for key, number in item.items()}
        if isinstance(item, list): return [canonical(number) for number in item]
        return item
    return hashlib.sha256(json.dumps(canonical(value), sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def file_sha(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024): sha.update(block)
    return sha.hexdigest()


def protocol(value: dict) -> dict:
    if not isinstance(value, dict) or set(value) != {'mode', 'fmaxEvAngstrom', 'maxSteps', 'wallSeconds'}:
        raise ValueError('Review mode, force tolerance, maximum steps and wall seconds.')
    if value['mode'] not in {'single_point', 'relax_fixed_cell'} or type(value['maxSteps']) is not int or not 1 <= value['maxSteps'] <= 500 or type(value['wallSeconds']) is not int or not 1 <= value['wallSeconds'] <= 3600:
        raise ValueError('MLIP supports a single point or fixed-cell relaxation, at most 500 steps and one hour.')
    fmax = value['fmaxEvAngstrom']
    if type(fmax) not in {float, int} or not math.isfinite(fmax) or not .001 <= fmax <= .5:
        raise ValueError('Review a finite force tolerance from 0.001 to 0.5 eV/angstrom.')
    return copy.deepcopy(value)


def geometry(value: dict) -> dict:
    if not isinstance(value, dict) or set(value) != {'symbols', 'scaledPositions', 'cellAngstrom', 'periodic'}:
        raise ValueError('MLIP needs explicit elements, fractional positions, cell in angstrom and periodicity.')
    symbols, positions, cell, periodic = (value[key] for key in ('symbols', 'scaledPositions', 'cellAngstrom', 'periodic'))
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 256 or any(not isinstance(symbol, str) or not symbol.isalpha() or not 1 <= len(symbol) <= 2 for symbol in symbols):
        raise ValueError('Review explicit element symbols for one to 256 atoms.')
    if not isinstance(periodic, list) or len(periodic) != 3 or any(type(flag) is not bool for flag in periodic):
        raise ValueError('Confirm three explicit periodic axes.')
    for rows, length in ((positions, len(symbols)), (cell, 3)):
        if not isinstance(rows, list) or len(rows) != length or any(not isinstance(row, list) or len(row) != 3 or any(type(number) not in {int, float} or not math.isfinite(number) for number in row) for row in rows):
            raise ValueError('MLIP requires finite coordinates and three finite cell vectors.')
    a, b, c = cell
    det = a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0])
    if det <= 1e-9:
        raise ValueError('MLIP requires a nonsingular right-handed cell.')
    return copy.deepcopy(value)


def validate_result(value: dict, request: dict) -> dict:
    g = geometry(request['geometry']); p = protocol(request['protocol']); n = len(g['symbols'])
    if value.get('schemaVersion') != 1 or value.get('requestSha256') != checksum(request) or value.get('model') != MODEL or value.get('protocolSha256') != checksum(p):
        raise ValueError('MLIP result differs from the exact request, model or protocol.')
    final = geometry(value.get('finalGeometry'))
    if final['symbols'] != g['symbols'] or final['cellAngstrom'] != g['cellAngstrom'] or final['periodic'] != g['periodic']:
        raise ValueError('MLIP changed composition, periodicity or the fixed cell.')
    if p['mode'] == 'single_point' and final != g:
        raise ValueError('A single point changed the source geometry.')
    energy, per_atom, forces = (value.get(key) for key in ('energyEv', 'energyPerAtomEv', 'forcesEvAngstrom'))
    if any(type(number) not in {int, float} or not math.isfinite(number) for number in (energy, per_atom)) or not math.isclose(per_atom * n, energy, abs_tol=1e-8, rel_tol=1e-12):
        raise ValueError('MLIP energies are missing, nonfinite or inconsistent.')
    if not isinstance(forces, list) or len(forces) != n or any(not isinstance(row, list) or len(row) != 3 or any(type(number) not in {int, float} or not math.isfinite(number) for number in row) for row in forces):
        raise ValueError('MLIP requires one finite force vector per atom.')
    maximum = max(math.sqrt(sum(number**2 for number in row)) for row in forces)
    if type(value.get('steps')) is not int or not 0 <= value['steps'] <= p['maxSteps'] or type(value.get('converged')) is not bool or value['converged'] != (maximum <= p['fmaxEvAngstrom']):
        raise ValueError('MLIP convergence is inconsistent with its final forces or step budget.')
    return copy.deepcopy(value)
