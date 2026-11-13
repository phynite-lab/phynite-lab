"""Immutable manuscript evidence. Publication never executes TeX or scientific inputs."""
from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
import json
import math
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from backend.local_api.tls import verified_ssl_context
from backend.local_api.domain.ai_artifacts import AiArtifacts, encoded, fields, text
from backend.local_api.domain.ai_readers import AiReaders, path_value
from backend.local_api.domain.ai_workspace import clean, digest, fail
from backend.local_api.domain.dft_validation import dependency_dft_error
from backend.local_api.domain.phynite_core import json_safe, utc_now
from backend.local_api.domain.result_artifacts import read_result_manifest
from backend.local_api.domain.workflow_compiler import compiler_source, invoke

MAX_BYTES = 1_800_000  # Leave room for the immutable artifact envelope (2 MB).
SCALARS = {'totalEnergyRy': ('Total energy', 'Ry'), 'fermiEnergyEv': ('Fermi energy', 'eV'),
           'bandGapEv': ('Band gap', 'eV'), 'maximumForceRyBohr': ('Maximum force', 'Ry/bohr'),
           'pressureKbar': ('Pressure', 'kbar')}
PROVENANCE = {'code', 'codeVersion', 'software', 'softwareVersion', 'qeVersion', 'workflowSettings',
              'pseudopotentials', 'modelIdentity', 'reciprocalPath', 'structureSha256', 'versions'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url): return None


