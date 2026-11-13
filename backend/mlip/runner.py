"""Trusted MACE+ASE adapter. No foundation-model helper or network download path."""
from __future__ import annotations
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

# Works with isolated Python (-I) and from the frozen core's retained runner source.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.mlip.contract import MODEL, checksum, file_sha, geometry, protocol, validate_result


def calculate(request: dict, model_path: Path, *, cancelled=lambda: False, calculator=None) -> dict:
    g, p = geometry(request['geometry']), protocol(request['protocol'])
    if file_sha(model_path) != MODEL['sha256']:
        raise ValueError('MACE model checksum differs from the approved model; it will not be loaded.')
    if importlib.metadata.version('mace-torch') != MODEL['version']:
        raise ValueError('Install the exact approved mace-torch version.')
    import numpy as np
    import torch
    from ase import Atoms
    from ase.optimize import BFGS
    torch.set_num_threads(1)
    torch.set_default_dtype(torch.float64)
    if calculator is None:
        from mace.calculators import MACECalculator
        calculator = MACECalculator(model_paths=str(model_path), device='cpu', default_dtype='float64')
    atoms = Atoms(symbols=g['symbols'], scaled_positions=g['scaledPositions'], cell=g['cellAngstrom'], pbc=g['periodic'])
    atoms.calc = calculator
    started = time.monotonic()
    def check():
        if cancelled(): raise InterruptedError('MLIP cancelled; no completed result was retained.')
        if time.monotonic() - started >= p['wallSeconds']: raise TimeoutError('MLIP wall budget exhausted.')
    check(); steps = 0
    if p['mode'] == 'relax_fixed_cell':
        # Never use a cell filter: only positions can move. Original request is immutable.
        optimizer = BFGS(atoms, logfile=None)
        optimizer.attach(check, interval=1)
        optimizer.run(fmax=p['fmaxEvAngstrom'], steps=p['maxSteps'])
        steps = optimizer.nsteps
    check()
    energy, forces = float(atoms.get_potential_energy()), atoms.get_forces()
    maximum = float(np.linalg.norm(forces, axis=1).max())
    final = {**g, 'scaledPositions': atoms.get_scaled_positions(wrap=False).tolist()}
    if p['mode'] == 'single_point': final = g
    value = {'schemaVersion': 1, 'model': MODEL, 'requestSha256': checksum(request), 'protocolSha256': checksum(p), 'energyEv': energy, 'energyPerAtomEv': energy / len(atoms),
             'forcesEvAngstrom': forces.tolist(), 'finalGeometry': final, 'steps': steps, 'converged': maximum <= p['fmaxEvAngstrom'], 'elapsedSeconds': time.monotonic() - started}
    return validate_result(value, request)


if __name__ == '__main__':
    request_path, model_path, result_path = map(Path, sys.argv[1:])
    value = calculate(json.loads(request_path.read_text()), model_path, cancelled=lambda: (request_path.parent / 'cancel').exists())
    pending = result_path.with_suffix('.pending')
    pending.write_text(json.dumps(value, sort_keys=True, allow_nan=False))
    os.replace(pending, result_path)
