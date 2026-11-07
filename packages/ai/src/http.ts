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

/** Gateway timeouts are worth waiting out; a 400 or 404 is not. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * How long the provider asked us to wait. Groq and friends send `retry-after`
 * in seconds (sometimes fractional); a few send the same value as a duration
 * in `x-ratelimit-reset-tokens` ("7.66s").
 */
function retryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null && retryAfter !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  const reset =
    response.headers.get('x-ratelimit-reset-tokens') ??
    response.headers.get('x-ratelimit-reset-requests');
  const match = reset === null ? null : /^([\d.]+)\s*(ms|s|m|h)?$/i.exec(reset.trim());
  if (match !== null) {
    const value = Number(match[1]);
    const unit = (match[2] ?? 's').toLowerCase();
    const scale = unit === 'ms' ? 1 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 1_000;
    if (Number.isFinite(value)) return Math.max(0, value * scale);
  }
  return null;
}

/** A sleep that a stopped job can interrupt. */
export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Send one request, waiting out rate limits and transient gateway errors
 * instead of failing. Hosted free tiers allow only a few vision pages per
 * minute, so an OCR read must pause rather than dump the page to the much
 * worse built-in OCR. Returns the final response even when it is an error.
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  options: { retries?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const retries = options.retries ?? 4;
  const signal = options.signal ?? init.signal ?? undefined;
  let response: Response;
  for (let attempt = 0; ; attempt += 1) {
    response = await getFetch()(input, init);
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) return response;
    const waitMs = Math.min(60_000, retryAfterMs(response) ?? 2_000 * 2 ** attempt);
    // Release the connection before sleeping; the body of an error is short
    // but the socket should not stay open while we wait.
    await response.body?.cancel().catch(() => undefined);
    await sleepAbortable(waitMs, signal);
  }
}
