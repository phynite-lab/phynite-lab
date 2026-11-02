"""Explicitly import completed, verified native output after a desktop interruption."""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import socket
from typing import Any

import psutil

from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError, owner_partition, utc_now
from backend.local_worker import recovery
from .services import INTERRUPTED_REASON


def reject(message: str) -> None:
    raise ApiError(409, message, 'RESULT_RECOVERY_INVALID')


def recovery_item(services, job_id: str) -> dict:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,96}', job_id):
        reject('The local job identity is invalid.')
    candidates = [services.get_item(services.owner, kind, job_id)
                  for kind in ('CALCULATION', 'MD_SIMULATION', 'MD_ANALYSIS')]
    candidates = [item for item in candidates if item]
    if len(candidates) != 1:
        raise ApiError(404, 'The owned local job was not found.', 'NOT_FOUND')
    item = candidates[0]
    if (item.get('ownerId') != services.owner or item.get('computeBackend') != 'LOCAL_MAC'
            or item.get('computeTarget') != 'personal' or item.get('status') != 'FAILED'
            or item.get('interrupted') is not True or item.get('failureReason') != INTERRUPTED_REASON
            or item.get('statusMessage') != INTERRUPTED_REASON or not item.get('localWorkerId')):
        reject('Only an interrupted local execution with retained completed output can be recovered.')
    return item


def recovery_status(services, job_id: str) -> dict:
    """Report a candidate without repeatedly hashing scientific output during UI polling."""
    try:
        recovery_item(services, job_id)
        directory = workspace(services.data_dir, job_id)
        contained_file(directory, recovery.JOURNAL)
        if (directory / 'results').is_symlink():
            reject('The retained result directory cannot be a symbolic link.')
        manifest = contained_file(directory / 'results', 'result.json')
        if manifest.stat().st_size > 16 * 1024**2:
            reject('The retained result manifest exceeds its verification limit.')
        saved = json.loads(manifest.read_bytes())
        if not isinstance(saved, dict) or saved.get('calculationId') != job_id or saved.get('status') != 'completed':
            reject('No completed output is available. Submit a new run explicitly.')
        return {'available': True}
    except ApiError as error:
        return {'available': False, 'reason': str(error)}
    except (OSError, ValueError, TypeError):
        return {'available': False, 'reason': 'The saved output must be inspected before recovery.'}


def contained_file(directory: Path, value: Any) -> Path:
    if (not isinstance(value, str) or not value or '\\' in value or '\x00' in value
            or value != PurePosixPath(value).as_posix() or value.startswith('/')
            or any(part in {'', '.', '..'} for part in value.split('/'))):
        reject('The retained result contains an unsafe file path.')
    candidate = directory
    for part in value.split('/'):
        candidate /= part
        if candidate.is_symlink():
            reject('The retained result contains a symbolic link.')
    if not candidate.resolve().is_relative_to(directory.resolve()) or not candidate.is_file():
        reject('A required retained result file is missing or outside its workspace.')
    return candidate


def workspace(data_dir: Path, job_id: str) -> Path:
    root = data_dir / 'work'
    if root.is_symlink() or not root.is_dir():
        reject('No retained worker workspace is available for this job.')
    matches = []
    for slot in root.iterdir():
        if not re.fullmatch(r'worker-[0-9]+', slot.name):
            continue
        candidate = slot / job_id
        if not candidate.exists() and not candidate.is_symlink():
            continue
        if slot.is_symlink() or candidate.is_symlink() or not candidate.is_dir():
            reject('Recovery requires a regular private worker directory.')
        matches.append(candidate)
    if len(matches) != 1:
        reject('Recovery needs exactly one retained workspace for this job. Inspect the saved worker directories.')
    return matches[0]


def require_stopped(directory: Path, journal: dict) -> None:
    runtime = journal.get('runtimeIdentity')
    if (not isinstance(runtime, dict) or runtime.get('mode') != 'native'
            or runtime.get('host') != socket.gethostname() or runtime.get('scheduler')
            or runtime.get('schedulerAllocation')):
        reject('This result requires inspection on the original native computer before recovery.')
    recorded = journal.get('nativeProcess')
    if recorded is not None:
        if (not isinstance(recorded, dict) or type(recorded.get('pid')) is not int
                or recorded['pid'] <= 1 or recorded.get('host') != socket.gethostname()
                or not isinstance(recorded.get('createTimeEpoch'), (int, float))):
            reject('The previous native process identity is invalid.')
        try:
            process = psutil.Process(recorded['pid'])
            if process.create_time() == recorded['createTimeEpoch'] and process.status() != psutil.STATUS_ZOMBIE:
                reject('The previous scientific process is still active. Stop it before recovering its output.')
        except psutil.NoSuchProcess:
            pass
        except psutil.AccessDenied:
            reject('The previous scientific process could not be inspected. Confirm it stopped before recovery.')
    # MPI children can survive the original leader, including the interval before
    # PID journaling. A recovery request never kills or launches any process.
    for process in psutil.process_iter():
        try:
            if (process.pid != os.getpid() and process.status() != psutil.STATUS_ZOMBIE
                    and Path(process.cwd()).resolve().is_relative_to(directory.resolve())):
                reject('A scientific process still uses the saved workspace. Stop it before recovery.')
        except (psutil.NoSuchProcess, psutil.AccessDenied, FileNotFoundError):
            continue


