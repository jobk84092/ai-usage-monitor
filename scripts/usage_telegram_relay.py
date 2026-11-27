#!/usr/bin/env python3
"""Local relay: extension POSTs here → save JSON → Contabo + optional Telegram.

Listens on 127.0.0.1:8792. Safe for Chrome host_permissions to localhost only.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORMATTER = ROOT / "scripts" / "format_usage_telegram.py"
DEFAULT_DIR = Path.home() / ".local" / "share" / "ai-usage-monitor"
DEFAULT_PORT = 8792
STATE_NAME = "relay-state.json"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_state(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def format_message(payload: dict) -> str:
    proc = subprocess.run(
        [sys.executable, str(FORMATTER)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "formatter failed")
    return proc.stdout.strip()


def notify_telegram(message: str) -> None:
    env = os.environ.copy()
    candidates = [
        Path.home() / "Projects" / "agent-office" / "scripts" / "notify_phone.sh",
        Path("/opt/agent-office/scripts/notify_phone.sh"),
    ]
    for script in candidates:
        if script.is_file() and os.access(script, os.X_OK):
            subprocess.run(["bash", str(script), message], check=False, env=env)
            return
    # Contabo / local hermes fallback
    try:
        subprocess.run(
            ["hermes", "send", "--to", "telegram", "-q", "--", message],
            check=False,
            env={**env, "PATH": f"{Path.home() / '.local' / 'bin'}:{env.get('PATH', '')}"},
        )
        return
    except FileNotFoundError:
        pass
    subprocess.run(
        [
            "ssh",
            "-o",
            "ConnectTimeout=12",
            "-o",
            "BatchMode=yes",
            "contabo",
            f"export PATH=\"$HOME/.local/bin:$PATH\"; hermes send --to telegram -q -- {json.dumps(message)}",
        ],
        check=False,
    )


def publish_to_contabo(local_json: Path) -> None:
    remote = "/opt/agent-office/data/ai-usage/latest.json"
    mkdir = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=12", "-o", "BatchMode=yes", "contabo",
         "mkdir -p /opt/agent-office/data/ai-usage"],
        capture_output=True, text=True, check=False,
    )
    if mkdir.returncode != 0:
        sys.stderr.write(f"contabo mkdir failed: {mkdir.stderr or mkdir.stdout}\n")
    scp = subprocess.run(
        ["scp", "-o", "ConnectTimeout=12", "-o", "BatchMode=yes",
         str(local_json), f"contabo:{remote}"],
        capture_output=True, text=True, check=False,
    )
    if scp.returncode != 0:
        # Fallback: pipe through ssh cat
        piped = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=12", "-o", "BatchMode=yes", "contabo",
             f"cat > {remote}"],
            input=local_json.read_bytes(),
            capture_output=True, check=False,
        )
        if piped.returncode != 0:
            sys.stderr.write(f"contabo publish failed: {scp.stderr or piped.stderr}\n")


def should_notify(payload: dict, state: dict, force: bool) -> bool:
    if force:
        return True
    trigger = str(payload.get("lastSyncTrigger") or "")
    if trigger not in {"hourly", "wake", "startup", "recovery", "install"}:
        # manual sync still publishes file; Telegram only on scheduled triggers
        return False
    sync_key = str(payload.get("lastSyncAt") or payload.get("exportedAt") or "")
    return bool(sync_key) and sync_key != state.get("lastNotifiedSyncAt")


def handle_payload(payload: dict, data_dir: Path, force_notify: bool = False) -> dict:
    data_dir.mkdir(parents=True, exist_ok=True)
    latest = data_dir / "latest.json"
    state_path = data_dir / STATE_NAME
    state = _load_state(state_path)
    latest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    publish_to_contabo(latest)
    notified = False
    if should_notify(payload, state, force_notify):
        message = format_message(payload)
        notify_telegram(message)
        state["lastNotifiedSyncAt"] = payload.get("lastSyncAt") or payload.get("exportedAt")
        state["lastNotifiedAt"] = _now()
        notified = True
    state["lastReceivedAt"] = _now()
    state["lastSyncAt"] = payload.get("lastSyncAt")
    state["lastSyncTrigger"] = payload.get("lastSyncTrigger")
    _save_state(state_path, state)
    return {"ok": True, "saved": str(latest), "notified": notified}


class Handler(BaseHTTPRequestHandler):
    data_dir = DEFAULT_DIR

    def log_message(self, fmt: str, *args) -> None:  # quieter
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in {"", "/health"}:
            self._send(200, {"ok": True, "service": "ai-usage-telegram-relay"})
            return
        if self.path.rstrip("/") == "/latest":
            path = self.data_dir / "latest.json"
            if not path.exists():
                self._send(404, {"ok": False, "error": "no latest.json yet"})
                return
            self._send(200, json.loads(path.read_text(encoding="utf-8")))
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/export":
            self._send(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send(400, {"ok": False, "error": "invalid json"})
            return
        try:
            result = handle_payload(payload, self.data_dir)
            self._send(200, result)
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"ok": False, "error": str(exc)})


def serve(port: int, data_dir: Path) -> None:
    Handler.data_dir = data_dir
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"ai-usage telegram relay on http://127.0.0.1:{port}/export → {data_dir}", flush=True)
    server.serve_forever()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["serve", "publish", "show"], help="serve | publish FILE | show [FILE]")
    parser.add_argument("path", nargs="?", help="latest.json for publish/show")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--notify", action="store_true", help="force Telegram on publish")
    args = parser.parse_args(argv)

    if args.command == "serve":
        serve(args.port, args.data_dir)
        return 0

    path = Path(args.path) if args.path else args.data_dir / "latest.json"
    if args.command == "show":
        payload = json.loads(path.read_text(encoding="utf-8"))
        print(format_message(payload))
        return 0

    payload = json.loads(path.read_text(encoding="utf-8"))
    result = handle_payload(payload, args.data_dir, force_notify=args.notify)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
