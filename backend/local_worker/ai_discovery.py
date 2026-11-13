"""Discovery v2: typed fixed-composition objectives and deterministic normalized GP/EI."""
from __future__ import annotations
import copy
import hashlib
import json
import math
import random
import re
from typing import Any

FIELDS = {'a': 'angstrom', 'b': 'angstrom', 'c': 'angstrom', 'alpha': 'degree', 'beta': 'degree', 'gamma': 'degree'}


def sha(value) -> str:
    def canonical(item):
        if isinstance(item, float) and math.isfinite(item) and item.is_integer(): return int(item)
        if isinstance(item, dict): return {key: canonical(value) for key, value in item.items()}
        if isinstance(item, list): return [canonical(value) for value in item]
        return item
    return hashlib.sha256(json.dumps(canonical(value), sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def finite(value) -> bool:
    return type(value) in {int, float} and math.isfinite(value)


def contract(value: dict, *, now: float) -> dict:
    required = {'version', 'parameters', 'objective', 'conditions', 'seed', 'budget'}
    if not isinstance(value, dict) or set(value) != required or value['version'] != 2: raise ValueError('A new Discovery v2 approval is required; legacy records grant no execution authority.')
    parameters = value['parameters']
    if not isinstance(parameters, list) or not 1 <= len(parameters) <= 5: raise ValueError('Discovery supports one to five dimensions.')
    names = set()
    for parameter in parameters:
        if not isinstance(parameter, dict) or set(parameter) != {'name', 'kind', 'min', 'max', 'unit'}: raise ValueError('Each dimension needs an explicit name, continuous/integer kind, bounds and unit.')
        name, low, high = parameter['name'], parameter['min'], parameter['max']
        if name not in FIELDS or name in names or parameter['unit'] != FIELDS[name] or parameter['kind'] not in {'continuous', 'integer'} or not finite(low) or not finite(high) or not 0 < low < high or name in {'alpha','beta','gamma'} and high >= 180 or parameter['kind'] == 'integer' and (type(low) is not int or type(high) is not int): raise ValueError('Review distinct lattice dimensions with valid bounds and exact units. Composition changes are unsupported.')
        names.add(name)
    objective = value['objective']
    if not isinstance(objective, dict) or set(objective) not in ({'kind','direction','unit'}, {'kind','direction','unit','target'}): raise ValueError('Review the typed objective, direction, unit and optional target.')
    if objective['kind'] not in {'dft_energy_per_atom','dft_band_gap'} or objective['unit'] != ('eV/atom' if objective['kind']=='dft_energy_per_atom' else 'eV') or objective['direction'] not in {'minimize','maximize','target'}: raise ValueError('Only fixed-composition DFT energy/atom or a validated DFT band gap is supported.')
    if (objective['direction'] == 'target') != ('target' in objective) or 'target' in objective and not finite(objective['target']): raise ValueError('Target objectives need a finite target with the same unit.')
    conditions = value['conditions']
    if not isinstance(conditions, dict) or set(conditions) - {'label','gapScope'} or not isinstance(conditions.get('label'), str) or not 1 <= len(conditions['label'].strip()) <= 500: raise ValueError('Retain the declared scientific conditions explicitly.')
    if objective['kind']=='dft_band_gap' and conditions.get('gapScope') not in {'sampled-k-path','full-brillouin-zone'} or objective['kind']=='dft_energy_per_atom' and 'gapScope' in conditions: raise ValueError('A gap objective must declare its numerical sampling scope.')
    if type(value['seed']) is not int or not 0 <= value['seed'] <= 2**32-1: raise ValueError('Discovery needs a persisted integer seed.')
    budget = value['budget']
    if not isinstance(budget, dict) or set(budget) - {'evaluations','wallSeconds','queueSeconds','totalNodeHours','expiresAtEpoch'}: raise ValueError('Review bounded evaluation, runtime, queue, node-hour and expiry budgets.')
    budget = {'evaluations':5, **budget}
    if type(budget['evaluations']) is not int or not 1 <= budget['evaluations'] <= 32 or any(type(budget.get(key)) is not int or not 1 <= budget[key] <= 604800 for key in ('wallSeconds','queueSeconds')) or not finite(budget.get('totalNodeHours')) or not 0 < budget['totalNodeHours'] <= 10000 or type(budget.get('expiresAtEpoch')) is not int or not now < budget['expiresAtEpoch'] <= now+604800: raise ValueError('Discovery allows up to 32 evaluations with finite budgets and approval expiry within seven days.')
    return {**copy.deepcopy(value), 'budget': budget}


def loss(value: float, objective: dict) -> float:
    return -value if objective['direction']=='maximize' else abs(value-objective['target']) if objective['direction']=='target' else value


def validate_observation(approved: dict, value: dict) -> dict:
    if not isinstance(value, dict) or value.get('status') != 'completed' or not finite(value.get('value')) or value.get('unit') != approved['contract']['objective']['unit'] or value.get('kind') != approved['contract']['objective']['kind'] or any(value.get(key) != approved[key] for key in ('methodSha256','compositionSha256','conditionsSha256')):
        raise ValueError('Observation is failed, missing, nonfinite or differs in composition, method, condition or unit.')
    if not isinstance(value.get('manifestSha256'),str) or not re.fullmatch('[a-f0-9]{64}', value['manifestSha256']): raise ValueError('Observation needs verified retained scientific output.')
    return copy.deepcopy(value)


def parameters(value: dict, dimensions: list[dict]) -> list[float]:
    if not isinstance(value, dict) or set(value) != {row['name'] for row in dimensions}: raise ValueError('Candidate dimensions differ from the approval.')
    result=[]
    for row in dimensions:
        number=value[row['name']]
        if not finite(number) or not row['min'] <= number <= row['max'] or row['kind']=='integer' and type(number) is not int: raise ValueError('Candidate is outside the approved typed bounds.')
        result.append((number-row['min'])/(row['max']-row['min']))
    return result


def expected_improvement(mean: float, sigma: float, best: float) -> float:
    if not all(finite(value) for value in (mean,sigma,best)) or sigma < 0: raise ValueError('GP prediction is unstable or nonfinite.')
    improvement=best-mean
    if sigma <= 1e-12: return max(0., improvement)
    z=improvement/sigma
    return max(0., improvement*.5*(1+math.erf(z/math.sqrt(2)))+sigma*math.exp(-.5*z*z)/math.sqrt(2*math.pi))


def next_candidate(approved: dict, candidates: list[dict], observations: list[dict]) -> dict:
    c=approved['contract']; dimensions=c['parameters']; seen={sha(row['parameters']) for row in candidates}
    rng=random.Random(c['seed']+len(candidates)*104729)
    values=[]
    for index in range(1024):
        row={}
        for dimension in dimensions:
            low,high=dimension['min'],dimension['max']
            number=(low+high)/2 if index==0 else low if index==1 else high if index==2 else rng.uniform(low,high)
            row[dimension['name']]=int(round(number)) if dimension['kind']=='integer' else number
        if sha(row) not in seen: values.append(row);seen.add(sha(row))
    if not values: raise ValueError('The approved discrete design space is exhausted.')
    if not observations: return values[0]
    from backend.local_worker.ai_operator import RbfGaussianProcess
    observed=[validate_observation(approved, row) for row in observations]
    x=[parameters(row['parameters'],dimensions) for row in observed]
    y=[loss(row['value'],c['objective']) for row in observed]
    gp=RbfGaussianProcess(length_scale=.35,seed=c['seed']).fit(x,y)
    mean,sigma=gp.predict([parameters(row,dimensions) for row in values])
    acquisition=[expected_improvement(mu,sd,min(y)) for mu,sd in zip(mean,sigma)]
    if len(acquisition)!=len(values): raise ValueError('GP returned incomplete predictions.')
    return values[max(range(len(values)),key=lambda index:(acquisition[index],sha(values[index])))]


if __name__=='__main__':
    from pathlib import Path
    import sys
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
    from backend.local_worker.ai_operator import require_discovery_runtime
    require_discovery_runtime()
    state=json.loads(Path(sys.argv[1]).read_text())
    result=next_candidate(state['approved'],state['candidates'],state['observations'])
    Path(sys.argv[2]).write_text(json.dumps({'parameters':result},sort_keys=True,allow_nan=False))
