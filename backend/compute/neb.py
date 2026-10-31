"""QE NEB evidence and native MEP data. Energies are eV, errors eV/Å."""
from __future__ import annotations
import csv
import hashlib
import math
import re
import shutil
from pathlib import Path
from typing import Any
from neb_inputs import validate_neb_input


def neb_results(work: Path, output: Path, input_text: str, *, require_success: bool = True) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    params = validate_neb_input(input_text)
    log = output / 'logs' / 'neb.out'
    text = log.read_text(encoding='utf-8', errors='replace') if log.is_file() else ''
    match = re.search(r"\bprefix\s*=\s*['\"]([A-Za-z0-9_][A-Za-z0-9_.-]{0,95})['\"]", input_text, re.I)
    if not match: raise ValueError('NEB prefix must be an explicit safe file identifier.')
    prefix = match.group(1)
    path = work / (prefix+'.dat')
    rows: list[list[float]] = []
    if path.is_file() and path.stat().st_size < 1000000:
        for line in path.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#'): continue
            values = [float(v.replace('D','e')) for v in line.split()]
            if len(values) != 3 or not all(math.isfinite(v) for v in values): raise ValueError('NEB MEP rows must contain finite coordinate, relative eV and error eV/Å.')
            rows.append(values)
    count = params['images']
    valid_path = len(rows) == count and abs(rows[0][0]) < 1e-6 and abs(rows[-1][0]-1) < 1e-6 and abs(rows[0][1]) < 1e-5 and all(0 <= row[2] for row in rows) and all(rows[i+1][0] > rows[i][0] for i in range(len(rows)-1))
    image_evidence = []
    evidence_dir = output / 'evidence'; evidence_dir.mkdir(parents=True, exist_ok=True)
    from results import parse_qe_output
    for image in range(1, count+1):
        source = work / 'tmp' / f'{prefix}_{image}' / 'PW.out'
        raw = source.read_bytes() if source.is_file() and source.stat().st_size <= 50000000 else b''
        parsed = parse_qe_output(raw.decode('utf-8',errors='replace'), 'scf', input_text=input_text)
        accuracy = parsed.get('scfAccuracy') or {}
        accepted = parsed.get('electronicConvergence') == 'converged' and accuracy.get('status') == 'verified' and parsed.get('solverError') is not True and parsed.get('hybridConvergence') in {'converged','not-applicable'}
        image_evidence.append({'image':image,'electronicConverged':accepted,'scfAccuracy':accuracy,'hybridConvergence':parsed.get('hybridConvergence'),'hybridFunctional':parsed.get('hybridFunctional'),'sha256':hashlib.sha256(raw).hexdigest() if raw else None})
        if raw: (evidence_dir / f'neb-image-{image}.out').write_bytes(raw)
    done = bool(re.search(r'^\s*JOB DONE\.\s*$',text,re.M))
    positive = bool(re.search(r'neb:\s*convergence achieved in\s+\d+\s+iterations',text,re.I))
    error = max((r[2] for r in rows[1:-1]), default=math.inf)
    accepted = valid_path and done and positive and error <= params['thresholdEvAngstrom'] and all(e['electronicConverged'] for e in image_evidence) and not re.search(r'Error in routine|convergence NOT achieved|Maximum CPU time exceeded',text,re.I)
    stage = {'stage':'neb','calculationMode':'neb','jobDone':done,'converged':accepted,'pathConverged':positive and valid_path and error<=params['thresholdEvAngstrom'],'maximumPathErrorEvAngstrom':error if math.isfinite(error) else None,'pathThresholdEvAngstrom':params['thresholdEvAngstrom'],'imageConvergence':image_evidence}
    summary = {'converged':accepted,'jobDone':done,'stageConvergence':[stage], 'nebImageCount':count,'pathThresholdEvAngstrom':params['thresholdEvAngstrom'], 'maximumPathErrorEvAngstrom':stage['maximumPathErrorEvAngstrom'], 'observableConvergence':{'status':'not-assessed','reason':'Refine image count, electronic settings and endpoints for the study.'}}
    if require_success and not accepted: raise ValueError('NEB lacks a complete converged path and electronic convergence for every image. Inspect neb.out and retained image logs; unconverged barriers are not accepted.')
    artifacts=[]
    if accepted:
        data = output / 'data'; data.mkdir(parents=True,exist_ok=True)
        csv_path = data / 'neb-mep.csv'
        with csv_path.open('w',newline='') as handle:
            writer=csv.writer(handle);writer.writerow(['reaction_coordinate','relative_energy_eV','path_error_eV_per_A']);writer.writerows(rows)
        for suffix in ('.dat','.int','.xyz','.axsf','.crd','.path'):
            source=work/(prefix+suffix)
            if source.is_file() and source.stat().st_size <= 50000000:
                shutil.copy2(source,data/('neb'+suffix))
                artifacts.append({'path':'data/neb'+suffix,'label':'NEB native '+suffix[1:]+' output','role':'raw-data','contentType':'text/plain'})
        summary.update({'forwardBarrierEv':max(r[1] for r in rows),'reverseBarrierEv':max(r[1] for r in rows)-rows[-1][1], 'barrierScope':'sampled converged images; fixed endpoints'})
        artifacts.insert(0, {'path':'data/neb-mep.csv','label':'Minimum energy path','role':'data','contentType':'text/csv'})
    return summary, artifacts
