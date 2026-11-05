"""Saved CPU and RAM choices survive the desktop loop and stay within the local budget."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.local_api.desktop_server import DesktopApplication
from backend.local_api.domain.account import AccountApi
from backend.local_api.domain.compute_preferences import WORKLOADS, budget_defaults, personal_resources
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.scheduler import ResourceError, ResourceScheduler

BUDGET = {"vcpus": 4, "memoryMiB": 8192}


class LocalComputeDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = DesktopApplication(self.root, 49121, "http://127.0.0.1:3000")
        self.addCleanup(self.app.close)
        self.services = self.app.services
        self.owner = self.services.owner
        # Deterministic per-job limits, larger than the admission budget.
        self.services.max_job_vcpus = self.services.max_md_job_vcpus = 8
        self.services.max_job_memory = self.services.max_md_job_memory = 16384

    def save_defaults(self, allocation):
        api = AccountApi(self.services)
        api.handle(self.owner, "PUT", "/v1/account/compute", {"computeTarget": "personal", "personalDefaults": {workload: allocation for workload in WORKLOADS}})
        return self.services.get_item(self.owner, "ACCOUNT", "primary")

    def test_saved_one_cpu_and_one_gib_survives_the_budget_sync(self):
        account = self.save_defaults({"vcpus": 1, "memoryMiB": 1024})
        self.assertEqual(account["personalDefaultsSource"], "user")
        synced = budget_defaults(self.services, account, BUDGET)
        # Previously every poll replaced this with the 4 vCPU / 8 GiB budget.
        self.assertEqual(synced, {workload: {"vcpus": 1, "memoryMiB": 1024} for workload in WORKLOADS})
        self.assertEqual(AccountApi(self.services).overview(self.owner)["personalDefaults"]["qe"], {"vcpus": 1, "memoryMiB": 1024})

    def test_the_desktop_loop_step_keeps_the_saved_choice_across_polls(self):
        self.save_defaults({"vcpus": 1, "memoryMiB": 1024})
        for _ in range(3):  # several maintenance polls with the default 4 vCPU / 8 GiB budget
            self.app.sync_personal_defaults(BUDGET)
        self.assertEqual(AccountApi(self.services).overview(self.owner)["personalDefaults"]["qe"], {"vcpus": 1, "memoryMiB": 1024})
        # Lowering the budget below the saved choice moves the defaults inside it.
        self.app.sync_personal_defaults({"vcpus": 1, "memoryMiB": 1024, "maxParallelJobs": 1})
        self.save_defaults({"vcpus": 2, "memoryMiB": 2048})
        self.app.sync_personal_defaults({"vcpus": 1, "memoryMiB": 1024, "maxParallelJobs": 1})
        self.assertEqual(AccountApi(self.services).overview(self.owner)["personalDefaults"]["qe"], {"vcpus": 1, "memoryMiB": 1024})

    def test_defaults_the_user_never_chose_follow_the_budget(self):
        account = {"personalDefaults": {workload: {"vcpus": 2, "memoryMiB": 4096} for workload in WORKLOADS}}
        self.assertEqual(budget_defaults(self.services, account, BUDGET), {workload: BUDGET for workload in WORKLOADS})
        self.assertEqual(budget_defaults(self.services, {}, BUDGET), {workload: BUDGET for workload in WORKLOADS})

    def test_a_choice_that_no_longer_fits_a_lower_budget_follows_the_budget(self):
        account = self.save_defaults({"vcpus": 4, "memoryMiB": 8192})
        lower = {"vcpus": 2, "memoryMiB": 4096}
        self.assertEqual(budget_defaults(self.services, account, lower), {workload: lower for workload in WORKLOADS})

    def test_an_invalid_stored_choice_is_not_kept(self):
        account = {"personalDefaultsSource": "user", "personalDefaults": {"qe": {"vcpus": 1, "memoryMiB": 512}, "md-analysis": {"vcpus": 2, "memoryMiB": 1024}}}
        synced = budget_defaults(self.services, account, BUDGET)
        self.assertEqual(synced["qe"], BUDGET)
        # MD analysis needs 1 GiB per vCPU.
        self.assertEqual(synced["md-analysis"], BUDGET)

    def test_one_gib_is_the_local_minimum_for_saving_and_running(self):
        account = AccountApi(self.services)
        with self.assertRaises(ApiError):
            account.handle(self.owner, "PUT", "/v1/account/compute", {"computeTarget": "personal", "personalDefaults": {"qe": {"vcpus": 1, "memoryMiB": 1023}}})
        self.assertEqual(personal_resources(self.services, self.owner, "qe", {"vcpus": 1, "memoryMiB": 1024})["memoryMiB"], 1024)
        with self.assertRaises(ApiError):
            personal_resources(self.services, self.owner, "qe", {"vcpus": 1, "memoryMiB": 1023})

    def test_the_admission_budget_rejects_ram_below_one_gib(self):
        capacity = mock.patch.object(ResourceScheduler, "capacity", return_value={"cpuCapacity": 8, "memoryCapacityMiB": 16384, "memoryEnforcement": "rss-watchdog"})
        capacity.start()
        self.addCleanup(capacity.stop)
        scheduler = ResourceScheduler(self.root / "scheduler")
        self.addCleanup(scheduler.close)
        with self.assertRaises(ResourceError):
            scheduler.configure({"vcpus": 1, "memoryMiB": 1, "maxParallelJobs": 1})
        self.assertEqual(scheduler.configure({"vcpus": 1, "memoryMiB": 1024, "maxParallelJobs": 1})["memoryMiB"], 1024)


if __name__ == "__main__":
    unittest.main()
