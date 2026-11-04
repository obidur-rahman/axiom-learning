/**
 * One optional HTTP transport for the whole AI package. The browser build
 * uses the webview's fetch; the desktop app installs Tauri's HTTP client so
 * requests to local model servers are not blocked by browser CORS rules.
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let implementation: FetchLike | null = null;

export function setFetchImplementation(next: FetchLike | null): void {
  implementation = next;
}

/** Resolve the transport at call time, so test stubs of global fetch work. */
export function getFetch(): FetchLike {
  if (implementation !== null) return implementation;
  return (input, init) => globalThis.fetch(input, init);
}
