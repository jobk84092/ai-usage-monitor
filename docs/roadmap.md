# Design references and roadmap

## What v1.4 adopts

| Open-source project | What we kept |
| --- | --- |
| [AI Usage Viewer](https://github.com/nickhilster/ai-usage-viewer) (MIT) | A fresh, inactive tab for every reading, even when the same usage page is already open. Selecting a temporary tab makes it yours. An absent 5-hour meter stays absent. |
| [AI Usage Tracker](https://github.com/cupcakedev/ai-usage-extension) (MIT) | A toolbar badge gives the dashboard a reason to be opened. Here the badge flags an incomplete check instead of putting account usage numbers on the toolbar. |
| [AI Limits](https://github.com/get-ai-limits/ai-limits) (MIT) | Their opt-in provider access and per-meter history are worth following. Their background session endpoints are a separate approach; v1.4 does not depend on undocumented endpoints or copy any upstream code. |

## Next, in order

1. **Prove it on the signed-in profiles.** With all three provider pages and the dashboard closed, observe a scheduled check in the Mac and HP profiles. Record build version, last alarm timestamp, and success status for each provider. Repeat after a browser restart. Do not record private quota values in bug reports.
2. **Make failures easier to fix.** Add a per-provider refresh control, opt-in permissions by provider, and an explicit export setting. Add sanitized parser fixtures for expired sessions, changed labels, delayed rendering, and unsupported layouts. Prefer provider-supported APIs where the correct subscription data is documented.
3. **Answer the everyday question: what should I use next?** Add separate graphs for each meter, preserve its reset window, and offer optional low-headroom alerts. Treat unavailable and old readings as unknown. Do not estimate cross-provider token totals.
4. **Prepare a public release.** Pick a license with the owner, document what leaves the browser, verify Firefox separately, and publish reproducible packages with a short changelog. Release only after the signed-in and automated checks pass; a public repository alone is not a license or a browser-store release.