def reconcile_workflows(services, job: dict) -> None:
    """Refresh only this imported result; never submit descendants or reopen a run."""
    from backend.local_api.domain.project_workflow import ProjectWorkflowApi, SUCCESS
    workflow = ProjectWorkflowApi(PhyniteApi(services))
    runs = set()
    with services.table.atomic():
        for attempt in services.list_owner_items(services.owner, 'WORKFLOW_ATTEMPT'):
            if (attempt.get('projectId') != job.get('projectId') or attempt.get('jobId') != job['id']
                    or attempt.get('jobKind') != job['entityType'] or attempt.get('status') != 'failed'
                    or attempt.get('error') != INTERRUPTED_REASON):
                continue
            run = services.get_item(services.owner, 'PROJECT_RUN', attempt.get('runId', ''))
            if (not run or run.get('projectId') != job.get('projectId') or run.get('status') != 'failed'
                    or run.get('cancelRequests') or float(run.get('leaseUntil') or 0) > 0):
                continue
            updated = {**attempt, 'status': 'completed', 'result': {'jobId': job['id'], 'jobKind': job['entityType']},
                       'updatedAt': utc_now(), 'resultRecovery': job['resultRecovery']}
            updated.pop('error', None)
            updated.pop('errorCode', None)
            services.table.put_item(Item=updated)
            runs.add(run['id'])
        for run_id in runs:
            run = services.get_item(services.owner, 'PROJECT_RUN', run_id)
            snapshot = workflow.read_json(run['objectKey'], run['sha256'])
            nodes = snapshot['plan']['nodes']
            attempts = [workflow.attempt(services.owner, run_id, planned['nodeId']) for planned in nodes]
            # A failed branch may have blocked descendants. Keep them and the run
            # failed, requiring the normal explicit Run action to do more work.
            if attempts and all(attempt and attempt.get('status') in SUCCESS for attempt in attempts):
                services.update_item(services.owner, 'PROJECT_RUN', run_id,
                    {'status': 'completed', 'revision': int(run['revision']) + 1, 'updatedAt': utc_now(),
                     'resultRecovery': job['resultRecovery']})


