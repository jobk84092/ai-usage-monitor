# AI Usage Monitor (Chrome + Firefox)

A local browser extension with an HTML dashboard. Chrome 148+ uses `manifest.json`; Firefox 121+ uses the separate `manifest.firefox.json`. A plain `file://` page cannot safely read signed-in account pages; the extension is the browser bridge. The Firefox build is prepared, but its runtime has not been verified yet.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the extracted project folder containing `manifest.json`.
4. Click the AI Usage Monitor toolbar icon to open its dashboard. Pin the extension from Chrome’s puzzle-piece menu; right-click the dashboard tab and choose **Pin** if you want it kept at the left.
5. Sign in to Cursor, ChatGPT, and Ollama in **this same Chrome profile** (the one where the extension is loaded). Sign-ins in other profiles do not transfer.
6. Click **Sync now**. The extension keeps one background session tab per service so the browser session stays signed in. Do not close those tabs if you want hourly sync to keep working without re-auth. Connected or No data in range means the page was reached.

## Install in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…** and select `manifest.firefox.json` from the extracted project folder.
3. Open the AI Usage Monitor dashboard from the add-on entry, then sign in and sync in that Firefox profile.

Firefox’s temporary add-on installation is for testing and is removed when Firefox closes. **A persistent Firefox installation is not ready yet:** the extension needs Mozilla signing before it can be installed normally in the release browser. Chrome and Firefox keep separate local snapshots and each profile needs its own sign-ins.

## Cross-platform runtime

The extension uses the native `chrome` API in Chrome (including Chrome on macOS) and the native `browser` API in Firefox through one shared adapter. If you replace files in an unpacked install, click **Reload** for the extension in `chrome://extensions` before reopening the dashboard. Do not open `dashboard.html` as a `file://` page; it needs the extension runtime and its local storage.

## What it reads

The collector first reuses an already-open matching provider usage page in this browser profile, preserving its signed-in session. If none is open, it creates a temporary background tab, then closes only the tab it created. It parses displayed usage summaries only:

- Cursor plan/model/weekly meters and on-demand amount.
- ChatGPT’s 5-hour and weekly limits for Codex, Work, Workspace Agents, and ChatGPT for Excel. The Usage page explicitly excludes ordinary ChatGPT conversations.
- Ollama plan credits plus weekly/session meters.

Snapshots and model routes are stored locally in that browser profile. The extension does not save page text, prompts, model conversations, passwords, API keys, or request payloads. Permissions are limited to the three provider domains and the `storage`, `tabs`, `scripting`, and `alarms` browser APIs. No external server or analytics service is used.

## Reading the numbers

These services do not expose one comparable token meter: each account reports its own plan-specific limits and credits. The dashboard keeps each unit separate; it does not create exact cross-service subscription token totals. Monthly history is a timeline of snapshots, not a reconstructed calendar-month total. Model-route nudges use measured remaining percentages only and do not rank model quality.

Auto-sync runs hourly while Chrome is open. On browser startup, dashboard open, or Mac wake from idle, the extension repairs a missing hourly alarm and catches up if the last sync is overdue. Provider pages may take up to about 20 seconds to render during a sync. Sign-in cannot be automated past provider login screens; after you sign in once in this profile, session tabs are left open so later hourly syncs reuse that browser session. If a service shows Sign-in needed or a security check, use **Open**, finish the normal provider flow yourself, then **Sync now**. A failed-parse diagnostic includes only visible-character count and marker presence—not page text or usage values.

After each successful sync the extension posts a compact export to a local relay at `http://127.0.0.1:8792/export` (and falls back to `Downloads/ai-usage-monitor/latest.json`). The relay saves the file, copies it to Contabo for Telegram asks (`usage`), and sends a tidy hourly digest to Telegram on scheduled syncs.

Install the relay:

```bash
# Mac
bash scripts/install_telegram_relay_mac.sh

# HP Ubuntu
bash scripts/install_telegram_relay_hp.sh
```

On Contabo, Hermes answers Telegram **usage** / **AI usage** via `python3 /opt/agent-office/scripts/ai_usage/show_usage.py`. A Contabo cron can also run `scripts/ai_usage/hourly_notify.py` as a backup sender.

Use **Export data** to back up snapshots and model routes. Removing the extension or clearing its site data can delete locally stored readings. Run the included tests with `npm test` and syntax checks with `npm run check`.
