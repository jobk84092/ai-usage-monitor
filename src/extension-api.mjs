/**
 * Return the browser API exposed by the current extension runtime.
 *
 * Firefox exposes the WebExtensions namespace as `browser`, while Chrome
 * exposes the same APIs as `chrome`. Chrome's MV3 APIs are Promise-capable for
 * the minimum version declared by this extension, so the rest of the code can
 * use one async interface on both browsers and on both operating systems.
 */
export function getExtensionApi(scope = globalThis) {
  const api = scope?.browser ?? scope?.chrome;
  if (!api) throw new Error('WebExtension API is unavailable outside an extension runtime.');
  return api;
}
