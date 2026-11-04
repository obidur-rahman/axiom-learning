/**
 * Tauri bridge helpers. Everything here degrades gracefully in a plain
 * browser tab so `next build` and Storybook-style previews keep working.
 */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

async function getInvoke(): Promise<InvokeFn | null> {
  if (!isDesktopRuntime()) return null;
  const core = await import('@tauri-apps/api/core');
  return core.invoke as InvokeFn;
}

/** OS secure store (SEC-10): service "axiom-learning", account = course id or 'default'. */
export const KEYRING_SERVICE = 'axiom-learning';

/** Returns the stored secret or null when missing (missing is not an error). */
export async function getSecret(account: string): Promise<string | null> {
  const invoke = await getInvoke();
  if (invoke === null) {
    return localStorage.getItem(`keyring:${KEYRING_SERVICE}:${account}`);
  }
  try {
    const value = await invoke('get_secret', { service: KEYRING_SERVICE, account });
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null; // entry not found
  }
}

export async function setSecret(account: string, secret: string): Promise<void> {
  const invoke = await getInvoke();
  if (invoke === null) {
    localStorage.setItem(`keyring:${KEYRING_SERVICE}:${account}`, secret);
    return;
  }
  try {
    await invoke('delete_secret', { service: KEYRING_SERVICE, account });
  } catch {
    // first save: nothing to delete
  }
  await invoke('set_secret', { service: KEYRING_SERVICE, account, password: secret });
}

export async function deleteSecret(account: string): Promise<void> {
  const invoke = await getInvoke();
  if (invoke === null) {
    localStorage.removeItem(`keyring:${KEYRING_SERVICE}:${account}`);
    return;
  }
  try {
    await invoke('delete_secret', { service: KEYRING_SERVICE, account });
  } catch {
    // already gone
  }
}

export async function isDbReady(): Promise<boolean> {
  const invoke = await getInvoke();
  return invoke !== null;
}
