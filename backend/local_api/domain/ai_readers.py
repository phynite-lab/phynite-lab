"""Owner/project-scoped scientific evidence readers. Never return storage locations."""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any

from backend.local_api.domain.ai_workspace import clean, fail, valid_id
from backend.local_api.domain.phynite_core import ApiError

READ_OPERATIONS = {'job_artifacts', 'job_file', 'dataset_query', 'potential_search', 'jobs',
                   'job_status', 'worker_status', 'calculation_diagnosis', 'md_preview'}
READ_FIELDS = {
    'job_artifacts': {'resourceKind', 'resourceId', 'cursor'},
    'job_file': {'resourceKind', 'resourceId', 'path', 'mode', 'startLine', 'lineCount', 'pattern', 'caseInsensitive'},
    'dataset_query': {'datasetId', 'seriesIds', 'xMin', 'xMax', 'maxPoints', 'includeSourceHeader'},
    'potential_search': {'provider', 'elements', 'query'}, 'jobs': {'kind', 'limit'},
    'job_status': {'kind', 'id'}, 'worker_status': set(),
    'calculation_diagnosis': {'calculationId'}, 'md_preview': {'workflow', 'configurationId'},
}
JOB_KINDS = {'calculation': 'CALCULATION', 'simulation': 'MD_SIMULATION',
             'analysis': 'MD_ANALYSIS', 'workflow_run': 'PROJECT_RUN'}
FINAL = {'COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED', 'STOPPED', 'SUCCEEDED'}
MAX_TEXT_BYTES = 6_000_000
OUTPUT_BYTES = 16_000


def integer(value: Any, lower: int, upper: int, name: str) -> int:
    if type(value) is not int or not lower <= value <= upper:
        fail(400, f'{name} must be an integer from {lower} to {upper}.', 'AI_TOOL_INPUT_INVALID')
    return value