def retrieve(url):
    """Only identifier-constructed fixed endpoints; no model/user URL or credentials."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'api.crossref.org', 'export.arxiv.org'} or parsed.username or parsed.password or parsed.port:
        raise ValueError('Unsupported bibliography endpoint.')
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=verified_ssl_context()), NoRedirect())
    with opener.open(urllib.request.Request(url, headers={'Accept': 'application/json, application/atom+xml', 'User-Agent': 'PhyniteLab/1.0 (bibliography verification)'}), timeout=10) as response:
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000: raise ValueError('Bibliography response exceeds 1 MB.')
    return raw


def plain(value):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', '', str(value))).strip()[:2000]


def reference_id(value):
    fields(value, {'doi', 'arxivId'})
    if len(value) != 1: fail(400, 'Use exactly one DOI or arXiv ID per reference.', 'AI_MANUSCRIPT_REFERENCE')
    key = next(iter(value)); identifier = value[key]
    pattern = r'10\.\d{4,9}/[^\s<>?#]{1,240}' if key == 'doi' else r'(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d{1,3})?'
    if not isinstance(identifier, str) or not re.fullmatch(pattern, identifier): fail(400, 'Use a public DOI or arXiv identifier.', 'AI_MANUSCRIPT_REFERENCE')
    return key, identifier


def verify_reference(value):
    key, identifier = reference_id(value)
    if key == 'doi':
        url = 'https://api.crossref.org/works/' + urllib.parse.quote(identifier, safe='')
        raw = retrieve(url); item = json.loads(raw)['message']
        if str(item.get('DOI', '')).lower() != identifier.lower(): raise ValueError('DOI identity mismatch.')
        title = item.get('title', [])
        if not isinstance(title, list) or not title: raise ValueError('Title is missing.')
        result = {'doi': item['DOI'], 'title': plain(title[0]), 'authors': [plain(' '.join(str(person.get(part, '')) for part in ('given', 'family'))) for person in item.get('author', [])[:50]], 'source': 'Crossref', 'url': 'https://doi.org/' + urllib.parse.quote(item['DOI'], safe='/')}
        dates = item.get('published', {}).get('date-parts', [[]])
        if dates and dates[0] and type(dates[0][0]) is int: result['year'] = dates[0][0]
        for source, target in [('container-title', 'journal'), ('volume', 'volume'), ('issue', 'issue'), ('page', 'pages'), ('article-number', 'articleNumber')]:
            field = item.get(source)
            if isinstance(field, list): field = field[0] if field else None
            if isinstance(field, (str, int)) and str(field).strip(): result[target] = plain(field)
    else:
        url = 'https://export.arxiv.org/api/query?' + urllib.parse.urlencode({'id_list': identifier})
        raw = retrieve(url)
        if re.search(br'<!DOCTYPE|<!ENTITY', raw, re.I): raise ValueError('Unsupported bibliography XML.')
        root = ET.fromstring(raw); ns = {'a': 'http://www.w3.org/2005/Atom'}
        entry = root.find('a:entry', ns)
        if entry is None: raise ValueError('arXiv entry is missing.')
        returned = entry.findtext('a:id', '', ns).replace('http:', 'https:')
        found = returned.removeprefix('https://arxiv.org/abs/')
        if not returned.startswith('https://arxiv.org/abs/') or re.sub(r'v\d+$', '', found) != re.sub(r'v\d+$', '', identifier) or re.search(r'v\d+$', identifier) and found != identifier: raise ValueError('arXiv identity mismatch.')
        result = {'arxivId': found, 'title': plain(entry.findtext('a:title', '', ns)), 'authors': [plain(person.findtext('a:name', '', ns)) for person in entry.findall('a:author', ns)[:50]], 'source': 'arXiv', 'url': returned}
        year = entry.findtext('a:published', '', ns)[:4]
        if year.isdigit(): result['year'] = int(year)
    if not result['title']: raise ValueError('Title is missing.')
    return {**result, 'retrievedAt': utc_now(), 'providerSha256': hashlib.sha256(raw).hexdigest()}


def explicit_parameters(files):
    """Quote-aware tokenization; record only explicit assignments with exact input offsets."""
    specs = {'system': {'ecutwfc': 'Ry', 'ecutrho': 'Ry', 'degauss': 'Ry', 'occupations': '', 'smearing': '', 'nspin': 'dimensionless'}, 'electrons': {'conv_thr': 'Ry', 'mixing_beta': 'dimensionless', 'mixing_mode': '', 'diagonalization': '', 'electron_maxstep': 'iterations'}}
    result = []
    pattern = re.compile(r"'(?:(?:'')|[^'])*'|\"(?:(?:\"\")|[^\"])*\"|![^\n]*|[A-Za-z_][A-Za-z0-9_]*|[-+]?(?:\d+\.?\d*|\.\d+)(?:[dDeE][-+]?\d+)?|[&/=,]")
    for source in files:
        if source['role'] != 'input' or not source['path'].endswith('.in'): continue
        tokens = [token for token in pattern.finditer(source['text']) if not token.group().startswith('!')]
        section = None
        for index, token in enumerate(tokens):
            value = token.group()
            if value == '&': section = tokens[index + 1].group().lower() if index + 1 < len(tokens) else None
            elif value == '/': section = None
            elif value.lower() in specs.get(section, {}) and index + 2 < len(tokens) and tokens[index + 1].group() == '=':
                literal = tokens[index + 2]
                result.append({'name': section + '.' + value.lower(), 'valueText': literal.group(), 'unit': specs[section][value.lower()], 'sourcePath': source['path'], 'start': literal.start(), 'end': literal.end()})
    return result


class AiManuscripts:
    def __init__(self, ai):
        self.ai, self.services, self.artifacts, self.readers = ai, ai.services, AiArtifacts(ai), AiReaders(ai)

    def source(self, source):
        size = source['sizeBytes']
        if size > MAX_BYTES: fail(413, 'Selected evidence exceeds the manuscript limit. Export a smaller study.', 'AI_MANUSCRIPT_LIMIT')
        raw = source.get('_content')
        if raw is None:
            stream = self.services.s3.get_object(Bucket=self.services.bucket, Key=source['_key'])['Body']
            try: raw = stream.read(MAX_BYTES + 1)
            finally: stream.close()
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != source['sha256']: fail(409, 'Retained manuscript evidence failed its checksum.', 'AI_MANUSCRIPT_CHECKSUM')
        try: content = raw.decode('utf-8')
        except UnicodeDecodeError: fail(422, 'Select UTF-8 scientific evidence for the manuscript.', 'AI_MANUSCRIPT_SOURCE')
        if clean(content) != content: fail(422, 'Evidence contains sensitive text. Review the source before exporting.', 'AI_MANUSCRIPT_SOURCE')
        return {key: source[key] for key in ('path', 'role', 'sha256', 'sizeBytes')} | {'text': content}

    def create(self, owner, conversation, run, request):
        envelope = {'runId', 'lease', 'controlRevision', 'toolName', 'toolCallId'}
        fields(request, envelope | {'title', 'authors', 'calculationIds', 'figureIds', 'references', 'materialsProjectStructureIds', 'stamp'}, {'title', 'calculationIds', 'stamp', 'toolCallId'})
        call_id = request['toolCallId']
        if not isinstance(call_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', call_id): fail(400, 'Manuscript export requires an idempotent tool call.', 'AI_MANUSCRIPT_INVALID')
        request_hash = digest({key: value for key, value in request.items() if key not in envelope})
        existing = self.services.get_item(owner, 'AI_ARTIFACT', 'aid_' + digest([run['id'], call_id])[:32])
        if existing:
            artifact = self.artifacts.get(owner, conversation, existing['id'])
            if artifact.get('kind') != 'manuscript' or artifact['structuredData']['requestSha256'] != request_hash: fail(409, 'This manuscript call was used for different sources.', 'AI_ARTIFACT_CONFLICT')
            return artifact
        project = self.readers.project(owner, conversation)
        if request['stamp'] != self.ai.context(owner, conversation)['stamp']: fail(409, 'Project evidence changed. Review it before exporting.', 'AI_CONTEXT_CHANGED')
        title = text(request['title'], 'Manuscript title', 200, False)
        authors = request.get('authors', [])
        if not isinstance(authors, list) or len(authors) > 30: fail(400, 'Use at most thirty authors.', 'AI_MANUSCRIPT_INVALID')
        for author in authors:
            fields(author, {'name', 'affiliation'}, {'name', 'affiliation'})
            for key in author: text(author[key], key, 300, False)
        for field, maximum in [('calculationIds', 12), ('figureIds', 8), ('materialsProjectStructureIds', 8)]:
            ids = request.get(field, [])
            if not isinstance(ids, list) or len(ids) > maximum or any(not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier) for identifier in ids) or len(ids) != len(set(ids)): fail(400, f'{field} must contain at most {maximum} distinct saved IDs.', 'AI_MANUSCRIPT_INVALID')
        references = request.get('references', [])
        if not isinstance(references, list) or len(references) > 12: fail(400, 'Verify at most twelve references per archive.', 'AI_MANUSCRIPT_INVALID')
        for ref in references: reference_id(ref)
        missing = ['Author review of scientific interpretation, abstract, discussion and journal requirements.', 'Study-specific observable convergence and physical validation.', 'External pseudopotential/model files and qualified runtime are required for reproduction.']
        if not authors: missing.append('Author names and affiliations.')
        if not request['calculationIds']: missing.append('No executed calculations selected; this archive contains no computed results.')
        jobs, quantities, bindings = [], [], []
        for identifier in request['calculationIds']:
            item, inventory = self.readers.inventory(owner, conversation, {'resourceKind': 'calculation', 'resourceId': identifier})
            if item['status'] != 'COMPLETED' or dependency_dft_error(self.services, item): fail(422, 'Select completed calculations with positive final solver convergence evidence.', 'AI_MANUSCRIPT_UNVERIFIED')
            manifest, sha = read_result_manifest(self.services, item)
            selected = [file for file in inventory if file['role'] in {'input', 'log', 'evidence'} and '_key' in file and not file['path'].lower().endswith('.upf')]
            if not any(file['role'] == 'input' for file in selected) or not any(file['role'] == 'log' for file in selected): fail(422, 'Executed inputs and solver logs must be retained before exporting.', 'AI_MANUSCRIPT_UNVERIFIED')
            files = [self.source(file) for file in selected]
            provenance = {key: value for key, value in manifest.get('provenance', {}).items() if key in PROVENANCE}
            summary = json_safe(manifest.get('summary', {}))
            retained = json_safe({'calculationId': identifier, 'calculationType': item['calculationType'], 'status': manifest['status'], 'summary': summary, 'provenance': provenance})
            if clean(retained) != retained: fail(422, 'Manuscript evidence contains sensitive metadata.', 'AI_MANUSCRIPT_SOURCE')
            method = digest({'inputs': [{'path': f['path'], 'sha256': f['sha256']} for f in files if f['role'] == 'input'], 'provenance': provenance})
            jobs.append({'id': identifier, 'revision': int(item['revision']), 'calculationType': item['calculationType'], 'manifestSha256': sha, 'result': retained, 'files': files, 'parameters': explicit_parameters(files), 'methodFingerprint': method})
            bindings.append(('CALCULATION', identifier, int(item['revision'])))
            for key, (label, unit) in SCALARS.items():
                value = summary.get(key)
                if value is None: continue
                if type(value) not in {float, int} or not math.isfinite(value): fail(422, 'Computed manuscript quantities must be finite.', 'AI_MANUSCRIPT_UNVERIFIED')
                scope = summary.get('bandGapScope') if key == 'bandGapEv' else 'retained final solver summary'
                if key == 'bandGapEv' and scope not in {'sampled-k-path', 'full-brillouin-zone'}: fail(422, 'Band-gap results require an explicit verified sampling scope.', 'AI_MANUSCRIPT_UNVERIFIED')
                if scope == 'full-brillouin-zone' and summary.get('fullBrillouinZoneGapVerified') is not True: fail(422, 'Full-zone band gap lacks validation.', 'AI_MANUSCRIPT_UNVERIFIED')
                quantities.append({'calculationId': identifier, 'label': label, 'value': value, 'unit': unit, 'scope': scope, 'jsonPointer': '/summary/' + key, 'methodFingerprint': method})
            if not provenance: missing.append(f'{identifier}: software/model provenance is missing.')
            self.limit(jobs)
        figures = []
        for identifier in request.get('figureIds', []):
            resource = self.ai.resource(owner, conversation, 'figure', identifier)
            figure = resource['document']; datasets = []
            bindings.append(('FIGURE', identifier, int(resource['revision'])))
            for dataset_id in dict.fromkeys(layer['datasetId'] for panel in figure['panels'] for layer in panel['layers']):
                resource = self.ai.resource(owner, conversation, 'dataset', dataset_id); dataset = resource['document']
                bindings.append(('DATASET', dataset_id, int(resource['revision'])))
                job = next((job for job in jobs if job['id'] == dataset['source'].get('calculationId')), None)
                if not job: fail(422, 'Every figure dataset must come from a selected executed calculation.', 'AI_MANUSCRIPT_FIGURE')
                _, inventory = self.readers.inventory(owner, conversation, {'resourceKind': 'calculation', 'resourceId': job['id']})
                source = next((source for source in inventory if source['path'] == dataset['source']['filename'] and source['role'] == 'data' and source['sha256'] == dataset['source']['sha256']), None)
                if not source: fail(409, 'Figure source is not in its calculation artifact manifest.', 'AI_MANUSCRIPT_FIGURE')
                original = self.source(source)
                if dataset['source'].get('text') != original['text']: fail(409, 'Figure does not retain the exact numerical source.', 'AI_MANUSCRIPT_FIGURE')
                if not any(file['path'] == source['path'] for file in job['files']): job['files'].append(original)
                datasets.append(dataset)
            rendered = invoke('manuscriptFigure', [figure, datasets, [job['result'] for job in jobs]])
            figures.append({'figure': figure, 'revision': int(self.ai.row(owner, 'FIGURE', identifier)['revision']), 'datasets': datasets, 'svg': rendered, 'svgSha256': hashlib.sha256(rendered.encode()).hexdigest()})
            self.limit([jobs, figures])
        comparisons = []
        for identifier in request.get('materialsProjectStructureIds', []):
            row = self.ai.row(owner, 'STRUCTURE', identifier)
            if row.get('projectId') != project.get('remoteId'): fail(404, 'MP comparison structure is outside this project.', 'AI_NOT_FOUND')
            stream = self.services.s3.get_object(Bucket=self.services.bucket, Key=row['objectKey'])['Body']
            try: raw = stream.read(MAX_BYTES + 1)
            finally: stream.close()
            if len(raw) > MAX_BYTES or hashlib.sha256(raw).hexdigest() != row.get('sha256'): fail(409, 'MP source checksum changed.', 'AI_MANUSCRIPT_CHECKSUM')
            source = json.loads(raw)
            mp_id = source.get('externalId'); retained = source.get('sourceData'); provenance = source.get('provenance', {})
            if source.get('source') != 'Materials Project' or not isinstance(mp_id, str) or not re.fullmatch(r'mp-\d+', mp_id) or not isinstance(retained, dict) or retained.get('format') != 'materials-project-json' or not isinstance(retained.get('content'), str): fail(422, 'Use an original saved Materials Project snapshot with its MP-ID.', 'AI_MANUSCRIPT_MP')
            original_sha = hashlib.sha256(retained['content'].encode()).hexdigest()
            if original_sha != retained.get('sha256') or provenance.get('sourceSha256') != original_sha or provenance.get('database') != 'materials-project' or provenance.get('id') != mp_id: fail(409, 'Materials Project source snapshot identity/checksum changed.', 'AI_MANUSCRIPT_CHECKSUM')
            snapshot = json.loads(retained['content'])
            dated = provenance.get('retrievedAt')
            if snapshot.get('material_id') != mp_id or not isinstance(dated, str) or not re.match(r'\d{4}-\d{2}-\d{2}', dated): fail(422, 'MP comparison needs its original identity and dated retrieval snapshot.', 'AI_MANUSCRIPT_MP')
            comparisons.append({'structureId': identifier, 'mpId': mp_id, 'snapshotAt': dated, 'sourceUpdatedAt': snapshot.get('last_updated'), 'sourceSha256': original_sha, 'structureSha256': row['sha256'], 'snapshot': snapshot, 'method': plain(snapshot.get('method') or snapshot.get('run_type')) if snapshot.get('method') or snapshot.get('run_type') else None, 'units': {'band_gap': 'eV', 'energy_above_hull': 'eV/atom'}})
            bindings.append(('STRUCTURE', identifier, int(row['revision'])))
            if not comparisons[-1]['method']: missing.append(f'{mp_id}: Materials Project method is unknown; no quantitative comparison is asserted.')
        verified = []
        with ThreadPoolExecutor(max_workers=4) as executor:
            pending = [(ref, executor.submit(verify_reference, ref)) for ref in references]
            for ref, future in pending:
                try:
                    value = future.result()
                    if not any((value.get('doi') and value.get('doi', '').lower() == row.get('doi', '').lower() or value.get('arxivId') and value.get('arxivId') == row.get('arxivId')) for row in verified): verified.append(value)
                    if not value['authors'] or 'year' not in value: missing.append(f'{next(iter(ref.values()))}: bibliographic author/year metadata is incomplete.')
                except Exception:
                    missing.append(f'{next(iter(ref.values()))}: bibliography lookup unavailable or mismatched; no citation was invented.')
        if not references: missing.append('No bibliography identifiers selected.')
        snapshot = {'schemaVersion': 1, 'template': 'aps-prb-revtex4-2', 'status': 'draft', 'title': title, 'authors': authors, 'projectId': project['id'], 'conversationId': conversation['id'], 'createdAt': utc_now(), 'sourceStamp': request['stamp'], 'requestSha256': request_hash, 'jobs': jobs, 'quantities': quantities, 'figures': figures, 'references': verified, 'materialsProject': comparisons, 'missingInformation': list(dict.fromkeys(missing)), 'rendererSha256': hashlib.sha256(compiler_source().encode()).hexdigest() if figures else None}
        self.limit(snapshot)
        if clean(snapshot) != snapshot: fail(422, 'Review sensitive manuscript metadata before export.', 'AI_MANUSCRIPT_SOURCE')
        with self.services.table.atomic():
            live_conversation = self.ai.row(owner, 'AI_CONVERSATION', conversation['id'])
            live_run = self.ai.run(owner, live_conversation, request)
            if live_run.get('controlRevision', 0) != request.get('controlRevision', 0): fail(409, 'User direction changed while preparing the archive.', 'AI_STEER_PENDING')
            if any(read_result_manifest(self.services, self.ai.row(owner, 'CALCULATION', job['id']))[1] != job['manifestSha256'] for job in jobs): fail(409, 'Retained result manifest changed while preparing the archive.', 'AI_CONTEXT_CHANGED')
            if request['stamp'] != self.ai.context(owner, conversation)['stamp'] or any(int(self.ai.row(owner, kind, identifier)['revision']) != revision for kind, identifier, revision in bindings): fail(409, 'Manuscript sources changed while preparing the archive. Review the latest evidence.', 'AI_CONTEXT_CHANGED')
            return self.artifacts.publish(owner, conversation, live_run, {'kind': 'manuscript', 'title': title, 'content': 'APS/PRB manuscript draft from retained executed evidence. Review missing information before submission.', 'structuredData': snapshot, 'status': 'draft', 'toolCallId': call_id}, manuscript=True)

    def limit(self, value):
        if len(encoded(value)) > MAX_BYTES: fail(413, 'Selected manuscript evidence exceeds 1.8 MB. Export fewer calculations or figures.', 'AI_MANUSCRIPT_LIMIT')
