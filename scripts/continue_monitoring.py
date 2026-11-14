"""Continue the IPO monitor using explicit dispatch; cron remains a recovery trigger."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import time
import urllib.request

INTERVAL = timedelta(minutes=5)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def next_dispatch_at(latest, run_started_at, now):
    ends = []
    for source in latest.get("sources", {}).values():
        try:
            ends.append(parse_time(source["endAt"]))
        except (KeyError, TypeError, ValueError):
            pass
    if not ends:
        return None
    # This continuation is only for the current IPO window, including settlement buffer.
    stop_at = max(ends) + timedelta(hours=2)
    target = max(now, run_started_at + INTERVAL)
    return target if target < stop_at else None


def api(path, token, body=None):
    request = urllib.request.Request("https://api.github.com" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"},
        method="POST" if body is not None else "GET")
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read()
        return json.loads(data) if data else None


def main():
    repository = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["MONITOR_GITHUB_TOKEN"]
    run_id = os.environ["GITHUB_RUN_ID"]
    root = Path(__file__).resolve().parents[1]
    latest = json.loads((root / "anthropic/data/latest.json").read_text())
    run = api(f"/repos/{repository}/actions/runs/{run_id}", token)
    target = next_dispatch_at(latest, parse_time(run["run_started_at"]), datetime.now(timezone.utc))
    if target is None:
        print("IPO continuation window has ended; no further run dispatched.")
        return
    print("Next automatic collection dispatch: " + target.isoformat(), flush=True)
    while True:
        remaining = (target - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            break
        time.sleep(min(15, remaining))
    # workflow_dispatch is explicitly allowed to trigger a run with GITHUB_TOKEN.
    # Workflow concurrency keeps a single collector active, including cron/manual overlap.
    api(f"/repos/{repository}/actions/workflows/anthropic-monitor.yml/dispatches", token, {"ref": "main"})
    print("Next collection dispatched successfully.")


if __name__ == "__main__":
    main()
