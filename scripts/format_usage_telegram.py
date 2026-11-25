#!/usr/bin/env python3
"""Format AI Usage Monitor export JSON into a tidy Telegram message."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

EAT = ZoneInfo("Africa/Nairobi")
LABELS = {"cursor": "Cursor", "chatgpt": "ChatGPT tools", "ollama": "Ollama"}


def _pct(value: Any) -> str | None:
    try:
        if value is None:
            return None
        num = float(value)
    except (TypeError, ValueError):
        return None
    text = f"{num:.1f}".rstrip("0").rstrip(".")
    return f"{text}%"


def _money(value: Any) -> str | None:
    try:
        if value is None:
            return None
        return f"${float(value):.2f}"
    except (TypeError, ValueError):
        return None


def _stamp(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(EAT)
    except ValueError:
        return None
    return dt.strftime("%-d %b %H:%M")


def _latest_by_provider(snapshots: list[dict]) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for snap in snapshots or []:
        provider = snap.get("provider")
        if not provider:
            continue
        prev = latest.get(provider)
        if not prev or str(snap.get("capturedAt") or "") > str(prev.get("capturedAt") or ""):
            latest[provider] = snap
    return latest


def _cursor_line(snap: dict) -> str:
    m = snap.get("metrics") or {}
    parts = [
        f"models {_pct(m.get('cursorModelsUsedPercent'))} used" if _pct(m.get("cursorModelsUsedPercent")) else None,
        f"other {_pct(m.get('otherModelsUsedPercent'))} used" if _pct(m.get("otherModelsUsedPercent")) else None,
        f"week {_pct(m.get('weeklyUsedPercent'))} used" if _pct(m.get("weeklyUsedPercent")) else None,
    ]
    spent, limit = _money(m.get("onDemandSpent")), _money(m.get("onDemandLimit"))
    if spent and limit:
        parts.append(f"on-demand {spent} / {limit}")
    return " · ".join(p for p in parts if p) or "no meters"


def _chatgpt_line(snap: dict) -> str:
    m = snap.get("metrics") or {}
    parts = [
        f"5h {_pct(m.get('fiveHourRemainingPercent'))} left" if _pct(m.get("fiveHourRemainingPercent")) else None,
        f"week {_pct(m.get('weeklyRemainingPercent'))} left" if _pct(m.get("weeklyRemainingPercent")) else None,
    ]
    return " · ".join(p for p in parts if p) or "no meters"


def _ollama_line(snap: dict) -> str:
    m = snap.get("metrics") or {}
    parts = [
        f"credits {_money(m.get('usageCredits'))}" if _money(m.get("usageCredits")) else None,
        f"week {_pct(m.get('weeklyUsedPercent'))} used" if _pct(m.get("weeklyUsedPercent")) else None,
        f"session {_pct(m.get('sessionUsedPercent'))} used" if _pct(m.get("sessionUsedPercent")) else None,
    ]
    return " · ".join(p for p in parts if p) or "no meters"


def _line_for(provider: str, snap: dict) -> str:
    if provider == "cursor":
        return _cursor_line(snap)
    if provider == "chatgpt":
        return _chatgpt_line(snap)
    if provider == "ollama":
        return _ollama_line(snap)
    return "no meters"


def _status_note(status: dict | None) -> str:
    state = (status or {}).get("status")
    if not state or state == "ok":
        return ""
    return {
        "no_data": "no numeric data in range",
        "auth_required": "sign-in needed",
        "blocked": "security check",
        "unavailable": "not reachable",
        "unrecognized": "page not recognized",
    }.get(state, state)


def format_telegram_summary(payload: dict) -> str:
    latest = payload.get("latest") or _latest_by_provider(payload.get("snapshots") or [])
    source_status = payload.get("sourceStatus") or {}
    when = _stamp(payload.get("lastSyncAt") or payload.get("exportedAt")) or "unknown time"
    host = f" · {payload['host']}" if payload.get("host") else ""
    trigger = f" · {payload['lastSyncTrigger']}" if payload.get("lastSyncTrigger") else ""

    lines = [f"AI usage · {when}{host}"]
    for provider in ("cursor", "chatgpt", "ollama"):
        snap = latest.get(provider)
        note = _status_note(source_status.get(provider))
        plan = f" · {snap['plan']}" if snap and snap.get("plan") else ""
        lines.append("")
        lines.append(f"{LABELS[provider]}{plan}")
        if snap:
            lines.append(f"· {_line_for(provider, snap)}")
            if note and (source_status.get(provider) or {}).get("status") not in (None, "ok"):
                lines.append(f"· {note}")
        else:
            lines.append(f"· {note or 'no reading yet'}")
    lines.append("")
    lines.append(f"Sync{trigger}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", help="Path to latest.json (default: stdin)")
    args = parser.parse_args(argv)
    if args.path:
        payload = json.loads(Path(args.path).read_text(encoding="utf-8"))
    else:
        payload = json.load(sys.stdin)
    sys.stdout.write(format_telegram_summary(payload) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
