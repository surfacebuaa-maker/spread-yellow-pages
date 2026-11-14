import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("continuation", Path(__file__).resolve().parents[1] / "scripts/continue_monitoring.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class ContinuationTests(unittest.TestCase):
    def setUp(self):
        self.start = datetime(2026, 11, 14, 11, 0, tzinfo=timezone.utc)
        self.latest = {"sources": {"bitget": {"endAt": "2026-11-17T08:00:00Z"},
                                   "gate": {"endAt": "2026-11-17T09:00:00Z"}}}

    def test_interval_counts_from_run_start_without_adding_deployment_time(self):
        now = self.start + timedelta(seconds=45)
        self.assertEqual(c.next_dispatch_at(self.latest, self.start, now), self.start + timedelta(minutes=5))

    def test_slow_job_dispatches_immediately_instead_of_waiting_another_interval(self):
        now = self.start + timedelta(minutes=7)
        self.assertEqual(c.next_dispatch_at(self.latest, self.start, now), now)

    def test_no_continuation_past_subscription_window_and_buffer(self):
        now = datetime(2026, 11, 17, 11, 0, tzinfo=timezone.utc)
        self.assertIsNone(c.next_dispatch_at(self.latest, now, now))

    def test_missing_end_times_do_not_start_unbounded_continuation(self):
        self.assertIsNone(c.next_dispatch_at({"sources": {"bitget": {}}}, self.start, self.start))


if __name__ == "__main__":
    unittest.main()
