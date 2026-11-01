"""Exercise desktop cloud boundaries with real local state and account fences."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock

from backend.local_api.domain.phynite_core import ApiError, owner_partition
from backend.local_api.domain.account import AccountApi
from backend.local_api.cloud_client import CloudError
from backend.local_api.cloud_compute import CloudCompute
from backend.local_api.desktop_server import DesktopApplication


class LocalCloudIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = DesktopApplication(self.root, 49120, 'http://127.0.0.1:3000')
        self.addCleanup(self.app.close)
        self.owner = self.app.services.owner
        self.app.services.put_item({'PK': owner_partition(self.owner), 'SK': 'PROJECT#project', 'entityType': 'PROJECT', 'id': 'project', 'ownerId': self.owner, 'name': 'Silicon'})
        self.client = Mock(account='cloud-account')
        self.client.status.return_value = {'connected': True, 'accountId': self.client.account}
        self.app.connections.cloud = self.client

    def test_sync_preview_uses_supported_usage_endpoint_and_actual_quota(self):
        def remote(account, method, path):
            self.assertEqual((account, method, path), ('cloud-account', 'GET', '/v1/account/usage'))
            # Run the actual usage validator; an invented scope fails here.
            usage = AccountApi(self.app.services).usage(self.owner)
            usage['storage']['cloudQuotaBytes'] = 10 * 1024 ** 3
            return {'usage': usage}
        self.client.request.side_effect = remote
        result = self.app.connections._handle('POST', '/__local/sync/project/preview', {}, {}, False)
        self.assertEqual(result['cloudStorage']['limitBytes'], 10 * 1024 ** 3)
        self.assertEqual(result['cloudStorage']['availableBytes'], 10 * 1024 ** 3)
        self.assertFalse(self.app.connections.store.status('cloud-account', 'project')['enabled'])

    def test_estimate_does_not_submit_and_survives_restart_without_cross_account_history(self):
        compute = CloudCompute(self.root, self.client)
        preview = compute.preview('project', {'name': 'Si', 'atoms': [{}]}, {'calculationType': 'Total energy', 'qeInput': 'exact input', 'cloudMode': 'paid'})
        identifier, digest = preview['executionId'], preview['inputSha256']
        with self.assertRaises(CloudError):
            compute.submit(identifier, digest, 'a' * 32)
        self.client.request.assert_not_called()
        quote = {'id': 'a' * 32, 'expiresAtEpoch': int(time.time()) + 300, 'profile': {'id': 'actual-profile', 'hourlyMicros': 100}}
        remote = {'id': identifier, 'status': 'PREPARED'}
        self.client.request.side_effect = [{'execution': remote}, {'quote': quote}, {'execution': remote}, {'execution': {**remote, 'status': 'QUEUED'}}]
        self.assertEqual(compute.prepare(identifier, digest)['quote'], quote)
        self.assertFalse(any(call.args[2].endswith('/submit') for call in self.client.request.call_args_list))
        resumed = CloudCompute(self.root, self.client)
        state = resumed.status(identifier)
        self.assertEqual(state['inputSha256'], digest)
        self.assertEqual(state['quote'], quote)
        with self.assertRaises(CloudError):
            resumed.submit(identifier, digest)
        self.assertEqual(resumed.submit(identifier, digest, quote['id'])['execution']['status'], 'QUEUED')
        self.assertEqual(self.client.request.call_args.args[3]['confirmQuoteId'], quote['id'])
        self.assertEqual(resumed.list(self.app.services)[0]['status'], 'QUEUED')
        self.client.account = 'other-account'
        self.assertEqual(resumed.list(self.app.services), [])
        with self.assertRaises(CloudError):
            resumed.status(identifier)

    def test_imported_cloud_research_data_uses_local_artifact_boundary(self):
        key = f'users/local/projects/project/calculations/imported/output'
        self.app.services.put_item({'PK': owner_partition(self.owner), 'SK': 'CALCULATION#imported', 'entityType': 'CALCULATION', 'id': 'imported', 'ownerId': self.owner, 'projectId': 'project', 'status': 'COMPLETED', 'computeBackend': 'CLOUD_PAID_EC2', 'imported': True, 'outputPrefix': key})
        self.app.services.s3.put_object(Bucket=self.app.services.bucket, Key=key + '/research/dataset.json', Body=b'{"energy":-1.234,"unit":"Ry"}')
        result = self.app.dispatch('GET', '/v1/calculations/imported/research-data', b'', {'Authorization': 'Bearer ' + self.app.token}, {})
        self.assertEqual(result['statusCode'], 200)
        self.assertIn('/__local/artifacts?', json.loads(result['body'])['url'])


if __name__ == '__main__':
    unittest.main()
