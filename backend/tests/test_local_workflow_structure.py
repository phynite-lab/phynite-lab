"""Tests for owner-checked conversion of relaxation/SCF structure outputs."""
from __future__ import annotations

import hashlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.workflow_structure import (
    lattice_vectors,
    md_structure_input,
    resolve_qe_element,
    source_structure,
)


class ResolveQeElementTests(unittest.TestCase):
    def test_exact_element_symbol(self):
        self.assertEqual(resolve_qe_element("C"), "C")
        self.assertEqual(resolve_qe_element("Fe"), "Fe")
        self.assertEqual(resolve_qe_element("Si"), "Si")

    def test_labeled_atom_symbols(self):
        self.assertEqual(resolve_qe_element("C1"), "C")
        self.assertEqual(resolve_qe_element("C2"), "C")
        self.assertEqual(resolve_qe_element("Fe1"), "Fe")
        self.assertEqual(resolve_qe_element("Fe2"), "Fe")
        self.assertEqual(resolve_qe_element("Si_a"), "Si")
        self.assertEqual(resolve_qe_element("Al12"), "Al")

    def test_single_letter_symbol_needs_a_non_lowercase_suffix(self):
        # Sa is not a sulfur label under the Phynite QE label rule, so it is not guessed.
        self.assertEqual(resolve_qe_element("Sa"), "Sa")
        self.assertEqual(resolve_qe_element("Sa", {"Sa": "Sb"}), "Sb")
        self.assertEqual(resolve_qe_element("CX"), "C")

    def test_species_map_override(self):
        species_map = {"C_siteA": "C", "CustomFe": "Fe"}
        self.assertEqual(resolve_qe_element("C_siteA", species_map), "C")
        self.assertEqual(resolve_qe_element("CustomFe", species_map), "Fe")


