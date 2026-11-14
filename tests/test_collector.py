import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("collector", Path(__file__).resolve().parents[1] / "scripts/collect_anthropic.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def bitget_page(amount=120, observed=None):
    stamp = int(__import__('time').time() * 1000) if observed is None else observed
    pool = {"poolType": 1, "totalInputAmount": amount, "totalInputNum": 4,
            "totalPurchaseLimit": 200000000, "purchaseStartTime": "1794297600000",
            "purchaseEndTime": "1794902400000"}
    project = {"coinName": "rANT", "coinFullName": "Anthropic", "systemTimeStamp": str(stamp),
               "poolList": [{**pool, "poolType": 2, "totalInputAmount": 99999999}, pool]}
    return '<script>window.__ZEUS_REACT_QUERY_STATE__ = ' + json.dumps({"queries": [
        {"queryKey": ["ipoPro", "currentList", "en"], "state": {"data": [project]}}]}) + '</script>'


def gate_payload(amount="25087583.10"):
    return {"code": 200, "timestamp": int(__import__('time').time() * 1000), "data": {
        "id": 69, "coin": "ANT", "total_raised_usd": amount, "total_mortgage_count": 2045,
        "raise_limit": "0", "start_time": 1794452400, "end_time": 1794906000}}


class CollectorTests(unittest.TestCase):
    def test_only_bitget_public_round_is_saved(self):
        data = c.parse_bitget(bitget_page())
        self.assertEqual(data["amount"], 120)
        self.assertEqual(data["cap"], 200000000)
        self.assertNotIn("poolList", data)
        self.assertNotIn("99999999", json.dumps(data))

    def test_gate_unknown_cap_is_not_zero_capacity(self):
        data = c.parse_gate(gate_payload())
        self.assertIsNone(data["cap"])
        self.assertEqual(data["amount"], 25087583.10)
        self.assertEqual(data["participants"], 2045)

    def test_wrong_project_and_invalid_amount_are_rejected(self):
        payload = gate_payload()
        payload["data"]["id"] = 68
        with self.assertRaises(ValueError): c.parse_gate(payload)
        for bad in ["NaN", "Infinity", "-1", None]:
            with self.assertRaises(ValueError): c.number(bad)
        with self.assertRaises(ValueError): c.parse_bitget('<html>no statistics</html>')

    def test_failure_retains_last_value_and_history_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            old = {"amount": 500, "participants": 6, "observedAt": "2026-11-13T01:00:00Z", "cap": None}
            c.write_json(path / "latest.json", {"sources": {"gate": old}})
            def fetch(url):
                if url == c.GATE_API: raise RuntimeError("source unavailable")
                return Mock(text=bitget_page())
            with patch.object(c, "get", side_effect=fetch): self.assertEqual(c.collect(path), ["gate"])
            latest = c.read_json(path / "latest.json", {})
            self.assertEqual(latest["sources"]["gate"]["amount"], 500)
            self.assertEqual(latest["sources"]["gate"]["observedAt"], old["observedAt"])
            self.assertEqual(latest["sources"]["gate"]["lastError"], "source unavailable")
            sample = c.read_json(path / "history.json", {})["samples"][0]
            self.assertIsNone(sample["gate"])
            self.assertEqual(sample["bitget"]["cap"], 200000000)

    def test_stale_source_does_not_advance_observation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            previous = {"amount": 321, "observedAt": "2026-11-14T01:00:00Z"}
            c.write_json(path / "latest.json", {"sources": {"bitget": previous}})
            with patch.object(c, "get", return_value=Mock(text=bitget_page(observed=1000), json=lambda: gate_payload())):
                self.assertEqual(c.collect(path), ["bitget"])
            saved = c.read_json(path / "latest.json", {})["sources"]["bitget"]
            self.assertEqual(saved["amount"], 321)
            self.assertEqual(saved["observedAt"], previous["observedAt"])
            self.assertIsNone(c.read_json(path / "history.json", {})["samples"][0]["bitget"])


if __name__ == '__main__':
    unittest.main()
