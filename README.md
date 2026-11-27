# AI Usage Monitor

A browser extension that shows the usage meters on your signed-in Cursor, ChatGPT, and Ollama accounts. It keeps a history of readings in your browser and shows when a check actually ran. No build step is required to load it.

## Install or update

**Chrome 148+:** Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**. Select the project folder containing `manifest.json`. If the extension is already installed from that folder, click **Reload** on its existing card rather than removing it or loading another copy. That preserves history and settings. Click the toolbar icon to open the dashboard.

**Firefox 121+:** At `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…** and select `manifest.firefox.json` from the project. This build is not signed, has not been verified in Firefox, and will not stay installed across browser restarts.

## How checks work

- Sign in to the providers in the profile running the extension. Click **Sync now** to confirm it can read the meters.
- Each check opens fresh, inactive tabs for the three usage pages and closes them when done. You do not need to leave the dashboard or provider pages open. Existing tabs are not reloaded or closed. If you select a temporary tab, it is left open for you.
- Hourly checks need an open regular browser window and a device that is awake. Alarms can run late, and they will not wake a sleeping machine. The extension checks that the alarm exists when its background worker starts and can catch up when the browser starts or becomes active again. See [Chrome's alarms documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms#concepts_and_usage).
- The toolbar shows `!` when the last check did not return all three readings. **Sync activity** separates the last check, the last completed hourly check, and export status. A check can run on time even if one provider needs attention.
- If a session expires or a provider shows a security check, choose **Open** on its card and complete the normal sign-in flow yourself. Then click **Sync now**. If a page changes or stops rendering its meters in the background, the extension keeps the previous reading and labels it as such. It does not substitute zero. Model route suggestions ignore readings after a failed check or when they are more than two hours old.

| Provider | Readings |
| --- | --- |
| Cursor | Plan, Cursor/Other model usage, weekly usage, and on-demand spend |
| ChatGPT | 5-hour and weekly limits that cover Codex, Work, Workspace Agents, and ChatGPT for Excel. These are not ordinary chat or OpenAI API usage. |
| Ollama | Cloud plan credits and weekly/session usage |

The services count different things. Monthly history is a series of snapshots, not an exact token total across subscriptions. Model route suggestions compare available headroom, not model quality.

## Data and relay

Snapshots, sync activity, and model routes stay in extension storage in this profile. The extension parses the visible usage page; it does not store raw page text, prompts, passwords, API keys, or cookies. An unrecognized-page diagnostic records character count and whether expected meter labels were found.

After saving each check locally, the extension tries to send a compact snapshot to the loopback relay at `http://127.0.0.1:8792/export`. If delivery fails, the snapshot stays in extension storage. Sync never opens a download dialog; JSON downloads only happen when you choose an export button. **The relay is a separate, optional installation.** When installed and configured, it keeps its local snapshot under `~/.local/share/ai-usage-monitor`, not in Downloads. It can publish the snapshot to Contabo and send a Telegram digest. Use **Export data** to back up the dashboard's history and routes.

Relay installer: `bash scripts/install_telegram_relay_mac.sh` on macOS or `bash scripts/install_telegram_relay_hp.sh` on the HP. Read the script and configure its destinations before enabling it.

## Test the extension

```sh
npm test
npm run check
python -B -m unittest discover -s tests -p test_usage_relay.py
```

For the Chrome smoke test, install Python Playwright in your development environment, then run:

```sh
python -m playwright install chromium
python tests/chrome-sync-smoke.py
```

The smoke test loads the actual MV3 worker in a fresh Chromium profile with three synthetic provider pages and an isolated relay. It checks that the alarm repeats hourly, accelerates its first firing in the test, closes the dashboard, and verifies storage and tab cleanup after that native alarm runs. It does not test live provider sessions or send data to the real relay.

See [design references and the roadmap](docs/roadmap.md) for the related open-source projects and what to build next.