class WorkflowStructureSourceTests(unittest.TestCase):
    def _create_mock_api(self, xml_content: str, parent_structure: dict | None = None):
        xml_bytes = xml_content.encode("utf-8")
        xml_sha = hashlib.sha256(xml_bytes).hexdigest()

        services = SimpleNamespace()
        services.bucket = "test-bucket"
        s3 = MagicMock()

        calc_job = {
            "id": "calc_relax_1",
            "projectId": "prj_1",
            "calculationType": "Structural relaxation",
            "status": "COMPLETED",
            "structureId": "str_parent" if parent_structure else None,
            "outputPrefix": "users/user1/calcs/calc_relax_1",
        }

        stage = {
            "stage": "relax",
            "calculationMode": "relax",
            "jobDone": True,
            "electronicConvergence": "converged",
            "ionicConvergence": "converged",
            "cellConvergence": "not-applicable",
            "hybridConvergence": "not-applicable",
            "scfAccuracy": {
                "status": "verified",
                "residualRy": 1e-8,
                "residualUpperRy": 1e-8,
                "thresholdRy": 1e-6,
                "source": "qe-log-bound",
            },
        }

        manifest_data = {
            "format": 1,
            "calculationId": "calc_relax_1",
            "status": "completed",
            "calculationType": "Structural relaxation",
            "summary": {
                "converged": True,
                "geometryConverged": True,
                "jobDone": True,
                "stageConvergence": [stage],
            },
            "artifacts": [
                {
                    "path": "evidence/relax.xml",
                    "sha256": xml_sha,
                    "sizeBytes": len(xml_bytes),
                    "contentType": "application/xml",
                }
            ],
        }

        def get_item(owner, entity_type, item_id):
            if entity_type == "CALCULATION" and item_id == "calc_relax_1":
                return {
                    "PK": f"USER#{owner}",
                    "SK": f"CALCULATION#{item_id}",
                    **calc_job,
                }
            if entity_type == "STRUCTURE" and item_id == "str_parent":
                return {
                    "PK": f"USER#{owner}",
                    "SK": f"STRUCTURE#{item_id}",
                    "id": item_id,
                    "projectId": "prj_1",
                    "objectKey": "users/user1/structures/parent.json",
                }
            if entity_type == "MD_TRAJECTORY":
                return None
            return None

        services.get_item = MagicMock(side_effect=get_item)

        def s3_get_object(Bucket, Key):
            if Key.endswith("result.json"):
                raw = json.dumps(manifest_data).encode("utf-8")
                return {"Body": io.BytesIO(raw)}
            if "evidence/relax.xml" in Key:
                return {"Body": io.BytesIO(xml_bytes)}
            if "parent.json" in Key and parent_structure:
                raw = json.dumps(parent_structure).encode("utf-8")
                return {"Body": io.BytesIO(raw)}
            raise KeyError(f"Unexpected S3 key: {Key}")

        s3.get_object = MagicMock(side_effect=s3_get_object)
        s3.put_object = MagicMock()
        services.s3 = s3

        api = SimpleNamespace()
        api.services = services
        api.put_new = MagicMock()
        return api

    def test_source_structure_resolves_labeled_atoms_from_relaxation(self):
        relax_xml = """<?xml version="1.0"?>
<qes:espresso xmlns:qes="http://www.quantum-espresso.org/ns/qes/qes-1.0">
  <output>
    <atomic_species>
      <species name="C1">
        <pseudo_file>C.pbe-n-kjpaw_psl.1.0.0.UPF</pseudo_file>
      </species>
      <species name="C2">
        <pseudo_file>C.pbe-n-kjpaw_psl.1.0.0.UPF</pseudo_file>
      </species>
    </atomic_species>
    <atomic_structure>
      <cell>
        <a1>4.65604100 0.00000000 0.00000000</a1>
        <a2>-2.32802050 4.03224950 0.00000000</a2>
        <a3>0.00000000 0.00000000 28.34589100</a3>
      </cell>
      <atomic_positions>
        <atom name="C1">0.00000000 0.00000000 0.00000000</atom>
        <atom name="C2">2.32802050 1.34408317 0.00000000</atom>
      </atomic_positions>
    </atomic_structure>
  </output>
</qes:espresso>"""
        parent_structure = {
            "name": "Graphene",
            "periodic": [True, True, False],
            "atoms": [
                {"id": "a0", "species": "C", "label": "C1", "x": 0.0, "y": 0.0, "z": 0.0},
                {"id": "a1", "species": "C", "label": "C2", "x": 0.333333, "y": 0.666667, "z": 0.0},
            ],
            "lattice": {
                "a": 2.4638, "b": 2.4638, "c": 15.0,
                "alpha": 90.0, "beta": 90.0, "gamma": 120.0,
                "periodic": [True, True, False],
            },
        }

        api = self._create_mock_api(relax_xml, parent_structure)
        attempt = {"jobKind": "CALCULATION", "jobId": "calc_relax_1"}

        result = source_structure(api, "user1", "prj_1", attempt)

        # Structure should resolve element symbol to C and keep C1/C2 labels
        self.assertEqual(result["formula"], "C")
        self.assertEqual(result["source"], "workflow-relaxation")
        self.assertEqual(result["periodic"], [True, True, False])
        self.assertEqual(len(result["atoms"]), 2)
        self.assertEqual(result["atoms"][0]["species"], "C")
        self.assertEqual(result["atoms"][0]["label"], "C1")
        self.assertEqual(result["atoms"][1]["species"], "C")
        self.assertEqual(result["atoms"][1]["label"], "C2")

    def test_source_structure_resolves_pseudo_file_when_no_parent(self):
        relax_xml = """<?xml version="1.0"?>
<qes:espresso xmlns:qes="http://www.quantum-espresso.org/ns/qes/qes-1.0">
  <output>
    <atomic_species>
      <species name="Fe_mag1">
        <pseudo_file>Fe.pbe-spn-kjpaw_psl.1.0.0.UPF</pseudo_file>
      </species>
    </atomic_species>
    <atomic_structure>
      <cell>
        <a1>5.4 0.0 0.0</a1>
        <a2>0.0 5.4 0.0</a2>
        <a3>0.0 0.0 5.4</a3>
      </cell>
      <atomic_positions>
        <atom name="Fe_mag1">0.0 0.0 0.0</atom>
      </atomic_positions>
    </atomic_structure>
  </output>
</qes:espresso>"""
        api = self._create_mock_api(relax_xml, parent_structure=None)
        attempt = {"jobKind": "CALCULATION", "jobId": "calc_relax_1"}

        result = source_structure(api, "user1", "prj_1", attempt)

        self.assertEqual(result["formula"], "Fe")
        self.assertEqual(result["atoms"][0]["species"], "Fe")
        self.assertEqual(result["atoms"][0]["label"], "Fe_mag1")

    def test_source_structure_from_scf_total_energy(self):
        scf_xml = """<?xml version="1.0"?>
<qes:espresso xmlns:qes="http://www.quantum-espresso.org/ns/qes/qes-1.0">
  <output>
    <atomic_species>
      <species name="Si1">
        <pseudo_file>Si.pbe-n-kjpaw_psl.1.0.0.UPF</pseudo_file>
      </species>
    </atomic_species>
    <atomic_structure>
      <cell>
        <a1>5.43 0.0 0.0</a1>
        <a2>0.0 5.43 0.0</a2>
        <a3>0.0 0.0 5.43</a3>
      </cell>
      <atomic_positions>
        <atom name="Si1">0.0 0.0 0.0</atom>
      </atomic_positions>
    </atomic_structure>
  </output>
</qes:espresso>"""
        xml_bytes = scf_xml.encode("utf-8")
        xml_sha = hashlib.sha256(xml_bytes).hexdigest()

        stage = {
            "stage": "scf",
            "calculationMode": "scf",
            "jobDone": True,
            "electronicConvergence": "converged",
            "hybridConvergence": "not-applicable",
            "scfAccuracy": {
                "status": "verified",
                "residualRy": 1e-8,
                "residualUpperRy": 1e-8,
                "thresholdRy": 1e-6,
                "source": "qe-log-bound",
            },
        }

        manifest_data = {
            "format": 1,
            "calculationId": "calc_scf_1",
            "status": "completed",
            "calculationType": "Total energy",
            "summary": {
                "converged": True,
                "jobDone": True,
                "stageConvergence": [stage],
            },
            "artifacts": [
                {
                    "path": "evidence/scf.xml",
                    "sha256": xml_sha,
                    "sizeBytes": len(xml_bytes),
                    "contentType": "application/xml",
                }
            ],
        }

        services = SimpleNamespace()
        services.bucket = "test-bucket"
        s3 = MagicMock()

        calc_job = {
            "id": "calc_scf_1",
            "projectId": "prj_1",
            "calculationType": "Total energy",
            "status": "COMPLETED",
            "structureId": None,
            "outputPrefix": "users/user1/calcs/calc_scf_1",
        }

        def get_item(owner, entity_type, item_id):
            if entity_type == "CALCULATION" and item_id == "calc_scf_1":
                return {"PK": f"USER#{owner}", "SK": f"CALCULATION#{item_id}", **calc_job}
            return None

        services.get_item = MagicMock(side_effect=get_item)

        def s3_get_object(Bucket, Key):
            if Key.endswith("result.json"):
                return {"Body": io.BytesIO(json.dumps(manifest_data).encode("utf-8"))}
            if "evidence/scf.xml" in Key:
                return {"Body": io.BytesIO(xml_bytes)}
            raise KeyError(f"Unexpected S3 key: {Key}")

        s3.get_object = MagicMock(side_effect=s3_get_object)
        services.s3 = s3

        api = SimpleNamespace()
        api.services = services
        attempt = {"jobKind": "CALCULATION", "jobId": "calc_scf_1"}

        result = source_structure(api, "user1", "prj_1", attempt)
        self.assertEqual(result["formula"], "Si")
        self.assertEqual(result["source"], "workflow-scf")
        self.assertEqual(result["atoms"][0]["species"], "Si")

    def test_source_structure_unresolved_particle_raises_error(self):
        relax_xml = """<?xml version="1.0"?>
<qes:espresso xmlns:qes="http://www.quantum-espresso.org/ns/qes/qes-1.0">
  <output>
    <atomic_species>
      <species name="X1">
        <pseudo_file>x_fake.upf</pseudo_file>
      </species>
    </atomic_species>
    <atomic_structure>
      <cell>
        <a1>5.0 0.0 0.0</a1>
        <a2>0.0 5.0 0.0</a2>
        <a3>0.0 0.0 5.0</a3>
      </cell>
      <atomic_positions>
        <atom name="X1">0.0 0.0 0.0</atom>
      </atomic_positions>
    </atomic_structure>
  </output>
</qes:espresso>"""
        api = self._create_mock_api(relax_xml, parent_structure=None)
        attempt = {"jobKind": "CALCULATION", "jobId": "calc_relax_1"}

        with self.assertRaises(ApiError) as ctx:
            source_structure(api, "user1", "prj_1", attempt)
        self.assertEqual(ctx.exception.code, "MD_ELEMENT_MAPPING_REQUIRED")

    def test_md_structure_input_with_resolved_species(self):
        relax_xml = """<?xml version="1.0"?>
<qes:espresso xmlns:qes="http://www.quantum-espresso.org/ns/qes/qes-1.0">
  <output>
    <atomic_species>
      <species name="C1">
        <pseudo_file>C.pbe-n-kjpaw_psl.1.0.0.UPF</pseudo_file>
      </species>
    </atomic_species>
    <atomic_structure>
      <cell>
        <a1>4.65604100 0.00000000 0.00000000</a1>
        <a2>-2.32802050 4.03224950 0.00000000</a2>
        <a3>0.00000000 0.00000000 28.34589100</a3>
      </cell>
      <atomic_positions>
        <atom name="C1">0.00000000 0.00000000 0.00000000</atom>
      </atomic_positions>
    </atomic_structure>
  </output>
</qes:espresso>"""
        api = self._create_mock_api(relax_xml, parent_structure=None)
        attempt = {"jobKind": "CALCULATION", "jobId": "calc_relax_1"}

        resource_id = md_structure_input(api, "user1", "prj_1", attempt, "p p p")
        self.assertTrue(resource_id.startswith("mdt_"))
        api.services.s3.put_object.assert_called_once()
        put_kwargs = api.services.s3.put_object.call_args[1]
        uploaded_bytes = put_kwargs["Body"]
        self.assertIn(b"C ", uploaded_bytes)


