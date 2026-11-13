"""Real-model CPU qualification. Only this successful report activates a local runtime."""
from __future__ import annotations
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.mlip.contract import MODEL, checksum
from backend.mlip.runner import calculate


def qualify(model: Path) -> dict:
    import copy
    import numpy as np
    g = {'symbols': ['Si', 'Si'], 'scaledPositions': [[0, 0, 0], [.26, .25, .25]], 'cellAngstrom': [[0, 2.715, 2.715], [2.715, 0, 2.715], [2.715, 2.715, 0]], 'periodic': [True, True, True]}
    p = {'mode': 'single_point', 'fmaxEvAngstrom': .02, 'maxSteps': 30, 'wallSeconds': 120}
    request = {'geometry': g, 'protocol': p}
    base = calculate(request, model)
    # Fractional perturbations converted to Cartesian derivative: dE/ds_i = -F dot a_i.
    delta = 1e-4; plus, minus = copy.deepcopy(request), copy.deepcopy(request)
    plus['geometry']['scaledPositions'][1][0] += delta
    minus['geometry']['scaledPositions'][1][0] -= delta
    derivative = (calculate(plus, model)['energyEv'] - calculate(minus, model)['energyEv']) / (2*delta)
    analytic = -float(np.dot(base['forcesEvAngstrom'][1], g['cellAngstrom'][0]))
    force_error = abs(derivative - analytic)
    shifted = copy.deepcopy(request)
    shifted['geometry']['scaledPositions'][1][0] += 1
    periodic_error = abs(calculate(shifted, model)['energyEv'] - base['energyEv'])
    relax = calculate({'geometry': g, 'protocol': {**p, 'mode': 'relax_fixed_cell'}}, model)
    cancelled = False
    try: calculate(request, model, cancelled=lambda: True)
    except InterruptedError: cancelled = True
    flags = {'finiteDifference': force_error < 1e-3, 'periodicity': periodic_error < 1e-8, 'fixedCellRelaxation': relax['converged'] and relax['finalGeometry']['cellAngstrom'] == g['cellAngstrom'], 'cancellation': cancelled}
    if not all(flags.values()): raise ValueError('Actual MACE qualification failed: ' + json.dumps(flags))
    return {'schemaVersion': 1, 'model': MODEL, 'passed': True, 'checks': flags, 'forceErrorEv': force_error, 'periodicEnergyErrorEv': periodic_error, 'fixtureSha256': checksum(request), 'baseResult': base, 'relaxResult': relax}


if __name__ == '__main__':
    result = qualify(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(result, sort_keys=True, allow_nan=False))
