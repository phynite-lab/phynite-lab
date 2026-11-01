"""Run the OVITO trajectory analysis kernel inside personal compute.

All network transfer is performed by the outer worker. This process only reads
the verified source mounted in /work and writes immutable result artifacts.
"""
from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from backend.md_local.analysis_engine import analyze_trajectory, utc_now, validate_job, write_json


WORK = Path(os.environ.get("PHYNITE_WORK_DIR", "/work")).resolve()
INPUT = WORK / "input.json"
RESULTS = WORK / "results"


def run() -> None:
    payload = json.loads(INPUT.read_text(encoding="utf-8"))
    analysis_id = str(payload.get("analysisId") or "")
    source = payload.get("source") if isinstance(payload, dict) else None
    source_key = source.get("objectKey") if isinstance(source, dict) else None
    payload = validate_job(payload, analysis_id, source_key)
    local_source = Path(str(payload.get("localSourcePath") or ""))
    if local_source.is_absolute() or ".." in local_source.parts or not local_source.parts:
        raise ValueError("Analysis source path is unsafe")
    source_path = WORK / local_source
    if not source_path.is_file():
        raise ValueError("Analysis source is missing")

    shutil.rmtree(RESULTS, ignore_errors=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    result = analyze_trajectory(source_path, payload, output=RESULTS)
    result.update({
        "calculationId": analysis_id,
        "kind": "md-analysis",
        "startedAt": utc_now(),
        "completedAt": utc_now(),
        "elapsedSeconds": round(time.monotonic() - started, 3),
    })
    write_json(RESULTS / "result.json", result)


def main() -> int:
    try:
        run()
        return 0
    except Exception as exc:
        RESULTS.mkdir(parents=True, exist_ok=True)
        analysis_id = os.environ.get("PHYNITE_CALCULATION_ID", "unknown")
        try:
            payload = json.loads(INPUT.read_text(encoding="utf-8"))
            analysis_id = str(payload.get("analysisId") or payload.get("calculationId") or analysis_id)
        except Exception:
            pass
        write_json(RESULTS / "result.json", {
            "version": 1,
            "calculationId": analysis_id,
            "analysisId": analysis_id,
            "kind": "md-analysis",
            "status": "failed",
            "completedAt": utc_now(),
            "error": str(exc)[:1500],
            "artifacts": [],
            "syntheticData": False,
        })
        print(str(exc), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
