// Browser-tab identity shared by session transport and API clients.
// Keep the same ID across reloads to preserve Owner sessions.

const storageKey = 'lumicos_device_id';

function getBrowserClientId(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const stored = window.sessionStorage.getItem(storageKey);

  if (stored) {
    return stored;
  }

  const newId = window.crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, newId);

  return newId;
}

export const clientId = getBrowserClientId();