if __name__ == "__main__":
    unittest.main()


class WorkflowStructureReviewFindingsTests(unittest.TestCase):
    """Review findings: labels follow the QE output, and conflicting element evidence is rejected."""
    LATTICE = {"a": 2.8, "b": 2.8, "c": 2.8, "alpha": 90.0, "beta": 90.0, "gamma": 90.0, "periodic": [True, True, True]}

    @staticmethod
    def xml(species, atoms):
        species_xml = "".join(f'<species name="{name}"><pseudo_file>{pseudo}</pseudo_file></species>' for name, pseudo in species)
        atoms_xml = "".join(f'<atom name="{name}">{index} 0 0</atom>' for index, name in enumerate(atoms))
        return ('<?xml version="1.0"?><qes:espresso xmlns:qes="http://www.quantum-espresso.org/ns/qes/qes-1.0"><output>'
                f'<atomic_species>{species_xml}</atomic_species><atomic_structure><cell><a1>5.4 0 0</a1><a2>0 5.4 0</a2><a3>0 0 5.4</a3></cell>'
                f'<atomic_positions>{atoms_xml}</atomic_positions></atomic_structure></output></qes:espresso>')

    def source(self, xml_content, parent=None):
        api = WorkflowStructureSourceTests()._create_mock_api(xml_content, parent)
        return source_structure(api, "user1", "prj_1", {"jobKind": "CALCULATION", "jobId": "calc_relax_1"})

    def test_labels_come_from_the_qe_output_even_when_parent_atoms_are_ordered_differently(self):
        parent = {"name": "Fe", "periodic": [True, True, True], "lattice": self.LATTICE, "atoms": [
            {"id": "a", "species": "Fe", "label": "Fe2", "x": 0, "y": 0, "z": 0},
            {"id": "b", "species": "Fe", "label": "Fe1", "x": 0.5, "y": 0.5, "z": 0.5},
            {"id": "c", "species": "Fe", "label": "Fe3", "x": 0.5, "y": 0, "z": 0}]}
        result = self.source(self.xml([("Fe1", "Fe.pbe.UPF"), ("Fe2", "Fe.pbe.UPF")], ["Fe1", "Fe2"]), parent)
        self.assertEqual([atom.get("label") for atom in result["atoms"]], ["Fe1", "Fe2"])
        self.assertEqual([atom["species"] for atom in result["atoms"]], ["Fe", "Fe"])

    def test_parent_and_pseudopotential_disagreement_is_rejected(self):
        parent = {"name": "Fe", "periodic": [True, True, True], "lattice": self.LATTICE, "atoms": [{"id": "a", "species": "Fe", "label": "Fe1", "x": 0, "y": 0, "z": 0}]}
        with self.assertRaises(ApiError) as caught:
            self.source(self.xml([("Fe1", "Co.pbe-spn.UPF")], ["Fe1"]), parent)
        self.assertEqual(caught.exception.code, "WORKFLOW_SPECIES_CONFLICT")

    def test_label_and_pseudopotential_disagreement_is_rejected_without_a_parent(self):
        with self.assertRaises(ApiError) as caught:
            self.source(self.xml([("Fe1", "Co.pbe-spn.UPF")], ["Fe1"]))
        self.assertEqual(caught.exception.code, "WORKFLOW_SPECIES_CONFLICT")

    def test_an_unruled_label_uses_the_pseudopotential_without_guessing(self):
        result = self.source(self.xml([("Sa", "Sb.pbe.UPF")], ["Sa"]))
        self.assertEqual(result["atoms"][0]["species"], "Sb")
        self.assertEqual(result["atoms"][0]["label"], "Sa")


