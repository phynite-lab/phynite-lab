"""Owner/project capabilities, bounded file snapshots and selected-file imports."""
from __future__ import annotations
import base64
import difflib
import hashlib
import json
import os
import re
import secrets
import selectors
import shutil
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .domain.phynite_core import ApiError, owner_partition, public_item, require_project, storage_owner, utc_now
from .file_protocol import perform, FileProtocolError, preserve_format, VERSION, MAX_EDIT, CHUNK


def fail(message, code='FILES_INVALID', status=400): raise ApiError(status, message, code)


def valid_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value): fail('Choose a valid source or operation identity.')
    return value


class ConnectedFiles:
    def __init__(self, services):
        self.s = services
        self.lock = threading.RLock(); self.closed = threading.Event(); self.cancellations = {}; self.running = set(); self.active_sources = set(); self.threads = set()
        self.temp = services.data_dir / 'connected-transfers'; self.temp.mkdir(mode=0o700, exist_ok=True)
        for row in self.s.list_owner_items(self.s.owner, 'FILE_TRANSFER'):
            if row.get('status') in {'queued', 'running'}:
                self.s.update_item(self.s.owner, 'FILE_TRANSFER', row['id'], {'status': 'interrupted', 'error': 'The launcher stopped. Partial files were retained. Start a new selected import explicitly.'})
        self.scheduler = threading.Thread(target=self.schedule, name='connected-file-transfers', daemon=True); self.scheduler.start()

    def close(self):
        self.closed.set()
        with self.lock:
            for event in self.cancellations.values(): event.set()
        self.scheduler.join(timeout=2)
        for thread in list(self.threads): thread.join(timeout=2)

    def scope(self, project):
        if os.environ.get('PHYNITE_CONNECTED_FILES', '1') == '0': fail('Connected Files is disabled for this workspace.', 'FILES_DISABLED', 404)
        require_project(self.s, self.s.owner, valid_id(project))

    def row(self, project, kind, key):
        self.scope(project); row = self.s.get_item(self.s.owner, kind, valid_id(key))
        if not row or row.get('projectId') != project: fail('This file source is not in the selected project.', 'FILE_NOT_FOUND', 404)
        return row

    def put(self, project, kind, key, values):
        row = {'PK': owner_partition(self.s.owner), 'SK': kind + '#' + key, 'id': key, 'entityType': kind, 'ownerId': self.s.owner, 'projectId': project, **values}; self.s.put_item(row); return row

    def root(self, project, key):
        root = self.row(project, 'CONNECTED_ROOT', key)
        if not root.get('active'): fail('This connected folder was revoked. Reconnect it before accessing new content.', 'FILE_ROOT_REVOKED', 409)
        return root

    def remote(self, root, request, cancel=None):
        from .hpc_profiles import HpcProfileStore, _ssh_client
        profile = HpcProfileStore(self.s).get(root['clusterId'])
        if not profile or profile['profileSha256'] != root['profileSha256']: fail('The HPC profile changed. Reconnect this folder and verify the host key.', 'FILE_HPC_CHANGED', 409)
        client = _ssh_client(profile['connection'])
        client.ensure_master(timeout=20)
        if cancel and cancel.is_set(): fail('File operation cancelled.', 'FILE_CANCELLED', 409)
        helper = base64.b64encode(Path(__file__).with_name('file_protocol.py').read_bytes()).decode()
        # Both executable and helper are fixed by the profile/application. File content is stdin data.
        import shlex
        python = str(profile.get('environment', {}).get('pythonExecutable') or 'python3')
        if python.startswith('-') or any(c in python for c in '\r\n\x00'): fail('Choose a valid Python executable in the HPC profile.')
        command = shlex.join([python, '-c', f"import base64;exec(base64.b64decode('{helper}'))"])
        payload = json.dumps(request).encode()
        if len(payload) > 4 * CHUNK: fail('This file request exceeds the bounded HPC protocol.', status=413)
        process = subprocess.Popen(['ssh', '-T', *client._base_ssh_args(), client.target, command], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output = bytearray(); errors = bytearray(); cursor = 0; deadline = time.monotonic() + 120
        try:
            with selectors.DefaultSelector() as select:
                for stream in [process.stdin, process.stdout, process.stderr]: os.set_blocking(stream.fileno(), False)
                select.register(process.stdin, selectors.EVENT_WRITE, 'input'); select.register(process.stdout, selectors.EVENT_READ, 'output'); select.register(process.stderr, selectors.EVENT_READ, 'error')
                while select.get_map():
                    if time.monotonic() > deadline or self.closed.is_set() or cancel and cancel.is_set(): fail('The HPC file operation stopped or disconnected. Inspect its state before retrying a write.', 'FILE_HPC_DISCONNECTED', 409)
                    for selected, _ in select.select(.1):
                        stream = selected.fileobj; channel = selected.data
                        if channel == 'input':
                            try: sent = os.write(stream.fileno(), payload[cursor:cursor + 65536]); cursor += sent
                            except BrokenPipeError: cursor = len(payload)
                            if cursor >= len(payload): select.unregister(stream); stream.close()
                        else:
                            data = os.read(stream.fileno(), 65536)
                            if not data: select.unregister(stream); continue
                            target = output if channel == 'output' else errors; target.extend(data)
                            if len(target) > (16 * CHUNK if channel == 'output' else 65536): fail('The HPC helper exceeded its output limit.', 'FILE_HELPER_LIMIT', 502)
            process.wait(timeout=5)
            try: result = json.loads(output)
            except (ValueError, UnicodeError): fail('HPC did not return the structured file protocol. Check Python 3.10+, SSH connectivity and the trusted host key.', 'FILE_HPC_PROTOCOL', 502)
            if not isinstance(result, dict) or result.get('version') != VERSION: fail('Reconnect using a matching HPC helper version.', 'FILE_HPC_PROTOCOL', 502)
            if result.get('error'): fail(str(result['error']), str(result.get('code', 'FILE_HPC_FAILED')), 409)
            if process.returncode != 0: fail('The HPC helper failed. Check SSH connectivity and the trusted host key.', 'FILE_HPC_DISCONNECTED', 502)
            return result['result']
        finally:
            if process.poll() is None: process.kill(); process.wait()
            for stream in [process.stdin, process.stdout, process.stderr]:
                if stream and not stream.closed: stream.close()

    def source(self, root, operation, values=None, cancel=None):
        fields = {'list': {'path', 'cursor', 'filter'}, 'read': {'path', 'identity', 'limit'}, 'edit': {'path', 'identity'}, 'hash': {'path', 'identity'}, 'chunk': {'path', 'identity', 'offset'}, 'write': {'path', 'identity', 'sha256', 'bytes', 'target', 'mode', 'operationId'}}
        request = {k: v for k, v in (values or {}).items() if k in fields.get(operation, set())}
        request.update(version=VERSION, root=root['path'], rootIdentity=root.get('rootIdentity'), operation=operation, writeAllowed=root.get('write', False), replaceQualified=False)
        try: return self.remote(root, request, cancel) if root['source'] == 'hpc' else perform(request)
        except FileProtocolError as error: fail(str(error), error.code, 409)
        except (OSError, ValueError) as error: fail(f'This source could not be accessed: {error}. Refresh or reconnect it.', 'FILE_SOURCE_FAILED', 409)

    def connect(self, project, payload):
        self.scope(project)
        source = payload.get('source', 'local')
        if source not in {'local', 'hpc'}: fail('Choose This computer/WSL or an explicitly configured HPC profile.')
        name = payload.get('name'); path = payload.get('path')
        if not isinstance(name, str) or not name.strip() or len(name) > 200 or not isinstance(path, str): fail('Name the folder and choose its explicit absolute root.')
        root = {'source': source, 'path': path, 'name': name.strip(), 'active': True, 'write': False, 'capabilityRevision': 1, 'createdAt': utc_now()}
        if source == 'hpc':
            from .hpc_profiles import HpcProfileStore
            profile = HpcProfileStore(self.s).get(str(payload.get('clusterId', '')))
            if not profile: fail('Configure and verify an HPC profile before connecting a folder.')
            root.update({'clusterId': profile['id'], 'profileSha256': profile['profileSha256']})
        probe = self.source(root, 'probe')
        root.update({'path': probe['root'], 'rootIdentity': probe['rootIdentity'], 'helperVersion': probe['version'], 'replaceQualified': False})
        request = valid_id(payload.get('requestId'))
        key = 'froot_' + hashlib.sha256((project + request).encode()).hexdigest()[:32]
        with self.lock, self.s.table.atomic():
            previous = self.s.get_item(self.s.owner, 'CONNECTED_ROOT', key)
            if previous:
                if any(previous.get(k) != root.get(k) for k in ('path', 'source', 'clusterId', 'profileSha256', 'name')): fail('This connection identity was already used.', 'FILE_IDEMPOTENCY', 409)
                return public_item(previous)
            return public_item(self.put(project, 'CONNECTED_ROOT', key, root))

    def capability(self, project, key, payload, revoke=False):
        with self.lock, self.s.table.atomic():
            root = self.row(project, 'CONNECTED_ROOT', key)
            if payload.get('capabilityRevision') != root['capabilityRevision']: fail('Folder permissions changed. Refresh before continuing.', 'FILE_CAPABILITY_CHANGED', 409)
            if not revoke and type(payload.get('write')) is not bool: fail('Explicitly choose read-only or write access.')
            updated = self.s.update_item(self.s.owner, 'CONNECTED_ROOT', key, {'active': False if revoke else root['active'], 'write': False if revoke else payload['write'], 'capabilityRevision': root['capabilityRevision'] + 1})
            for row in self.s.list_owner_items(self.s.owner, 'FILE_TRANSFER'):
                if row.get('rootId') == key and row.get('status') in {'queued', 'running'}:
                    self.cancellations.setdefault(row['id'], threading.Event()).set()
                    self.s.update_item(self.s.owner, 'FILE_TRANSFER', row['id'], {'status': 'cancelled', 'error': 'Folder access was changed or revoked.'})
            return public_item(updated)

    def validate_capability(self, project, root, write=False):
        latest = self.root(project, root['id'])
        if latest['capabilityRevision'] != root['capabilityRevision'] or write and not latest.get('write'): fail('Folder permission changed. Refresh and review this operation again.', 'FILE_CAPABILITY_CHANGED', 409)
        return latest

    def snapshot(self, project, root, payload):
        result = self.source(root, 'edit', {'path': payload.get('path'), 'identity': payload.get('identity')})
        data = result['text'].encode()
        if len(data) > 32 * 1024: fail('Choose a file of at most 32 KiB for AI context.', 'FILE_CONTEXT_LIMIT', 413)
        key = 'fsnap_' + secrets.token_hex(16); sha = hashlib.sha256(data).hexdigest()
        object_key = f'users/{storage_owner(self.s.owner)}/projects/{project}/file-context/{sha}'
        self.s.s3.put_object(Bucket=self.s.bucket, Key=object_key, Body=data)
        with self.lock, self.s.table.atomic():
            self.validate_capability(project, root)
            self.put(project, 'FILE_CONTEXT', key, {'rootId': root['id'], 'capabilityRevision': root['capabilityRevision'], 'path': payload['path'], 'sourceRevision': result['identity'], 'sha256': sha, 'sizeBytes': len(data), 'objectKey': object_key, 'capturedAt': utc_now()})
        return {'context': {'ref': {'kind': 'resource', 'resourceKind': 'file_snapshot', 'id': key}, 'label': root['name'] + ' / ' + payload['path']}, 'sha256': sha}

    def read_snapshot(self, project, key):
        row = self.row(project, 'FILE_CONTEXT', key); root = self.root(project, row['rootId'])
        if root['capabilityRevision'] != row['capabilityRevision']: fail('The folder capability changed. Capture this source again.', 'FILE_ROOT_REVOKED', 409)
        with self.s.s3.get_object(Bucket=self.s.bucket, Key=row['objectKey'])['Body'] as body: data = body.read(32 * 1024 + 1)
        if len(data) != row['sizeBytes'] or hashlib.sha256(data).hexdigest() != row['sha256']: fail('The selected file snapshot checksum failed.', 'FILE_CHECKSUM', 409)
        return {'item': {**public_item(row), 'text': data.decode('utf-8'), 'untrusted': True}}

    def prepare_edit(self, project, root, payload):
        if not root.get('write'): fail('Grant this folder write access before saving edited copies.', 'FILE_READ_ONLY', 403)
        before = self.source(root, 'edit', {'path': payload.get('path'), 'identity': payload.get('identity')})
        if payload.get('sha256') != before['sha256']: fail('The source changed. Refresh its checksum.', 'FILE_CHANGED', 409)
        text = payload.get('text')
        if not isinstance(text, str) or len(text.encode()) > MAX_EDIT: fail('The text editor accepts at most 2 MiB of UTF-8.', status=413)
        data = preserve_format(before['text'].encode(), text)
        if len(data) > MAX_EDIT: fail('The saved UTF-8 file would exceed 2 MiB.', status=413)
        mode = payload.get('mode', 'copy')
        if mode != 'copy': fail('Replace original is unavailable until this source filesystem is qualified.', 'FILE_REPLACE_UNQUALIFIED', 409)
        request = valid_id(payload.get('requestId')); key = 'fedit_' + hashlib.sha256((project + request).encode()).hexdigest()[:32]
        token = hashlib.sha256(key.encode()).hexdigest()[:12]
        source_path = Path(payload['path']); target = source_path.stem + '.edited-' + token + source_path.suffix
        sha = hashlib.sha256(data).hexdigest(); object_key = f'users/{storage_owner(self.s.owner)}/projects/{project}/file-edits/{sha}'
        self.s.s3.put_object(Bucket=self.s.bucket, Key=object_key, Body=data)
        diff = ''.join(difflib.unified_diff(before['text'].splitlines(True), data.decode('utf-8').splitlines(True), fromfile=payload['path'], tofile=target))
        with self.lock, self.s.table.atomic():
            self.validate_capability(project, root, True)
            prior = self.s.get_item(self.s.owner, 'FILE_EDIT', key)
            if prior:
                if prior['sha256'] != sha or prior['path'] != payload['path'] or prior['rootId'] != root['id'] or prior['sourceIdentity'] != before['identity']: fail('This edited-copy identity was already used.', 'FILE_IDEMPOTENCY', 409)
                return public_item(prior)
            return public_item(self.put(project, 'FILE_EDIT', key, {'rootId': root['id'], 'capabilityRevision': root['capabilityRevision'], 'path': payload['path'], 'target': target, 'mode': mode, 'sourceIdentity': before['identity'], 'sourceSha256': before['sha256'], 'sha256': sha, 'objectKey': object_key, 'sizeBytes': len(data), 'diff': diff[:32000], 'diffTruncated': len(diff) > 32000, 'status': 'prepared', 'createdAt': utc_now()}))

    def commit_edit(self, project, key):
        # One core writer serializes project mutations and revalidates capabilities.
        with self.lock:
            edit = self.row(project, 'FILE_EDIT', key); root = self.root(project, edit['rootId'])
            if edit['status'] == 'succeeded': return public_item(edit)
            if edit['status'] != 'prepared': fail('This copy may have been written. Refresh its destination and inspect the checksum before creating another copy.', 'FILE_COMMIT_UNCERTAIN', 409)
            if root['capabilityRevision'] != edit['capabilityRevision']: fail('Folder permissions changed. Review this copy again.', 'FILE_CAPABILITY_CHANGED', 409)
            self.validate_capability(project, root, True)
            with self.s.s3.get_object(Bucket=self.s.bucket, Key=edit['objectKey'])['Body'] as body: data = body.read(MAX_EDIT + 1)
            if hashlib.sha256(data).hexdigest() != edit['sha256']: fail('Prepared copy checksum verification failed.', 'FILE_CHECKSUM', 409)
            self.s.update_item(self.s.owner, 'FILE_EDIT', key, {'status': 'committing'})
            try:
                result = self.source(root, 'write', {'path': edit['path'], 'identity': edit['sourceIdentity'], 'sha256': edit['sourceSha256'], 'bytes': base64.b64encode(data).decode(), 'target': edit['target'], 'mode': 'copy', 'operationId': secrets.token_hex(16)})
                return public_item(self.s.update_item(self.s.owner, 'FILE_EDIT', key, {'status': 'succeeded', 'result': result, 'completedAt': utc_now()}))
            except Exception:
                self.s.update_item(self.s.owner, 'FILE_EDIT', key, {'status': 'commit-uncertain', 'error': 'Inspect the destination and checksum. Do not repeat this write automatically.'}); raise

    def transfer(self, project, root, payload):
        files = payload.get('files')
        if not isinstance(files, list) or not 1 <= len(files) <= 20: fail('Select 1–20 regular files per import.')
        checked = []
        for value in files:
            if not isinstance(value, dict): fail('Choose exact file identities.')
            result = self.source(root, 'hash', {'path': value.get('path'), 'identity': value.get('identity')})
            checked.append({**result, 'path': value['path']})
        size = sum(f['sizeBytes'] for f in checked)
        if size > 1024 ** 3: fail('A selected import is limited to 1 GiB.', status=413)
        free = shutil.disk_usage(self.s.data_dir).free
        if size * 2 + 16 * CHUNK > free: fail('Not enough local disk. This import needs space for retained staging and verified project artifacts.', 'FILE_DISK_SPACE', 409)
        key = 'ftransfer_' + hashlib.sha256((project + valid_id(payload.get('requestId'))).encode()).hexdigest()[:32]
        with self.lock, self.s.table.atomic():
            self.validate_capability(project, root)
            prior = self.s.get_item(self.s.owner, 'FILE_TRANSFER', key)
            if prior:
                if prior['files'] != checked or prior['rootId'] != root['id']: fail('This import identity was already used.', 'FILE_IDEMPOTENCY', 409)
                return public_item(prior)
            if sum(r.get('status') in {'queued', 'running'} for r in self.s.list_owner_items(self.s.owner, 'FILE_TRANSFER')) >= 32: fail('The file import queue is full. Finish or cancel a batch first.', 'FILE_QUEUE_FULL', 409)
            return public_item(self.put(project, 'FILE_TRANSFER', key, {'rootId': root['id'], 'sourceKey': root.get('clusterId', 'local'), 'capabilityRevision': root['capabilityRevision'], 'files': checked, 'sizeBytes': size, 'requiredDiskBytes': size * 2, 'order': time.time_ns(), 'progressBytes': 0, 'status': 'queued', 'imports': [], 'createdAt': utc_now()}))

    def schedule(self):
        while not self.closed.wait(.2):
            with self.lock:
                queue = sorted((r for r in self.s.list_owner_items(self.s.owner, 'FILE_TRANSFER') if r.get('status') == 'queued'), key=lambda r: r.get('order', 0))
                for row in queue:
                    if len(self.running) >= 2: break
                    if row['sourceKey'] in self.active_sources: continue
                    self.running.add(row['id']); self.active_sources.add(row['sourceKey']); self.cancellations.setdefault(row['id'], threading.Event())
                    self.s.update_item(self.s.owner, 'FILE_TRANSFER', row['id'], {'status': 'running'})
                    thread = threading.Thread(target=self.run_transfer, args=(row,), daemon=True); self.threads.add(thread); thread.start()

    def run_transfer(self, transfer):
        key = transfer['id']; project = transfer['projectId']; cancel = self.cancellations[key]; progress = 0; imported = []
        try:
            root = self.root(project, transfer['rootId'])
            for index, file in enumerate(transfer['files']):
                staging = self.temp / (key + '-' + str(index) + '.part'); digest = hashlib.sha256(); offset = 0
                with staging.open('xb') as output:
                    while offset < file['sizeBytes']:
                        if cancel.is_set() or self.closed.is_set(): fail('Import cancelled. Retained verified files are still available.', 'FILE_CANCELLED', 409)
                        with self.lock: self.validate_capability(project, root)
                        result = self.source(root, 'chunk', {'path': file['path'], 'identity': file['identity'], 'offset': offset}, cancel)
                        data = base64.b64decode(result['bytes'], validate=True)
                        if not data or len(data) > min(CHUNK, file['sizeBytes'] - offset) or hashlib.sha256(data).hexdigest() != result['chunkSha256']: fail('A transfer chunk failed checksum verification.', 'FILE_CHECKSUM', 409)
                        output.write(data); digest.update(data); offset += len(data); progress += len(data)
                        self.s.update_item(self.s.owner, 'FILE_TRANSFER', key, {'progressBytes': progress})
                    output.flush(); os.fsync(output.fileno())
                if digest.hexdigest() != file['sha256']: fail('The transferred file failed checksum verification. The partial file was retained.', 'FILE_CHECKSUM', 409)
                object_key = f'users/{storage_owner(self.s.owner)}/projects/{project}/connected-files/{file["sha256"]}'
                with staging.open('rb') as source: self.s.s3.put_object(Bucket=self.s.bucket, Key=object_key, Body=source, ContentLength=file['sizeBytes'], Metadata={'sha256': file['sha256']})
                with self.lock, self.s.table.atomic():
                    self.validate_capability(project, root)
                    if cancel.is_set(): fail('Import cancelled before publishing this file.', 'FILE_CANCELLED', 409)
                    import_id = key + '_' + str(index)
                    self.put(project, 'PROJECT_FILE', import_id, {**file, 'name': Path(file['path']).name, 'rootId': root['id'], 'sourceRevision': file['identity'], 'objectKey': object_key, 'transferId': key, 'createdAt': utc_now()})
                    imported.append(import_id); self.s.update_item(self.s.owner, 'FILE_TRANSFER', key, {'imports': imported})
                # Only this task-owned verified staging copy is reclaimed.
                staging.unlink()
            with self.lock:
                self.validate_capability(project, root)
                self.s.update_item(self.s.owner, 'FILE_TRANSFER', key, {'status': 'succeeded', 'imports': imported, 'completedAt': utc_now()})
        except Exception as error:
            self.s.update_item(self.s.owner, 'FILE_TRANSFER', key, {'status': 'cancelled' if cancel.is_set() else 'interrupted' if self.closed.is_set() else 'failed', 'error': str(error)[:2000], 'imports': imported})
        finally:
            with self.lock: self.running.discard(key); self.active_sources.discard(transfer['sourceKey']); self.threads.discard(threading.current_thread())

    def handle(self, project, method, parts, payload):
        self.scope(project)
        if not parts:
            if method == 'GET':
                return {'roots': [public_item(r) for r in self.s.list_owner_items(self.s.owner, 'CONNECTED_ROOT') if r.get('projectId') == project], 'transfers': [public_item(r) for r in self.s.list_owner_items(self.s.owner, 'FILE_TRANSFER') if r.get('projectId') == project], 'files': [public_item(r) for r in self.s.list_owner_items(self.s.owner, 'PROJECT_FILE') if r.get('projectId') == project]}
            if method == 'POST': return {'root': self.connect(project, payload)}
        if len(parts) == 2 and parts[0] == 'edits' and method == 'POST': return {'edit': self.commit_edit(project, parts[1])}
        if len(parts) == 2 and parts[0] == 'transfers' and method == 'DELETE':
            with self.lock:
                row = self.row(project, 'FILE_TRANSFER', parts[1]); self.cancellations.setdefault(row['id'], threading.Event()).set()
                if row['status'] in {'queued', 'running'}: row = self.s.update_item(self.s.owner, 'FILE_TRANSFER', row['id'], {'status': 'cancelled'})
                return {'transfer': public_item(row)}
        if len(parts) == 2 and parts[0] == 'downloads' and method == 'GET':
            row = self.row(project, 'PROJECT_FILE', parts[1]); url = self.s.s3.generate_presigned_url('get_object', Params={'Bucket': self.s.bucket, 'Key': row['objectKey']}, ExpiresIn=300)
            return {'ticket': parse_qs(urlsplit(url).query)['ticket'][0], 'name': row['name']}
        if parts[0] == 'roots' and len(parts) in {2, 3}:
            if len(parts) == 2 and method in {'PUT', 'DELETE'}: return {'root': self.capability(project, parts[1], payload, method == 'DELETE')}
            root = self.root(project, parts[1]); operation = parts[2] if len(parts) == 3 else ''
            if method == 'POST' and operation in {'list', 'read', 'edit'}:
                result = self.source(root, operation, payload)
                with self.lock: self.validate_capability(project, root)
                return result
            if method == 'POST' and operation == 'snapshot': return self.snapshot(project, root, payload)
            if method == 'POST' and operation == 'prepare': return {'edit': self.prepare_edit(project, root, payload)}
            if method == 'POST' and operation == 'import': return {'transfer': self.transfer(project, root, payload)}
        fail('This connected-file operation is not supported.', 'NOT_FOUND', 404)
