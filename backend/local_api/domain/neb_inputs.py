"""Bounded fixed-cell NEB input contract (also shipped to API admission)."""
from __future__ import annotations
import math
import re


def validate_neb_input(text: str) -> dict:
    clean = '\n'.join(line.split('!', 1)[0] for line in text.splitlines())
    for card in ('BEGIN', 'BEGIN_PATH_INPUT', 'END_PATH_INPUT', 'BEGIN_ENGINE_INPUT', 'BEGIN_POSITIONS', 'END_POSITIONS', 'END_ENGINE_INPUT', 'END'):
        if len(re.findall(r'^\s*'+card+r'\s*$', clean, re.M | re.I)) != 1:
            raise ValueError('NEB requires one complete path/engine supercard input.')
    prefixes=re.findall(r"\bprefix\s*=\s*['\"]([^'\"]+)['\"]",clean,re.I)
    if len(prefixes)!=1 or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}',prefixes[0]) or '..' in prefixes[0]: raise ValueError('NEB prefix must be a safe identifier up to 96 characters, without path segments.')
    def number(key: str) -> float:
        values = re.findall(r'\b'+key+r'\s*=\s*([-+0-9.eEdD]+)', clean, re.I)
        if len(values) != 1: raise ValueError('NEB needs an explicit unique '+key+'.')
        value = float(values[0].replace('D','e').replace('d','e'))
        if not math.isfinite(value): raise ValueError('NEB parameters must be finite.')
        return value
    images, steps, threshold, nat = (number(key) for key in ('num_of_images','nstep_path','path_thr','nat'))
    if not images.is_integer() or not 3 <= images <= 32 or not steps.is_integer() or not 1 <= steps <= 10000 or not 0 < threshold <= 10 or not nat.is_integer() or not 1 <= nat <= 100000:
        raise ValueError('NEB image count, steps, threshold or atom count is outside its bounds.')
    if not re.search(r"\bfirst_last_opt\s*=\s*\.false\.", clean, re.I) or not re.search(r"\bminimum_image\s*=\s*\.false\.", clean, re.I):
        raise ValueError('Use fixed endpoints and explicitly interpolated PBC images for this NEB workflow.')
    records = list(re.finditer(r'^\s*(FIRST_IMAGE|INTERMEDIATE_IMAGE|LAST_IMAGE)\s*\n\s*ATOMIC_POSITIONS\s+(?:\{\s*)?crystal(?:\s*\})?\s*\n', clean, re.M|re.I))
    if len(records) != int(images) or records[0].group(1).upper() != 'FIRST_IMAGE' or records[-1].group(1).upper() != 'LAST_IMAGE' or any(m.group(1).upper() != 'INTERMEDIATE_IMAGE' for m in records[1:-1]):
        raise ValueError('NEB must retain every interpolated image in initial atomic order.')
    species = None
    for record in records:
        rows = clean[record.end():].splitlines()[:int(nat)]
        if len(rows) != nat: raise ValueError('An NEB image has missing atoms.')
        current = []
        for row in rows:
            fields = row.split()
            if len(fields) != 4 or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', fields[0]): raise ValueError('NEB positions need species and three fractional coordinates.')
            try: finite = all(math.isfinite(float(v.replace('D','e').replace('d','e'))) for v in fields[1:])
            except ValueError: finite = False
            if not finite: raise ValueError('NEB coordinates must be finite.')
            current.append(fields[0])
        if species is not None and species != current: raise ValueError('NEB image species and atomic order must match.')
        species = current
    return {'images':int(images), 'steps':int(steps), 'thresholdEvAngstrom':threshold, 'atomCount':int(nat)}