class StandaloneBandStructureTests(unittest.TestCase):
    def test_standalone_band_structure_port_and_graph_validation(self):
        from backend.local_api.domain.project_workflow import validate_graph, PORTS
        self.assertIn('structure', PORTS['bands'][0])
        self.assertIn('electronic', PORTS['bands'][0])

        graph = {
            'version': 1,
            'projectId': 'prj_1',
            'nodes': [
                {'id': 'n_str', 'kind': 'structure', 'name': 'Si Structure', 'position': {'x': 0, 'y': 0}, 'configuration': {}, 'resources': [{'kind': 'structure', 'id': 'str_1'}]},
                {'id': 'n_bands', 'kind': 'bands', 'name': 'Band structure', 'position': {'x': 250, 'y': 0}, 'configuration': {'standalone': True, 'draft': {'functional': 'PBE', 'cutoff': 80}}, 'resources': []}
            ],
            'edges': [
                {'id': 'e1', 'source': 'n_str', 'target': 'n_bands', 'port': 'structure'}
            ],
            'groups': []
        }
        validated = validate_graph(graph, 'prj_1')
        self.assertEqual(len(validated['edges']), 1)
        self.assertEqual(validated['edges'][0]['port'], 'structure')


class StandaloneFingerprintTests(unittest.TestCase):
    def test_actual_graph_ports_control_standalone_physics_fingerprint(self):
        from backend.local_api.domain.project_workflow import fingerprints
        graph = {'nodes': [
            {'id': 's', 'kind': 'structure', 'configuration': {}, 'resources': []},
            {'id': 'b', 'kind': 'bands', 'configuration': {'draft': {'cutoff': 60}}, 'resources': []},
        ], 'edges': [{'source': 's', 'target': 'b', 'port': 'structure'}]}
        before = fingerprints(graph)
        graph['nodes'][1]['configuration']['standalone'] = False
        self.assertEqual(fingerprints(graph), before)
        graph['nodes'][1]['configuration']['draft']['cutoff'] = 80
        self.assertNotEqual(fingerprints(graph)['b'], before['b'])
        graph['nodes'][0]['kind'] = 'scf'; graph['edges'][0]['port'] = 'electronic'
        inherited = fingerprints(graph)
        graph['nodes'][1]['configuration'] = {'standalone': True, 'draft': {'cutoff': 200}}
        self.assertEqual(fingerprints(graph), inherited)
