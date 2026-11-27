"""Run the real MV3 worker/alarm in Chromium against local synthetic pages.

Requires Python Playwright: python -m playwright install chromium.
The test uses an isolated profile and a fixture-only relay, never live accounts.
"""
import json
import re
import shutil
import sys
import threading
import time
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
ALARM = 'ai-usage-hourly-sync'
PAGES = {
    '/dashboard/spending': 'CURRENT PLAN\nPro\nCursor Models\n{value}% used',
    '/settings/usage': 'Usage\n5-hour limit\n{value}% left\nWeekly limit\n89% left',
    '/dashboard': 'Usage credits\n$10\nWeekly usage\n{value}% used',
}
fixture = {'value': 25, 'signed_in': True, 'paths': set()}


class FixtureServer(BaseHTTPRequestHandler):
    def reply(self, body, mime, code=200):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in PAGES:
            return self.reply(b'', 'text/plain', 404)
        fixture['paths'].add(path)
        text = 'Log in\nContinue with email' if path == '/settings/usage' and not fixture['signed_in'] else PAGES[path].format(value=fixture['value'])
        self.reply(f'<html><body><pre>{escape(text)}</pre></body></html>'.encode(), 'text/html')

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.reply(b'{}', 'application/json', 200 if self.path == '/export' else 404)

    def log_message(self, format, *args):
        pass


def fixture_build(build, origin):
    for folder in ('src', 'chrome-extension'):
        shutil.copytree(ROOT / folder, build / folder)
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    manifest['host_permissions'] = ['http://127.0.0.1/*']
    (build / 'manifest.json').write_text(json.dumps(manifest))
    worker = build / 'chrome-extension/service-worker.js'
    worker.write_text(re.sub(r'https://(?:cursor\.com|chatgpt\.com|ollama\.com)(?=/)', origin, worker.read_text()))
    relay = build / 'src/export-latest.mjs'
    relay.write_text(relay.read_text().replace('http://127.0.0.1:8792', origin))


with ThreadingHTTPServer(('127.0.0.1', 0), FixtureServer) as server, TemporaryDirectory(prefix='usage-e2e-') as tmp, sync_playwright() as p:
    origin = f'http://127.0.0.1:{server.server_port}'
    build = Path(tmp) / 'extension'
    fixture_build(build, origin)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    context = p.chromium.launch_persistent_context(str(Path(tmp) / 'profile'), channel='chromium', headless=True,
        args=[f'--disable-extensions-except={build}', f'--load-extension={build}', '--disable-background-networking'])
    try:
        worker = next((w for w in context.service_workers if w.url.endswith('/service-worker.js')), None)
        if not worker:
            worker = context.wait_for_event('serviceworker', timeout=15000)
        base = worker.url.rsplit('/chrome-extension/', 1)[0]
        page = context.pages[0]
        page.goto(f'{base}/chrome-extension/dashboard.html')

        def wait_for_state(predicate, attempts=120):
            data = {}
            for _ in range(attempts):
                data = page.evaluate('chrome.storage.local.get(["snapshots", "sourceStatus", "lastAlarmAt", "lastSyncAt", "lastSyncTrigger", "recentChecks", "syncing"])')
                if predicate(data):
                    return data
                page.wait_for_timeout(250)
            raise AssertionError(data)

        def provider_tabs():
            return page.evaluate('async urls => (await chrome.tabs.query({})).filter(t => urls.includes(t.url)).map(t => t.url)', [origin + path for path in PAGES])

        initial = wait_for_state(lambda s: s.get('lastSyncAt') and not s.get('syncing'))
        assert len(initial['snapshots']) == 3, initial
        assert fixture['paths'] == set(PAGES), fixture
        assert provider_tabs() == [], 'Initial check left provider tabs open'
        alarm = page.evaluate('name => chrome.alarms.get(name)', ALARM)
        assert alarm and alarm['periodInMinutes'] == 60, alarm
        print('Initial check captured three readings with no persistent provider tabs.', flush=True)

        existing = context.new_page()
        existing.goto(origin + '/dashboard/spending')
        fixture.update(value=47, signed_in=False, paths=set())
        page.evaluate('name => chrome.alarms.create(name, {delayInMinutes: 0.65, periodInMinutes: 60})', ALARM)
        page.close()  # Do not wake the worker via the dashboard during this test.
        deadline = time.monotonic() + 65
        while fixture['paths'] != set(PAGES) and time.monotonic() < deadline:
            time.sleep(0.2)
        assert fixture['paths'] == set(PAGES), f'No alarm checks with dashboard closed: {fixture}'
        time.sleep(4)
        page = context.new_page()
        page.goto(f'{base}/chrome-extension/dashboard.html')
        updated = wait_for_state(lambda s: s.get('lastAlarmAt') and s.get('lastSyncTrigger') == 'hourly' and not s.get('syncing'))
        assert updated['lastSyncAt'] > initial['lastSyncAt'], updated
        assert updated['sourceStatus']['chatgpt']['status'] == 'auth_required', updated
        assert len(updated['snapshots']) == 5, updated
        assert updated['snapshots'][-2]['metrics']['cursorModelsUsedPercent'] == 47, updated
        assert updated['recentChecks'][0]['readings'] == 2
        assert provider_tabs() == [origin + '/dashboard/spending']
        assert '25% used' in existing.locator('pre').inner_text(), 'User tab was reloaded or navigated'
        assert '2/3 fresh readings' in page.locator('#syncStatus').inner_text()
        print('Native alarm ran with dashboard closed, read fresh data, kept the last ChatGPT reading, and left the user tab alone.', flush=True)

        page.locator('#autoSync').uncheck()
        for _ in range(40):
            if not page.evaluate('name => chrome.alarms.get(name)', ALARM):
                break
            page.wait_for_timeout(250)
        else:
            raise AssertionError('Pausing auto-sync did not cancel the native alarm')
        print('Pausing auto-sync canceled the native alarm.', flush=True)
    finally:
        context.close()
        server.shutdown()
