"""Durable local campaigns, independent of conversation leases and browser lifetime."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import threading
import time
from typing import Any

from backend.local_api.domain.ai_workspace import AiWorkspace, body, digest, fail, clean
from backend.local_api.domain.project_workflow import ProjectWorkflowApi, digest as workflow_digest
from backend.local_api.domain.dft_validation import dft_result_error
from backend.local_api.domain.phynite_core import json_safe

TERMINAL = {'completed', 'cancelled', 'manual resume required'}
REPAIR_FIELDS = {'mixingBeta': 'mixing_beta', 'mixingMode': 'mixing_mode', 'diagonalization': 'diagonalization', 'electronMaxSteps': 'electron_maxstep'}


def healing_policy(value: Any) -> list[dict]:
    if not isinstance(value, list) or len(value) > 2:
        fail(422, 'Approve at most two numerical repair steps per candidate.', 'CAMPAIGN_POLICY_INVALID')
    for step in value:
        if not isinstance(step, dict) or not step or set(step) - set(REPAIR_FIELDS):
            fail(422, 'Only mixing beta/mode, diagonalization and electron iteration limits can be healed. Physical settings need a new approval.', 'CAMPAIGN_POLICY_INVALID')
        for key, number in step.items():
            valid = (key == 'mixingBeta' and type(number) in {int, float} and math.isfinite(number) and .05 <= number <= .7
                     or key == 'mixingMode' and isinstance(number, str) and number in {'plain', 'TF', 'local-TF'}
                     or key == 'diagonalization' and isinstance(number, str) and number in {'david', 'cg'}
                     or key == 'electronMaxSteps' and type(number) is int and 1 <= number <= 500)
            if not valid:
                fail(422, 'A numerical repair value is outside the supported bounds.', 'CAMPAIGN_POLICY_INVALID')
    return copy.deepcopy(value)


def repaired_qe_input(source: str, step: dict) -> str:
    """Change only exact, unambiguous ELECTRONS assignments; preserve all other bytes."""
    healing_policy([step])
    masked = re.sub(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|![^\n]*", lambda m: ' ' * len(m[0]), source)
    lists = list(re.finditer(r'&ELECTRONS\b([^/]*)/', masked, re.I))
    if len(lists) != 1:
        fail(422, 'Repair needs exactly one unambiguous ELECTRONS namelist.', 'CAMPAIGN_INPUT_UNSUPPORTED')
    match = lists[0]
    edits = []
    for key, value in step.items():
        field = REPAIR_FIELDS[key]
        assignments = list(re.finditer(r'\b' + field + r'\s*=\s*', masked[match.start(1):match.end(1)], re.I))
        if len(assignments) != 1:
            fail(422, f'Repair requires one explicit {field} assignment. Review a fresh input.', 'CAMPAIGN_INPUT_UNSUPPORTED')
        assignment = assignments[0]
        # Strings were masked, so stop at the '=' then consume actual whitespace/value.
        start = match.start(1) + assignment.start() + source[match.start(1) + assignment.start():].index('=') + 1
        token = re.match(r"\s*('(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][-+]?\d+)?)", source[start:])
        if not token:
            fail(422, 'The numerical input cannot be patched unambiguously.', 'CAMPAIGN_INPUT_UNSUPPORTED')
        old = token[1]
        if key in {'mixingBeta', 'electronMaxSteps'}:
            before = float(old.replace('d', 'e').replace('D', 'e'))
            if key == 'mixingBeta' and value >= before or key == 'electronMaxSteps' and value <= before:
                fail(422, 'Repair must lower mixing beta or increase the electron iteration limit.', 'CAMPAIGN_POLICY_INVALID')
        replacement = repr(value) if isinstance(value, str) else str(value)
        edits.append((start + token.start(1), start + token.end(1), replacement))
    result = source
    for start, end, replacement in sorted(edits, reverse=True):
        result = result[:start] + replacement + result[end:]
    if source == result:
        fail(422, 'The repair would not change the input.', 'CAMPAIGN_POLICY_INVALID')
    return result


class CampaignSupervisor:
    def __init__(self, api):
        self.api, self.services = api, api.services
        self.ai = AiWorkspace(api)
        self.workflow = ProjectWorkflowApi(api)
        self.lock = threading.Lock()

    def prepare(self, owner: str, conversation: dict, data: dict) -> dict:
        if conversation.get('mode') != 'approval':
            fail(403, 'Switch to Ask for approval to review campaign budgets and numerical repair policy.', 'CAMPAIGN_APPROVAL_REQUIRED')
        project = self.ai.scope(owner, conversation['projectKey'])
        if not project or project['kind'] != 'canvas' or not getattr(self.services, 'local_workspace', False):
            fail(422, 'Persistent campaigns require a saved Canvas project in the local application.', 'CAMPAIGN_LOCAL_REQUIRED')
        targets = data.get('targets')
        if not isinstance(targets, list) or not 1 <= len(targets) <= 5 or any(not isinstance(target, str) for target in targets) or len(set(targets)) != len(targets):
            fail(422, 'Select one to five distinct saved QE targets.', 'CAMPAIGN_TARGET_INVALID')
        policy = healing_policy(data.get('repairs', []))
        budget = data.get('budget')
        keys = {'wallSecondsPerAttempt', 'queueSecondsPerAttempt', 'totalNodeHours', 'expiresAtEpoch'}
        now = int(time.time())
        if not isinstance(budget, dict) or set(budget) != keys or any(type(budget[key]) is not int or not 1 <= budget[key] <= 604800 for key in ('wallSecondsPerAttempt', 'queueSecondsPerAttempt')) or type(budget['expiresAtEpoch']) is not int or not now < budget['expiresAtEpoch'] <= now + 604800 or type(budget['totalNodeHours']) not in {int, float} or not math.isfinite(budget['totalNodeHours']) or not 0 < budget['totalNodeHours'] <= 10000:
            fail(422, 'Review finite queue/runtime/node-hour budgets and expiry within seven days.', 'CAMPAIGN_BUDGET_INVALID')
        candidates = []
        reserved = 0.0
        for target in targets:
            plan, graph = self.workflow.plan(owner, project['id'], {'revision': data.get('revision'), 'targets': [target], 'rerun': [target]})
            executable = [row for row in plan['nodes'] if row['action'] == 'run']
            node = next((node for node in graph['nodes'] if node['id'] == target), None)
            if plan['errors'] or not node or node['kind'] not in {'scf', 'relax'} or len(executable) != 1 or executable[0]['nodeId'] != target:
                fail(422, 'Campaign v1 needs a validated SCF/relaxation connected directly to a saved structure; review prerequisite calculations separately.', 'CAMPAIGN_TARGET_INVALID')
            execution = node['configuration'].get('execution', {})
            compute = node['configuration'].get('resolvedHpcCompute') or execution
            vcpus = compute.get('vcpus', 1)
            if type(vcpus) is not int or vcpus < 1:
                fail(422, 'Candidate allocation is unavailable.', 'CAMPAIGN_BUDGET_INVALID')
            if node['configuration'].get('computeTarget', 'personal') != 'personal' or execution.get('executionAffinity'):
                fail(422, 'This supervisor requires your computer. Review HPC jobs separately; numerical repair must never change compute allocation.', 'CAMPAIGN_LOCAL_REQUIRED')
            cost = budget['wallSecondsPerAttempt'] * vcpus / 3600
            reserved += cost * (1 + len(policy))
            candidates.append({'target': target, 'plan': plan, 'workflow': graph, 'nodeHoursPerAttempt': cost})
        if reserved > budget['totalNodeHours'] + 1e-12:
            fail(422, 'The budget must cover the worst-case allocation including each approved repair.', 'CAMPAIGN_BUDGET_INVALID')
        return {'schemaVersion': 1, 'projectId': project['id'], 'revision': data['revision'], 'targets': targets, 'repairs': policy, 'budget': copy.deepcopy(budget), 'candidates': candidates, 'reservedNodeHours': reserved}

    def create(self, owner: str, conversation: dict, action: dict, approved: dict) -> dict:
        identifier = 'aicamp_' + digest([owner, approved['projectId'], action['id']])[:32]
        previous = self.services.get_item(owner, 'AI_CAMPAIGN', identifier)
        if previous:
            if previous.get('approvalHash') != workflow_digest(approved):
                fail(409, 'Campaign approval changed.', 'CAMPAIGN_CONFLICT')
            return self.public(previous)
        key, sha = self.workflow.write_json(owner, approved['projectId'], 'campaigns', approved)
        row = self.ai.put(owner, 'AI_CAMPAIGN', identifier, {'projectId': approved['projectId'], 'conversationId': conversation['id'], 'actionId': action['id'], 'schemaVersion': 1,
            'approvalHash': workflow_digest(approved), 'snapshotKey': key, 'snapshotSha256': sha, 'status': 'executing', 'candidateIndex': 0, 'attempts': [], 'usedNodeHours': 0.0, 'leaseUntil': 0, 'cancelRequested': False})
        return self.public(row)

    @staticmethod
    def public(row: dict) -> dict:
        public = {key: row[key] for key in ('id', 'schemaVersion', 'projectId', 'conversationId', 'revision', 'status', 'candidateIndex', 'attempts', 'usedNodeHours', 'cancelRequested', 'reason', 'createdAt', 'updatedAt') if key in row}
        public['attempts'] = [{key: value for key, value in attempt.items() if not key.startswith('_')} for attempt in row['attempts']]
        return clean(public)

    def scoped(self, owner: str, conversation: dict, identifier: str) -> dict:
        row = self.ai.row(owner, 'AI_CAMPAIGN', identifier)
        project = self.ai.scope(owner, conversation['projectKey'])
        if not project or row['projectId'] != project['id'] or row['conversationId'] != conversation['id']:
            fail(404, 'This campaign is not in the selected conversation/project.', 'AI_NOT_FOUND')
        return row

    def read(self, owner: str, conversation: dict, identifier: str) -> dict:
        row = self.scoped(owner, conversation, identifier)
        snapshot = self.workflow.read_json(row['snapshotKey'], row['snapshotSha256'])
        return {'campaign': self.public(row), 'budget': snapshot['budget'], 'repairs': snapshot['repairs']}

    def attempt_input(self, owner: str, conversation: dict, identifier: str, index: int) -> dict:
        row = self.scoped(owner, conversation, identifier)
        if type(index) is not int or not 0 <= index < len(row['attempts']):
            fail(404, 'Campaign attempt was not found.', 'AI_NOT_FOUND')
        attempt = row['attempts'][index]
        result = {'attempt': index, 'requestSha256': attempt['requestSha256']}
        if attempt.get('_evidenceKey'):
            proof = self.workflow.read_json(attempt['_evidenceKey'], attempt['evidenceSha256'])
            result.update(input={key: proof['input'][key] for key in ('qeInput', 'inputFiles', 'structureId', 'calculationType') if key in proof['input']}, evidenceSha256=attempt['evidenceSha256'])
        elif attempt['mode'] == 'calculation':
            request = self.workflow.read_json(attempt['_requestKey'], attempt['_requestSha256'])
            result['input'] = {key: request[key] for key in ('qeInput', 'inputFiles', 'structureId', 'calculationType') if key in request}
        else:
            result['note'] = 'Initial workflow input will be available after its scientific job is verified.'
        return clean(result)

    def cancel(self, owner: str, conversation: dict, identifier: str, revision: int) -> dict:
        row = self.scoped(owner, conversation, identifier)
        if revision != row['revision']:
            fail(409, 'Refresh the campaign before cancelling.', 'CAMPAIGN_CONFLICT')
        if row['status'] not in TERMINAL:
            row = self.ai.update(owner, 'AI_CAMPAIGN', row, {'cancelRequested': True})
        return self.public(row)

    def tick(self):
        if not self.lock.acquire(blocking=False):
            return
        try:
            for row in self.services.list_owner_items(self.services.owner, 'AI_CAMPAIGN'):
                if row.get('schemaVersion') == 1 and row['status'] not in TERMINAL:
                    try:
                        self.advance(row)
                    except Exception:
                        # Do not retry a mutation on an exception; the durable intent is the recovery boundary.
                        current = self.services.get_item(self.services.owner, 'AI_CAMPAIGN', row['id'])
                        if current:
                            self.ai.update(self.services.owner, 'AI_CAMPAIGN', current, {'status': 'manual resume required', 'reason': 'Campaign could not be verified. Inspect retained attempts/receipts before continuing.', 'leaseUntil': 0})
        finally:
            self.lock.release()

    def update(self, row: dict, **values) -> dict:
        return json_safe(self.ai.update(row['ownerId'], 'AI_CAMPAIGN', row, values))

    def intent(self, row: dict, approved: dict, candidate: dict, request: dict, mode: str, now: float, reason: str) -> dict:
        index = row['candidateIndex']
        count = sum(attempt['candidateIndex'] == index for attempt in row['attempts'])
        request = copy.deepcopy(request)
        key = 'campaign_' + digest([row['id'], index, count])[:48]
        request['idempotencyKey'] = key
        expected = ('run_' + hashlib.sha256(f"{row['projectId']}:{key}".encode()).hexdigest()[:40] if mode == 'workflow'
                    else 'calc_' + hashlib.sha256(f"{row['ownerId']}:{key}".encode()).hexdigest()[:32])
        request_key, request_sha = self.workflow.write_json(row['ownerId'], row['projectId'], 'campaigns', request)
        attempt = {'candidateIndex': index, 'attempt': count, 'phase': 'submission-intent', 'mode': mode, 'expectedId': expected,
                   'requestSha256': workflow_digest(request), 'inputSha256': request_sha, 'inputRef': {'kind': 'campaign_attempt', 'id': row['id'], 'attempt': len(row['attempts'])},
                   'reason': reason, 'createdAtEpoch': now, 'nodeHours': candidate['nodeHoursPerAttempt']}
        # Internal object location remains private, even in public campaign evidence.
        attempt_private = {**attempt, '_requestKey': request_key, '_requestSha256': request_sha}
        row = self.update(row, attempts=[*row['attempts'], attempt_private], usedNodeHours=row['usedNodeHours'] + candidate['nodeHoursPerAttempt'], leaseUntil=0)
        return row

    def submit_intent(self, row: dict, request: dict) -> dict:
        """Only called immediately after writing a new intent. Recovery only looks up receipts."""
        current = self.ai.row(row['ownerId'], 'AI_CAMPAIGN', row['id'])
        if current['cancelRequested']:
            return self.update(current, status='cancelled', reason='Cancelled before submission.', leaseUntil=0)
        if current['revision'] != row['revision']:
            fail(409, 'Campaign changed before submission.', 'CAMPAIGN_CONFLICT')
        attempt = row['attempts'][-1]
        if attempt['mode'] == 'workflow':
            self.workflow.start(row['ownerId'], row['projectId'], request)
        else:
            self.api.create_calculation(row['ownerId'], row['projectId'], request)
        attempt['phase'] = 'submitted'
        return self.update(row, attempts=row['attempts'])

    def evidence(self, row: dict, job: dict) -> tuple[dict, str, str, str]:
        from backend.local_api.domain.ai_readers import AiReaders
        from backend.local_api.domain.result_artifacts import read_result_manifest
        manifest, manifest_sha = read_result_manifest(self.services, job)
        # Verify every retained bounded log and the numerical evidence sources, never classify from an AI assessment.
        _, files = AiReaders(self.ai).inventory(row['ownerId'], {'projectKey': 'project:' + row['projectId']}, {'resourceKind': 'calculation', 'resourceId': job['id']})
        logs = []
        for file in files:
            path = file['path']
            is_log = path.endswith('.out') or file.get('role') == 'log'
            if not is_log and not path.endswith('.xml'):
                continue
            if file['sizeBytes'] > 6_000_000:
                fail(422, 'A diagnostic source is too large for verified automatic repair.', 'CAMPAIGN_EVIDENCE_UNAVAILABLE')
            raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=file['_key'])['Body'].read(6_000_001)
            if len(raw) != file['sizeBytes'] or hashlib.sha256(raw).hexdigest() != file['sha256']:
                fail(409, 'Diagnostic artifact checksum changed.', 'CAMPAIGN_EVIDENCE_CHANGED')
            if is_log:
                logs.append(raw.decode('utf-8'))
        if not logs:
            fail(422, 'No verified solver log is available.', 'CAMPAIGN_EVIDENCE_UNAVAILABLE')
        raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=job['inputKey'])['Body'].read(4_500_001)
        if len(raw) > 4_500_000:
            fail(422, 'Retained input is too large.', 'CAMPAIGN_EVIDENCE_UNAVAILABLE')
        source = json.loads(raw)
        values = {key: source.get(key) for key in ('structureId', 'calculationType', 'qeInput', 'inputFiles', 'settings', 'pseudopotentials', 'scfSourceCalculationId')}
        values.update(projectId=job['projectId'], dependsOnCalculationIds=job.get('dependsOnCalculationIds', []), vcpus=job['vcpus'], memoryMiB=job['memoryMiB'], computeTarget='personal')
        if job.get('executionAffinity'):
            values['executionAffinity'] = job['executionAffinity']
        if source.get('calculationId') != job['id'] or source.get('projectId') != row['projectId'] or digest(values) != job.get('requestFingerprint'):
            fail(409, 'Retained input does not match the admitted scientific request.', 'CAMPAIGN_EVIDENCE_CHANGED')
        return manifest, manifest_sha, '\n'.join(logs), raw.decode('utf-8')

    def repair_request(self, row: dict, job: dict, source: dict, step: dict) -> dict:
        if job['calculationType'] not in {'Total energy', 'Structural relaxation'} or job.get('dependsOnCalculationIds'):
            fail(422, 'Review dependent calculations separately before repairing.', 'CAMPAIGN_INPUT_UNSUPPORTED')
        request = {key: copy.deepcopy(source[key]) for key in ('structureId', 'calculationType', 'qeInput', 'inputFiles', 'pseudopotentials', 'settings', 'executionAffinity') if key in source}
        files = request.get('inputFiles')
        if not isinstance(files, dict) or len(files) != 1 or next(iter(files.values())).strip() != request['qeInput'].strip():
            fail(422, 'Automatic repair requires one exact primary QE input.', 'CAMPAIGN_INPUT_UNSUPPORTED')
        text = repaired_qe_input(request['qeInput'], step)
        request.update(qeInput=text, inputFiles={next(iter(files)): text}, computeTarget='personal', vcpus=job['vcpus'], memoryMiB=job['memoryMiB'], name=job['name'], run=True)
        return request

    def advance(self, supplied: dict, *, now: float | None = None) -> None:
        now = time.time() if now is None else float(now)
        owner = supplied['ownerId']
        row = json_safe(self.ai.row(owner, 'AI_CAMPAIGN', supplied['id']))
        if row['status'] in TERMINAL or row.get('leaseUntil', 0) > now:
            return
        row = self.update(row, leaseUntil=now + 90)
        approved = self.workflow.read_json(row['snapshotKey'], row['snapshotSha256'])
        if workflow_digest(approved) != row['approvalHash']:
            fail(409, 'Campaign approval checksum changed.', 'CAMPAIGN_CONFLICT')
        index = row['candidateIndex']
        if index >= len(approved['candidates']):
            self.update(row, status='completed', leaseUntil=0)
            return
        candidate = approved['candidates'][index]
        attempts = [attempt for attempt in row['attempts'] if attempt['candidateIndex'] == index]
        active = attempts[-1] if attempts else None
        stop = row['cancelRequested'] or now >= approved['budget']['expiresAtEpoch']
        if active:
            entity = 'PROJECT_RUN' if active['mode'] == 'workflow' else 'CALCULATION'
            receipt = self.services.get_item(owner, entity, active['expectedId'])
            if not receipt:
                self.update(row, status='manual resume required', reason='Submission receipt is uncertain. No automatic resubmission was made.', leaseUntil=0)
                return
            if receipt.get('projectId') != row['projectId'] or receipt.get('ownerId') != owner:
                fail(409, 'Submission receipt scope differs.', 'CAMPAIGN_CONFLICT')
            request = self.workflow.read_json(active['_requestKey'], active['_requestSha256'])
            if workflow_digest(request) != active['requestSha256']:
                fail(409, 'Submission intent changed.', 'CAMPAIGN_CONFLICT')
            if active['mode'] == 'workflow':
                if receipt.get('requestFingerprint') != workflow_digest({key: request.get(key) for key in ('revision', 'targets', 'rerun', 'compilerSha256')}):
                    fail(409, 'Run receipt does not match its intent.', 'CAMPAIGN_CONFLICT')
                if row['cancelRequested']:
                    self.workflow.cancel(owner, row['projectId'], receipt['id'], {})
                else:
                    self.workflow.advance(owner, row['projectId'], receipt['id'])
                run = self.workflow.get_run(owner, row['projectId'], receipt['id'])['run']
                target = next((item for item in run['attempts'] if item['nodeId'] == candidate['target']), {})
                job = self.services.get_item(owner, 'CALCULATION', target.get('jobId', '')) if target.get('jobId') else None
                if not job:
                    if run['status'] in {'failed', 'cancelled'}:
                        self.update(row, status='cancelled' if row['cancelRequested'] else 'manual resume required', reason='The candidate has no confirmed scientific job.', leaseUntil=0)
                    else:
                        self.update(row, leaseUntil=0)
                    return
            else:
                job = receipt
            if job.get('projectId') != row['projectId'] or job.get('ownerId') != owner:
                fail(409, 'Scientific job scope differs.', 'CAMPAIGN_CONFLICT')
            active['jobId'] = job['id']
            active['phase'] = 'observing'
            state = job['status']
            if state not in {'COMPLETED', 'FAILED', 'CANCELLED'}:
                is_running = state in {'RUNNING', 'CANCEL_REQUESTED'}
                clock = 'runningSinceEpoch' if is_running else 'queuedSinceEpoch'
                active.setdefault(clock, now if is_running else active['createdAtEpoch'])
                bound = approved['budget']['wallSecondsPerAttempt' if is_running else 'queueSecondsPerAttempt']
                # Expiry prevents new work; queue/runtime budgets explicitly authorize stopping this attempt.
                if row['cancelRequested'] or now - active[clock] >= bound:
                    active['budgetStopped'] = not row['cancelRequested']
                    self.api.cancel_calculation(owner, job['id'])
                self.update(row, attempts=row['attempts'], leaseUntil=0)
                return
            if row['cancelRequested'] or active.get('budgetStopped') or state == 'CANCELLED':
                self.update(row, status='cancelled' if row['cancelRequested'] else 'manual resume required', reason='Candidate cancelled or its queue/runtime budget was exhausted.', attempts=row['attempts'], leaseUntil=0)
                return
            manifest, manifest_sha, logs, input_text = self.evidence(row, job)
            input_sha = hashlib.sha256(input_text.encode()).hexdigest()
            if active.get('sourceInputSha256') and active['sourceInputSha256'] != input_sha:
                fail(409, 'Retained input changed.', 'CAMPAIGN_EVIDENCE_CHANGED')
            source = json.loads(input_text)
            evidence_key, evidence_sha = self.workflow.write_json(owner, row['projectId'], 'campaigns', {'input': source, 'manifestSha256': manifest_sha, 'logSha256': hashlib.sha256(logs.encode()).hexdigest()})
            active.update(sourceInputSha256=input_sha, resultManifestSha256=manifest_sha, evidenceSha256=evidence_sha, _evidenceKey=evidence_key, phase='validated', finishedAtEpoch=now)
            # c_bands is only a warning. Final positive numerical convergence wins.
            failure = dft_result_error(manifest, job['calculationType'])
            if state == 'COMPLETED' and failure is None:
                active['outcome'] = 'completed'
                self.update(row, candidateIndex=index + 1, attempts=row['attempts'], leaseUntil=0)
                return
            nonconverged = re.search(r'convergence\s+(?:has\s+)?not\s+(?:been\s+)?achieved|convergence\s+not\s+reached|too many bands are not converged|scf.*failed to converge', logs, re.I)
            lost = re.search(r'lost\s+atoms', logs, re.I)
            if lost:
                active['repairProposal'] = {'kind': 'review_md_stability', 'requiresNewApproval': True, 'fieldsToReview': ['geometry', 'timestep', 'ensemble', 'potential'], 'preserveAllAtoms': True, 'automaticMinimization': False}
            active.update(outcome='failed', diagnosis='Lost atoms: review geometry, timestep and ensemble; propose changes for new approval.' if lost else failure or 'Solver failed.')
            row = self.update(row, attempts=row['attempts'], leaseUntil=0)
            if lost or not nonconverged or stop or len(attempts) > len(approved['repairs']):
                self.update(row, status='manual resume required', reason=active['diagnosis'] if lost else 'No approved numerical repair is applicable, the repair limit was reached, or approval expired.', leaseUntil=0)
                return
            if self.workflow.load(owner, row['projectId'])['revision'] != approved['revision']:
                self.update(row, status='manual resume required', reason='Canvas changed; review a new campaign.', leaseUntil=0)
                return
            if not getattr(self.services, 'compute_enabled', False):
                self.update(row, reason='Waiting for the approved local worker/runtime.', leaseUntil=0)
                return
            request = self.repair_request(row, job, source, approved['repairs'][len(attempts) - 1])
            # Both exact before/after inputs and the verified diagnostic hash are retained.
            request['settings'] = {**request.get('settings', {})}
            row = self.intent(row, approved, candidate, request, 'calculation', now, 'Verified final SCF failure; apply approved numerical repair step ' + str(len(attempts)))
            self.submit_intent(row, self.workflow.read_json(row['attempts'][-1]['_requestKey'], row['attempts'][-1]['_requestSha256']))
            return
        if stop or row['usedNodeHours'] + candidate['nodeHoursPerAttempt'] > approved['budget']['totalNodeHours'] + 1e-12:
            self.update(row, status='cancelled' if row['cancelRequested'] else 'manual resume required', reason='Campaign cancelled, expired or node-hour budget exhausted.', leaseUntil=0)
            return
        if not getattr(self.services, 'compute_enabled', False):
            self.update(row, reason='Waiting for the approved local worker/runtime.', leaseUntil=0)
            return
        request = {'revision': approved['revision'], 'targets': [candidate['target']], 'rerun': [candidate['target']], 'compilerSha256': candidate['plan'].get('compilerSha256'), 'reviewedPlan': candidate['plan'], 'reviewedWorkflow': candidate['workflow']}
        row = self.intent(row, approved, candidate, request, 'workflow', now, 'Initial candidate within reviewed campaign')
        self.submit_intent(row, self.workflow.read_json(row['attempts'][-1]['_requestKey'], row['attempts'][-1]['_requestSha256']))
