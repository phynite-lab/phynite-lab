from __future__ import annotations
import base64
import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local_api'))
from backend.local_api.bundles import prepare_bundle, import_bundle
from backend.local_api.domain.phynite_core import ApiError

class LocalDraftTests(unittest.TestCase):
    def bundle(self):
        raw=json.dumps({'atoms':[{'id':'a','species':'Si','x':0,'y':0,'z':0,'label':'Si1','occupancy':1}], 'lattice':{'a':3,'b':3,'c':20,'alpha':90,'beta':90,'gamma':90,'periodic':[True,True,False]}}).encode()
        source={'id':'s','name':'Silicon','kind':'structure','position':{'x':0,'y':0},'configuration':{},'resources':[{'kind':'structure','id':'str_old','sha256':hashlib.sha256(raw).hexdigest()}]}
        target={'id':'c','name':'SCF','kind':'scf','position':{'x':300,'y':0},'configuration':{'execution':{'status':'COMPLETED'},'preservedHistory':['old'],'draft':{'ecutwfc':'30'}},'resources':[]}
        return {'format':'phynite-workflow-draft','version':1,'name':'Imported','workflow':{'version':1,'projectId':'old','nodes':[source,target],'edges':[{'id':'e','source':'s','target':'c','port':'structure'}],'groups':[]},'inputs':[{'id':'str_old','kind':'structure','filename':'structure.json','sha256':hashlib.sha256(raw).hexdigest(),'bytes':base64.b64encode(raw).decode()}]}
    def test_import_remaps_and_preserves_science_without_execution(self):
        original=self.bundle();_,graph,resources,mapping,missing=prepare_bundle(copy.deepcopy(original),'owner')
        self.assertNotEqual(graph['projectId'],'old');self.assertNotEqual(graph['nodes'][0]['id'],'s');self.assertEqual(graph['edges'][0]['source'],graph['nodes'][0]['id']);self.assertNotIn('execution',graph['nodes'][1]['configuration']);self.assertNotIn('preservedHistory',graph['nodes'][1]['configuration']);self.assertFalse(missing)
        raw=resources[('structure','str_old')][1];self.assertEqual(json.loads(raw)['lattice']['periodic'],[True,True,False]);self.assertNotEqual(mapping[('structure','str_old')],'str_old')
    def test_checksum_duplicates_and_unsafe_filename_fail_before_publication(self):
        for mutate in [lambda b:b['inputs'][0].update(sha256='0'*64),lambda b:b['inputs'].append(b['inputs'][0]),lambda b:b['inputs'][0].update(filename='../source')]:
            bundle=self.bundle();mutate(bundle)
            with self.assertRaises(ApiError):prepare_bundle(bundle,'owner')
    def test_missing_resource_is_visible_and_never_reuses_source_identity(self):
        bundle=self.bundle();bundle['inputs']=[]
        _,graph,_,_,missing=prepare_bundle(bundle,'owner');self.assertEqual(graph['nodes'][0]['resources'],[]);self.assertTrue(missing);self.assertTrue(graph['nodes'][0]['configuration']['missingInputs'])

    def test_reference_mapping_never_rewrites_scientific_labels_or_species(self):
        bundle=self.bundle();bundle['workflow']['nodes'][0]['id']='Si';bundle['workflow']['edges'][0]['source']='Si';bundle['workflow']['nodes'][0]['configuration']['structure']={'atoms':[{'id':'Si','species':'Si','label':'Si'}]}
        _,graph,_,_,_=prepare_bundle(bundle,'owner')
        self.assertEqual(graph['nodes'][0]['configuration']['structure']['atoms'][0],{'id':'Si','species':'Si','label':'Si'})
        self.assertNotEqual(graph['edges'][0]['id'],'e')

    def test_failed_transaction_removes_staged_objects_and_does_not_publish_metadata(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        import tempfile
        from backend.local_api.services import LocalServices
        from backend.local_api.domain.api import PhyniteApi
        with tempfile.TemporaryDirectory() as directory:
            services = LocalServices(Path(directory), "http://127.0.0.1:8792", "http://127.0.0.1:3000")
            owner = services.owner
            with patch.object(services.persistence_client, 'transact_write_items', side_effect=RuntimeError('injected failed transaction')):
                with self.assertRaisesRegex(RuntimeError, 'injected failed'):
                    import_bundle(PhyniteApi(services), owner, self.bundle())
            self.assertEqual(services.s3.list_objects_v2(Bucket=services.bucket).get('Contents', []), [])
            self.assertFalse(services.list_owner_items(owner, 'PROJECT'))
