const TOKEN_KEY = "alejandria.token";
const FLASH_KEY = "alejandria.flash";
export const SESSION_EXPIRED_EVENT = "alejandria:session-expired";

function storageAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

export function getToken(): string | null {
  if (!storageAvailable()) return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (!storageAvailable()) return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (!storageAvailable()) return;
  window.sessionStorage.removeItem(TOKEN_KEY);
}

export function setFlash(message: string): void {
  if (!storageAvailable()) return;
  window.sessionStorage.setItem(FLASH_KEY, message);
}

export function takeFlash(): string | null {
  if (!storageAvailable()) return null;
  try {
    const message = window.sessionStorage.getItem(FLASH_KEY);
    if (message) window.sessionStorage.removeItem(FLASH_KEY);
    return message;
  } catch {
    return null;
  }
}

export function notifySessionExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}