def path_value(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 500 or not re.fullmatch(r'[A-Za-z0-9_.+\-/]+', value) or value.startswith('/') or any(part in {'', '.', '..'} for part in value.split('/')):
        fail(400, 'Choose an exact relative path returned by list_job_artifacts.', 'AI_FILE_PATH_INVALID')
    return value


def encoded_size(value: Any) -> int:
    return len(json.dumps(value, allow_nan=False).encode())


def summary(points: list) -> dict:
    finite = [(x, y) for x, y in points if isinstance(x, (int, float)) and isinstance(y, (int, float))
              and not isinstance(x, bool) and not isinstance(y, bool) and math.isfinite(x) and math.isfinite(y)]
    result = {'pointCount': len(points), 'finitePointCount': len(finite), 'gapPointCount': len(points) - len(finite)}
    for axis, name in [(0, 'X'), (1, 'Y')]:
        values = [point[axis] for point in points if type(point[axis]) in {int, float} and math.isfinite(point[axis])]
        if values:
            result.update({'min' + name: min(values), 'max' + name: max(values)})
    return result


def sample_points(points: list, maximum: int) -> list[int]:
    """Retain endpoints and ordered bucket extrema; indices keep sample gaps explicit."""
    if len(points) <= maximum:
        return list(range(len(points)))
    chosen = {0, len(points) - 1}
    buckets = max(1, (maximum - 2) // 2)
    for bucket in range(buckets):
        start, end = 1 + (len(points) - 2) * bucket // buckets, 1 + (len(points) - 2) * (bucket + 1) // buckets
        indices = list(range(start, end))
        finite = [i for i in indices if isinstance(points[i][1], (int, float)) and math.isfinite(points[i][1])]
        if finite:
            chosen.update((min(finite, key=lambda i: points[i][1]), max(finite, key=lambda i: points[i][1])))
        elif indices:
            chosen.update((indices[0], indices[-1]))
    return sorted(chosen)


def grep_matcher(pattern: Any, insensitive: Any):
    # A bounded regex subset avoids backtracking on untrusted multi-megabyte logs.
    # Alternatives, anchors and ordered literal fragments cover scientific log searches.
    if not isinstance(pattern, str) or not 1 <= len(pattern) <= 120 or type(insensitive) is not bool:
        fail(400, 'Grep needs a pattern of 1–120 characters and a boolean caseInsensitive.', 'AI_GREP_INVALID')
    branches = pattern.split('|')
    if len(branches) > 8:
        fail(400, 'Use at most eight grep alternatives.', 'AI_GREP_INVALID')
    parsed = []
    for branch in branches:
        anchored_start, anchored_end = branch.startswith('^'), branch.endswith('$')
        branch = branch.removeprefix('^').removesuffix('$')
        parts = branch.split('.*')
        if not branch or len(parts) > 4 or any(re.search(r'[\\[\]()+*?{}^$]', part) for part in parts):
            fail(400, 'Use literal grep alternatives, optional ^/$ anchors and up to three .* separators; groups and repetitions are unsupported.', 'AI_GREP_INVALID')
        parsed.append((anchored_start, anchored_end, [part.casefold() if insensitive else part for part in parts]))
    def matches(line):
        line = line.casefold() if insensitive else line
        for anchored_start, anchored_end, parts in parsed:
            position, valid = 0, True
            for index, part in enumerate(parts):
                found = line.rfind(part, position) if anchored_end and index == len(parts) - 1 else line.find(part, position)
                if found < 0 or index == 0 and anchored_start and found != 0:
                    valid = False
                    break
                position = found + len(part)
            if valid and (not anchored_end or position == len(line)):
                return True
        return False
    return matches


class AiReaders:
    def __init__(self, ai):
        self.ai, self.services = ai, ai.services

    def project(self, owner, conversation):
        project = self.ai.scope(owner, conversation.get('projectKey'))
        if not project:
            fail(409, 'Choose a saved project before reading scientific resources.', 'AI_PROJECT_REQUIRED')
        return project

    def job(self, owner, conversation, kind, item_id):
        if not isinstance(kind, str) or kind not in JOB_KINDS:
            fail(400, 'Choose calculation, simulation, analysis or workflow_run.', 'AI_TOOL_INPUT_INVALID')
        project = self.project(owner, conversation)
        item = self.ai.row(owner, JOB_KINDS[kind], valid_id(item_id))
        expected = project['id'] if kind == 'workflow_run' else project.get('remoteId')
        if not expected or item.get('projectId') != expected:
            fail(404, 'This job is not in the selected project.', 'AI_NOT_FOUND')
        return item

    def inventory(self, owner, conversation, payload):
        kind = payload.get('resourceKind')
        if kind == 'workflow_run':
            fail(400, 'Choose a calculation, simulation or analysis artifact.', 'AI_TOOL_INPUT_INVALID')
        item = self.job(owner, conversation, kind, payload.get('resourceId'))
        files = []
        if kind == 'calculation' and item.get('inputKey'):
            envelope = json.loads(self.ai.api.get_calculation_files(owner, item['id'])['body'])
            for source in envelope['files']:
                raw = source['content'].encode()
                files.append({**{key: source[key] for key in ('path', 'role', 'contentType', 'sizeBytes')},
                              'sha256': hashlib.sha256(raw).hexdigest(), '_content': raw})
        if item.get('outputPrefix') and str(item.get('status')).upper() in FINAL:
            if kind == 'calculation':
                from backend.local_api.domain.result_artifacts import read_result_manifest
                manifest, _ = read_result_manifest(self.services, item)
            elif kind == 'analysis':
                from backend.local_api.domain.md_results import read_md_diagnostic_manifest, read_md_result_manifest
                manifest = (read_md_result_manifest if item['status'] == 'COMPLETED' else read_md_diagnostic_manifest)(self.services, item)
            else:
                from backend.local_api.domain.result_artifacts import read_result_manifest
                manifest, _ = read_result_manifest(self.services, item)
                if manifest.get('kind') != 'md-simulation':
                    fail(409, 'The result is not this MD simulation.', 'AI_FILE_MANIFEST_INVALID')
            artifacts = manifest.get('artifacts', [])
            if not isinstance(artifacts, list) or len(artifacts) > 10000:
                fail(409, 'The saved artifact inventory is invalid.', 'AI_FILE_MANIFEST_INVALID')
            for source in artifacts:
                if not isinstance(source, dict):
                    fail(409, 'Each saved artifact must have a path and checksum.', 'AI_FILE_MANIFEST_INVALID')
                path = path_value(source.get('path'))
                sha = source.get('sha256')
                if not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{64}', sha) or type(source.get('sizeBytes')) is not int or source['sizeBytes'] < 0:
                    fail(409, 'Artifact size and SHA-256 must be recorded before reading.', 'AI_FILE_MANIFEST_INVALID')
                if any(not isinstance(source.get(key, default), str) or len(source.get(key, default)) > maximum for key, default, maximum in [('role', 'output', 80), ('contentType', 'application/octet-stream', 120)]):
                    fail(409, 'Artifact type metadata exceeds its bounds.', 'AI_FILE_MANIFEST_INVALID')
                files.append({'path': path, 'sha256': sha, 'sizeBytes': source['sizeBytes'],
                              'role': source.get('role', 'output'), 'contentType': source.get('contentType', 'application/octet-stream'),
                              '_key': item['outputPrefix'].rstrip('/') + '/' + path})
        if len({file['path'] for file in files}) != len(files):
            fail(409, 'Artifact paths are duplicated. Inspect the retained manifest.', 'AI_FILE_MANIFEST_INVALID')
        return item, files

    def artifacts(self, owner, conversation, payload):
        item, files = self.inventory(owner, conversation, payload)
        stamp = hashlib.sha256(json.dumps([{k: v for k, v in file.items() if not k.startswith('_')} for file in files], sort_keys=True).encode()).hexdigest()
        cursor = payload.get('cursor')
        offset = 0
        if cursor is not None:
            if not isinstance(cursor, str) or not re.fullmatch(r'[a-f0-9]{64}:\d{1,5}', cursor) or cursor.split(':')[0] != stamp:
                fail(409, 'The artifact inventory changed. Reload its first page.', 'AI_FILE_PAGE_CHANGED')
            offset = int(cursor.split(':')[1])
            if offset <= 0 or offset >= len(files):
                fail(400, 'Choose a returned artifact cursor.', 'AI_FILE_PAGE_CHANGED')
        page = []
        for file in files[offset:offset + 20]:
            entry = {k: v for k, v in file.items() if not k.startswith('_')}
            if encoded_size(page + [entry]) > OUTPUT_BYTES - 1000:
                break
            page.append(entry)
        return clean({'files': page,
                      'resourceId': item['id'], 'totalArtifacts': len(files), 'manifestSha256': stamp,
                      'nextCursor': f'{stamp}:{offset + len(page)}' if offset + len(page) < len(files) else None})

    def file(self, owner, conversation, payload):
        requested = path_value(payload.get('path'))
        _, files = self.inventory(owner, conversation, payload)
        source = next((file for file in files if file['path'] == requested), None)
        if not source:
            fail(404, 'Choose a path in this job’s input or verified artifact inventory.', 'AI_FILE_NOT_FOUND')
        if source['sizeBytes'] > MAX_TEXT_BYTES:
            fail(413, 'Choose a text artifact no larger than 6 MB.', 'AI_FILE_TOO_LARGE')
        raw = source.get('_content')
        if raw is None:
            raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=source['_key'])['Body'].read(MAX_TEXT_BYTES + 1)
        if len(raw) != source['sizeBytes'] or hashlib.sha256(raw).hexdigest() != source['sha256']:
            fail(409, 'The file no longer matches its saved size and checksum.', 'AI_FILE_CHECKSUM')
        try:
            text = raw.decode('utf-8')
            if any(ord(char) < 32 and char not in '\t\r\n' for char in text):
                raise ValueError()
        except (UnicodeError, ValueError) as exc:
            raise ApiError(415, 'This artifact is binary. Choose a UTF-8 log or input file.', 'AI_BINARY_UNSUPPORTED') from exc
        lines = text.splitlines()
        count = integer(payload.get('lineCount', 120), 1, 200, 'lineCount')
        mode = payload.get('mode')
        start = integer(payload.get('startLine', 1), 1, max(1, len(lines) + 1), 'startLine') - 1
        matches = None
        if mode == 'grep':
            matcher = grep_matcher(payload.get('pattern'), payload.get('caseInsensitive', False))
            found = [i for i in range(start, len(lines)) if matcher(lines[i])]
            selected = sorted({j for i in found[:50] for j in range(max(start, i - 2), min(len(lines), i + 3))})[:count]
            matches = [{'line': i + 1, 'text': lines[i]} for i in found[:50] if i in selected]
        elif mode in {'head', 'tail', 'lines'}:
            start = max(0, len(lines) - count) if mode == 'tail' else 0 if mode == 'head' else start
            selected = list(range(start, min(len(lines), start + count)))
        else:
            fail(400, 'Choose head, tail, lines or grep.', 'AI_TOOL_INPUT_INVALID')
        result = {'path': requested, 'sha256': source['sha256'], 'totalLines': len(lines), 'mode': mode,
                  'startLine': None, 'endLine': None, 'nextLine': None, 'truncated': False,
                  'lineNumbers': [], 'lines': []}
        for index in selected:
            if encoded_size({**result, 'lines': result['lines'] + [lines[index]], 'lineNumbers': result['lineNumbers'] + [index + 1]}) > OUTPUT_BYTES - 2000:
                if not result['lines']:
                    fail(413, 'One line exceeds the text window. Use a smaller text source or query_dataset for numerical data.', 'AI_FILE_LINE_TOO_LARGE')
                break
            result['lines'].append(lines[index])
            result['lineNumbers'].append(index + 1)
        if result['lineNumbers']:
            result['startLine'], result['endLine'] = result['lineNumbers'][0], result['lineNumbers'][-1]
            result['nextLine'] = result['endLine'] + 1 if result['endLine'] < len(lines) else None
        result['truncated'] = bool(result['nextLine']) or len(result['lines']) < len(selected)
        if matches is not None:
            result['matches'] = [match for match in matches if match['line'] in result['lineNumbers']]
            # Matched text already occurs in lines; keep both within the byte cap.
            if encoded_size(result) >= OUTPUT_BYTES:
                result['matches'] = [{'line': match['line']} for match in result['matches']]
        return clean(result)

    def dataset(self, owner, conversation, payload):
        saved = self.ai.resource(owner, conversation, 'dataset', valid_id(payload.get('datasetId')))
        document = saved['document']
        selected = payload.get('seriesIds')
        if selected is not None and (not isinstance(selected, list) or not 1 <= len(selected) <= 8 or any(not isinstance(value, str) or len(value) > 400 for value in selected) or len(set(selected)) != len(selected)):
            fail(400, 'Choose one to eight exact series IDs.', 'AI_TOOL_INPUT_INVALID')
        low, high = payload.get('xMin'), payload.get('xMax')
        if any(value is not None and (type(value) not in {int, float} or not math.isfinite(value)) for value in (low, high)) or low is not None and high is not None and low > high:
            fail(400, 'Choose a finite, ordered x window in the source units.', 'AI_TOOL_INPUT_INVALID')
        maximum = integer(payload.get('maxPoints', 128), 16, 256, 'maxPoints')
        if type(payload.get('includeSourceHeader', False)) is not bool:
            fail(400, 'includeSourceHeader must be boolean.', 'AI_TOOL_INPUT_INVALID')
        entries = [(quantity, series) for quantity in document['data']['quantities'] for series in quantity['series']]
        qualified = lambda entry: entry[0]['id'] + '/' + entry[1]['id']
        chosen = []
        if selected is None:
            chosen = entries[:8]
        else:
            for identifier in selected:
                matches = [entry for entry in entries if identifier in {qualified(entry), entry[1]['id']}]
                if len(matches) != 1:
                    fail(400, 'Series IDs must identify one saved series; use quantityId/seriesId for ambiguous IDs.', 'AI_DATASET_SERIES_INVALID')
                if matches[0] not in chosen:
                    chosen.append(matches[0])
        metadata = document['metadata']
        source = {key: document['source'][key] for key in ('filename', 'sha256', 'parserVersion') if key in document['source']}
        if payload.get('includeSourceHeader'):
            source['header'] = '\n'.join(document['source'].get('text', '').splitlines()[:20])[:2000]
        result = {'id': document['id'], 'name': document['name'], 'revision': saved['revision'],
                  'source': source, 'metadata': metadata, 'kind': document['data']['kind'], 'xLabel': document['data'].get('xLabel'),
                  'totalSeries': len(entries), 'omittedSeries': len(entries) - len(chosen),
                  'nextSeriesIds': [qualified(entry) for entry in entries if entry not in chosen][:8],
                  'sampling': 'Ordered bucket minima/maxima with original point indices; samples are partial evidence.', 'series': []}
        while True:
            result['series'] = []
            for quantity, series in chosen:
                points = series['points']
                window = [(i, point) for i, point in enumerate(points) if (low is None and high is None) or
                          isinstance(point[0], (int, float)) and (low is None or point[0] >= low) and (high is None or point[0] <= high)]
                indices = sample_points([point for _, point in window], maximum)
                result['series'].append({'id': quantity['id'] + '/' + series['id'], 'label': series.get('label'),
                                         'quantity': quantity['label'], 'yLabel': quantity.get('yLabel'),
                                         'summary': summary(points), 'window': summary([point for _, point in window]),
                                         'indices': [window[i][0] for i in indices], 'points': [window[i][1] for i in indices],
                                         'omittedPointFields': [key for key in ('weights', 'projections') if key in series],
                                         'sampled': len(indices) < len(window)})
            if encoded_size(result) < OUTPUT_BYTES:
                return clean(result)
            if maximum <= 16:
                fail(413, 'Metadata and selected series exceed 16 KB. Choose fewer series or a narrower saved dataset.', 'AI_DATASET_WINDOW_TOO_LARGE')
            maximum = max(16, maximum // 2)

    def jobs(self, owner, conversation, payload):
        project = self.project(owner, conversation)
        kind = payload.get('kind', 'all')
        if not isinstance(kind, str) or kind not in {'all', *JOB_KINDS}:
            fail(400, 'Choose a supported job kind.', 'AI_TOOL_INPUT_INVALID')
        maximum = integer(payload.get('limit', 25), 1, 25, 'limit')
        jobs = []
        for name, entity in JOB_KINDS.items():
            if kind not in {'all', name}:
                continue
            expected = project['id'] if name == 'workflow_run' else project.get('remoteId')
            for item in self.services.list_owner_items(owner, entity):
                if expected and item.get('projectId') == expected and str(item.get('status', '')).upper() not in FINAL:
                    jobs.append({**self.job_summary(item), 'kind': name})
        jobs.sort(key=lambda item: (item.get('createdAt', ''), item['id']), reverse=True)
        return {'jobs': clean(jobs[:maximum]), 'totalActiveJobs': len(jobs), 'truncated': len(jobs) > maximum}

    @staticmethod
    def job_summary(item):
        return {key: item[key] for key in ('id', 'name', 'status', 'progress', 'createdAt', 'updatedAt', 'completedAt',
                                          'failureReason', 'statusMessage', 'calculationType', 'checkpointState', 'reconciliationState') if key in item}

    def read(self, operation, owner, conversation, payload):
        if not isinstance(payload, dict) or set(payload) - (READ_FIELDS.get(operation, set()) | {'runId', 'lease', 'controlRevision'}):
            fail(400, 'This reader received unsupported arguments.', 'AI_TOOL_INPUT_INVALID')
        if operation == 'job_artifacts': return self.artifacts(owner, conversation, payload)
        if operation == 'job_file': return self.file(owner, conversation, payload)
        if operation == 'dataset_query': return self.dataset(owner, conversation, payload)
        if operation == 'jobs': return self.jobs(owner, conversation, payload)
        if operation == 'job_status': return clean(self.job_summary(self.job(owner, conversation, payload.get('kind'), payload.get('id'))))
        if operation == 'worker_status':
            self.project(owner, conversation)
            worker = self.services.get_item(owner, 'PERSONAL_WORKER', 'primary') or {}
            return clean({'compute': self.ai.compute_context(owner), 'lastHeartbeatAt': worker.get('lastSeenAtEpoch'),
                          'activeJobCount': self.jobs(owner, conversation, {'kind': 'all'})['totalActiveJobs']})
        if operation == 'potential_search':
            self.project(owner, conversation)
            from backend.local_api.domain.potential_catalog import search
            elements, query = payload.get('elements'), payload.get('query', '')
            if not isinstance(elements, list) or not 1 <= len(elements) <= 10 or any(not isinstance(value, str) for value in elements) or not isinstance(query, str) or len(query) > 200:
                fail(400, 'Choose up to ten elements and a public query of at most 200 characters.', 'AI_TOOL_INPUT_INVALID')
            try:
                rows = search(payload.get('provider'), elements, query)
                return clean({'potentials': rows[:5], 'totalMatches': len(rows), 'truncated': len(rows) > 5, 'note': 'Refine the public query to narrow these matches; suitability remains unassessed.'})
            except (ValueError, TypeError) as exc:
                raise ApiError(400, str(exc), 'AI_POTENTIAL_INVALID') from exc
        if operation == 'calculation_diagnosis':
            item = self.job(owner, conversation, 'calculation', payload.get('calculationId'))
            details = self.ai.resource(owner, conversation, 'calculation', item['id'])
            return clean({'calculation': self.job_summary(item), 'summary': details.get('details', {}).get('result', {}).get('summary', {})})
        if operation == 'md_preview':
            project = self.project(owner, conversation)
            if payload.get('configurationId'):
                self.ai.resource(owner, conversation, 'md_configuration', valid_id(payload['configurationId']))
            workflow = self.ai.api.normalize_md_workflow_for_user(owner, 'ai-preview', payload.get('workflow'))
            self.ai.api.require_md_potential_scope(owner, project.get('remoteId') or '', workflow)
            if encoded_size(workflow) > 12000:
                fail(413, 'The workflow exceeds the preview window. Inspect a smaller saved workflow.', 'AI_MD_PREVIEW_TOO_LARGE')
            return {'valid': True, 'workflow': clean(workflow), 'computeTarget': 'personal', 'executed': False}
        fail(404, 'This scientific reader is unavailable.', 'AI_NOT_FOUND')
