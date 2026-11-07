import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, sleepAbortable } from '../src';

function rateLimited(headers: Record<string, string>, status = 429): Response {
  return new Response('slow down', { status, headers });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchWithRetry', () => {
  it('waits retry-after, then returns the successful response', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(rateLimited({ 'retry-after': '2' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    const pending = fetchWithRetry('http://localhost/chat', { method: 'POST' });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;

    expect(response.status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('understands a duration in x-ratelimit-reset-tokens', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(rateLimited({ 'x-ratelimit-reset-tokens': '1500ms' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);

    const pending = fetchWithRetry('http://localhost/chat');
    await vi.advanceTimersByTimeAsync(1_499);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('does not retry a client error such as a bad model (404)', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetchStub);

    const response = await fetchWithRetry('http://localhost/chat');

    expect(response.status).toBe(404);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget and returns the last error', async () => {
    const fetchStub = vi.fn().mockImplementation(async () => rateLimited({ 'retry-after': '0' }));
    vi.stubGlobal('fetch', fetchStub);

    const pending = fetchWithRetry('http://localhost/chat', {}, { retries: 2 });
    await vi.runAllTimersAsync();
    const response = await pending;

    expect(response.status).toBe(429);
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('stops waiting when the job is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(rateLimited({ 'retry-after': '30' })),
    );
    const controller = new AbortController();

    const pending = fetchWithRetry(
      'http://localhost/chat',
      {},
      { retries: 8, signal: controller.signal },
    );
    // Let the first request land and enter the wait.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error('Stopped by you.'));

    await expect(pending).rejects.toThrow('Stopped by you.');
  });
});

describe('sleepAbortable', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(sleepAbortable(1_000, controller.signal)).rejects.toThrow('cancelled');
  });
});