def recover_result(services, job_id: str) -> dict:
    item = recovery_item(services, job_id)
    api = PhyniteApi(services)
    api.worker_owner = services.owner
    directory = workspace(services.data_dir, job_id)
    try:
        journal_file = contained_file(directory, recovery.JOURNAL)
        if journal_file.stat().st_size > 4_500_000:
            reject('The execution journal exceeds its verification limit.')
        journal_bytes = journal_file.read_bytes()
        journal = json.loads(journal_bytes)
        if (not isinstance(journal, dict) or journal.get('version') != 1
                or not re.fullmatch(r'[a-f0-9]{32}', str(journal.get('attemptId') or ''))
                or not re.fullmatch(r'[a-f0-9]{64}', str(journal.get('preparedInputSha256') or ''))):
            reject('The saved execution has no verifiable journal identity.')
        contained_file(directory, 'input.json')
        if not isinstance(journal.get('modelFiles'), list):
            reject('The saved model inventory is invalid.')
        for entry in journal['modelFiles']:
            contained_file(directory, entry['path'])
        require_stopped(directory, journal)
        job = {'calculationId': item['id'], 'ownerId': item['ownerId'], 'kind': item.get('jobKind') or 'qe',
               'vcpus': int(item.get('vcpus') or 1), 'memoryMiB': int(item.get('memoryMiB') or 2048),
               **api.local_job_input(item)}
        issues = recovery.verify_claim(directory, recovery.claim_identity(job), journal['runtimeIdentity'])
        if issues:
            reject(' '.join(issues))
        results = directory / 'results'
        if results.is_symlink():
            reject('The retained result directory cannot be a symbolic link.')
        manifest_file = contained_file(results, 'result.json')
        if manifest_file.stat().st_size > 16 * 1024**2:
            reject('The retained result manifest exceeds its verification limit.')
        manifest_bytes = manifest_file.read_bytes()
        manifest = json.loads(manifest_bytes)
        if (not isinstance(manifest, dict) or manifest.get('calculationId') != job_id
                or manifest.get('status') != 'completed'):
            reject('The saved scientific result is not completed for this job.')
        artifacts = manifest.get('artifacts')
        if not isinstance(artifacts, list) or not 1 <= len(artifacts) <= 10_000:
            reject('The completed result has no valid artifact inventory.')
        verified = {}
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                reject('The retained artifact inventory is invalid.')
            relative = artifact.get('path')
            path = contained_file(results, relative)
            digest, size = artifact.get('sha256'), artifact.get('sizeBytes')
            if (relative == 'result.json' or relative in verified or type(size) is not int or size < 0
                    or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest)
                    or path.stat().st_size != size or recovery.digest(path) != digest):
                reject('A retained artifact failed size or checksum verification.')
            verified[relative] = {'path': relative, 'sizeBytes': size, 'sha256': digest}
        # Include the exact original manifest after validating its entire artifact
        # inventory. Never rewrite scientific output to make it pass validation.
        verified['result.json'] = {'path': 'result.json', 'sizeBytes': len(manifest_bytes),
                                   'sha256': recovery.digest(manifest_file)}
        for relative, entry in verified.items():
            path = contained_file(results, relative)
            with path.open('rb') as source:
                services.s3.put_object(Bucket=services.bucket, Key=item['outputPrefix'] + '/' + relative,
                    Body=source, ContentLength=entry['sizeBytes'], Metadata={'sha256': entry['sha256']},
                    ContentType=mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        if manifest_file.read_bytes() != manifest_bytes or journal_file.read_bytes() != journal_bytes:
            reject('The retained execution changed during verification.')
        require_stopped(directory, journal)
        resources = journal.get('effectiveResources') or {}
        if (not isinstance(resources, dict) or set(resources) - {'effectiveVcpus', 'effectiveMemoryMiB'}
                or any(type(value) is not int or value < 1 for value in resources.values())):
            reject('The saved execution resource allocation is invalid.')
        provenance = {'method': 'verified-local-output-import', 'attemptId': journal['attemptId'],
                      'manifestSha256': verified['result.json']['sha256'],
                      'inventorySha256': recovery.canonical_digest(list(verified.values())),
                      'artifactCount': len(verified) - 1}
        with services.table.atomic():
            trajectory = manifest.get('trajectoryArtifact')
            if item['entityType'] == 'MD_SIMULATION' and isinstance(trajectory, dict):
                entry = verified.get(trajectory.get('path'))
                if not entry or entry['sizeBytes'] != trajectory.get('sizeBytes') or entry['sha256'] != trajectory.get('sha256'):
                    reject('The trajectory is absent from the verified artifact inventory.')
                identifier = job_id + '_' + hashlib.sha256(entry['path'].encode()).hexdigest()
                services.put_item({'PK': owner_partition(services.owner), 'SK': 'WORKER_ARTIFACT#' + identifier,
                    'entityType': 'WORKER_ARTIFACT', 'id': identifier, 'ownerId': services.owner, 'jobId': job_id,
                    'status': 'READY', 'objectKey': item['outputPrefix'] + '/' + entry['path'],
                    'sizeBytes': entry['sizeBytes'], 'sha256': entry['sha256'], 'importedLocally': True})
                services.put_item({'PK': owner_partition(services.owner), 'SK': 'WORKER_UPLOAD#' + identifier,
                    'entityType': 'WORKER_UPLOAD', 'id': identifier, 'ownerId': services.owner,
                    'completedChecksum': base64.b64encode(bytes.fromhex(entry['sha256'])).decode(), 'importedLocally': True})
            result = api.complete_local_job(job_id, {'ownerId': services.owner, 'workerId': item['localWorkerId'],
                'kind': job['kind'], 'status': 'completed', **resources},
                interrupted_recovery={'expectedItem': item, 'provenance': provenance})
            updated = services.get_item(services.owner, item['entityType'], job_id)
            reconcile_workflows(services, updated)
        return result
    except ApiError:
        raise
    except (OSError, ValueError, KeyError, TypeError, recovery.RecoveryError) as error:
        raise ApiError(409, 'The retained scientific output could not be verified. Saved files were preserved.', 'RESULT_RECOVERY_INVALID') from error
