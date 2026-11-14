"""Collect public Anthropic IPO subscriptions; never includes the Bitget VIP pool."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
import sys
import time

from curl_cffi import requests

BITGET_URL = "https://www.bitget.com/spotlight/ipo-prime"
GATE_URL = "https://www.gate.com/ipos/ipo-access/anthropic-ipo-access/69"
GATE_API = "https://www.gate.com/apiw/v2/launch/ipos/project-detail?project_id=69&sub_website_id=0"
DATA_DIR = Path(__file__).resolve().parents[1] / "anthropic" / "data"


def iso(value=None):
    if value is None:
        value = datetime.now(timezone.utc)
    elif isinstance(value, (int, float, Decimal)):
        value = datetime.fromtimestamp(float(value), timezone.utc)
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def number(value):
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError("Missing or invalid subscription amount") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("Subscription amount must be finite and nonnegative")
    return float(result)


def count(value):
    result = number(value)
    if not result.is_integer():
        raise ValueError("Invalid participant count")
    return int(result)


def parse_bitget(html):
    match = re.search(r"window\.__ZEUS_REACT_QUERY_STATE__\s*=\s*(\{.*?\})\s*;?\s*</script>", html, re.S)
    if not match:
        raise ValueError("Bitget page structure changed: IPO statistics not found")
    state = json.loads(match[1])
    for query in state.get("queries", []):
        if query.get("queryKey", [])[:2] not in [["ipoPro", "currentList"], ["ipoPro", "historyList"]]:
            continue
        for project in query.get("state", {}).get("data", []) or []:
            if project.get("coinName", "").lower() != "rant" or project.get("coinFullName", "").lower() != "anthropic":
                continue
            # Only the public pool (type 1). VIP (type 2) is never persisted.
            pools = [p for p in project.get("poolList", []) if p.get("poolType") == 1]
            if len(pools) != 1:
                raise ValueError("Could not identify a unique Bitget public round")
            pool = pools[0]
            return {
                "amount": number(pool["totalInputAmount"]),
                "participants": count(pool["totalInputNum"]),
                "cap": number(pool["totalPurchaseLimit"]),
                "startAt": iso(int(pool["purchaseStartTime"]) / 1000),
                "endAt": iso(int(pool["purchaseEndTime"]) / 1000),
                "observedAt": iso(int(project["systemTimeStamp"]) / 1000),
                "sourceUrl": BITGET_URL,
                "label": "Bitget 公开轮",
            }
    raise ValueError("Anthropic public round not found in Bitget project data")


def parse_gate(payload):
    project = payload.get("data", {})
    if payload.get("code") != 200 or project.get("id") != 69 or project.get("coin") != "ANT":
        raise ValueError("Gate response did not identify Anthropic project 69")
    # Use project-wide totals, not a product cap, share allocation, or platform-wide total.
    return {
        "amount": number(project["total_raised_usd"]),
        "participants": count(project["total_mortgage_count"]),
        "cap": number(project.get("raise_limit", 0)) or None,
        "startAt": iso(int(project["start_time"])),
        "endAt": iso(int(project["end_time"])),
        "observedAt": iso(int(payload["timestamp"]) / 1000),
        "sourceUrl": GATE_URL,
        "label": "Gate IPO Access",
    }


def get(url):
    last_error = None
    for attempt in range(3):
        try:
            response = requests.get(url, impersonate="chrome", timeout=30, headers={
                "Accept-Language": "en-US,en;q=0.9", "Cache-Control": "no-cache",
            })
            response.raise_for_status()
            return response
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    raise last_error


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temp.replace(path)


def collect(data_dir=DATA_DIR):
    checked_at = iso()
    previous = read_json(data_dir / "latest.json", {"sources": {}})
    sources = copy.deepcopy(previous["sources"])
    sample = {"timestamp": checked_at, "bitget": None, "gate": None}
    errors = []
    for key, fetch in [
        ("bitget", lambda: parse_bitget(get(BITGET_URL).text)),
        ("gate", lambda: parse_gate(get(GATE_API).json())),
    ]:
        try:
            data = fetch()
            observed = datetime.fromisoformat(data["observedAt"].replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - observed).total_seconds()
            if age < -300 or age > 900:
                raise ValueError("Source timestamp is stale or invalid; retaining the last valid value")
            data.update({"fetchedAt": iso(), "lastAttemptAt": checked_at, "lastError": None})
            sources[key] = data
            sample[key] = {k: data[k] for k in ["amount", "participants", "observedAt", "cap"]}
            print(f"{key}: ${data['amount']:,.2f}; participants={data['participants']}")
        except Exception as exc:
            # Do not overwrite a valid amount with zero or advance its observation time.
            error = str(exc)[:300]
            errors.append(key)
            sources.setdefault(key, {"amount": None, "participants": None, "observedAt": None,
                                     "sourceUrl": BITGET_URL if key == "bitget" else GATE_URL,
                                     "label": "Bitget 公开轮" if key == "bitget" else "Gate IPO Access"})
            sources[key].update({"lastAttemptAt": checked_at, "lastError": error})
            print(f"::warning::{key}: {error}")
    history = read_json(data_dir / "history.json", {"schemaVersion": 1, "samples": []})
    if any(sample[key] is not None for key in ("bitget", "gate")):
        history["samples"] = [s for s in history["samples"] if s["timestamp"] != checked_at] + [sample]
        # Retain 90 days of 5-minute records at most, preserving the actual observations.
        history["samples"] = sorted(history["samples"], key=lambda s: s["timestamp"])[-25920:]
    latest = {"schemaVersion": 1, "generatedAt": checked_at, "intervalSeconds": 300,
              "currency": "USD", "scope": "public", "sources": sources}
    write_json(data_dir / "history.json", history)
    write_json(data_dir / "latest.json", latest)
    return errors


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()
    # Persist a partial result and failure status before failing the scheduled job.
    # The workflow publishes these diagnostics even when a source is unavailable.
    sys.exit(1 if collect(args.data_dir) else 0)
