"""Research context and immutable run ledger contract tests."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.research_ledger import append_research_event, list_research_events, research_context
from backend.local_api.services import LocalServices


class ResearchLedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.services = LocalServices(Path(self.tmp.name), "http://127.0.0.1:8792", "http://127.0.0.1:3000")
        self.api = PhyniteApi(self.services)
        self.owner = self.services.owner
        self.project = json.loads(self.api.create_project(self.owner, {"name": "Ledger fixture"})["body"])["project"]["id"]

    def test_project_event_and_client_event_round_trip(self):
        created = append_research_event(self.services, self.owner, self.project, {
            "eventType": "decision", "title": "Keep cutoff", "summary": "Retain the reviewed cutoff.",
            "metadata": {"cutoffRy": 60}, "inputSha256": "a" * 64,
        })
        rows = list_research_events(self.services, self.owner, self.project)
        created_row = next(row for row in rows if row["id"] == created["id"])
        self.assertEqual(created_row["inputSha256"], "a" * 64)
        self.assertTrue(any(row["eventType"] == "project_created" for row in rows))

    def test_lifecycle_claim_is_server_only(self):
        with self.assertRaises(ApiError) as rejected:
            append_research_event(self.services, self.owner, self.project, {
                "eventType": "calculation_completed", "title": "fake", "summary": "fake"
            })
        self.assertEqual(rejected.exception.code, "SERVER_EVENT_REQUIRED")
        event = append_research_event(self.services, self.owner, self.project, {
            "eventType": "calculation_completed", "title": "Run completed", "summary": "Verified", "runId": "calc_1"
        }, allow_server=True)
        self.assertEqual(event["eventType"], "calculation_completed")

    def test_secrets_and_unbounded_fields_are_rejected(self):
        with self.assertRaises(ApiError):
            append_research_event(self.services, self.owner, self.project, {
                "eventType": "decision", "title": "bad", "summary": "bad", "metadata": {"apiToken": "secret"}
            })
        with self.assertRaises(ApiError):
            append_research_event(self.services, self.owner, self.project, {
                "eventType": "decision", "title": "bad", "summary": "x" * 1001
            })

    def test_context_contains_owned_runs_and_is_persistent(self):
        context = research_context(self.services, self.owner, self.project)
        self.assertEqual(context["project"]["id"], self.project)
        self.assertIn("events", context)
        self.assertIn("runs", context)
        reopened = LocalServices(Path(self.tmp.name), "http://127.0.0.1:8792", "http://127.0.0.1:3000")
        self.assertEqual(len(list_research_events(reopened, reopened.owner, self.project)), 1)

    def test_context_classifies_failure_without_mutating_run(self):
        self.services.put_item({
            "PK": f"OWNER#{self.owner}", "SK": "CALCULATION#calc_1",
            "GSI1PK": f"PROJECT#{self.project}", "GSI1SK": "CALCULATION#2026-11-03T00:00:00Z#calc_1",
            "entityType": "CALCULATION", "id": "calc_1", "ownerId": self.owner,
            "projectId": self.project, "name": "SCF", "status": "FAILED",
            "failureReason": "SCF did not converge before electron_maxstep.",
            "createdAt": "2026-11-03T00:00:00Z",
        })
        append_research_event(self.services, self.owner, self.project, {
            "eventType": "calculation_submitted", "title": "Calculation submitted",
            "summary": "SCF", "runId": "calc_1", "inputSha256": "b" * 64,
        }, allow_server=True)
        context = research_context(self.services, self.owner, self.project)
        self.assertEqual(context["runs"][0]["failureCategory"], "SCF_CONVERGENCE")
        self.assertEqual(context["runs"][0]["failureReason"], "SCF did not converge before electron_maxstep.")
        self.assertEqual(context["runs"][0]["inputSha256"], "b" * 64)

    def test_routes_use_project_ownership(self):
        event = {"requestContext": {"http": {"method": "POST"}, "authorizer": {"jwt": {"claims": {"sub": self.owner}}}}, "rawPath": f"/v1/projects/{self.project}/research-events", "body": json.dumps({"eventType": "decision", "title": "Note", "summary": "A note"})}
        body = json.loads(self.api.handle(event)["body"])
        self.assertEqual(body["event"]["eventType"], "decision")
        context_event = {"requestContext": {"http": {"method": "GET"}, "authorizer": {"jwt": {"claims": {"sub": self.owner}}}}, "rawPath": f"/v1/projects/{self.project}/research-context"}
        self.assertIn("context", json.loads(self.api.handle(context_event)["body"]))


if __name__ == "__main__":
    unittest.main()
