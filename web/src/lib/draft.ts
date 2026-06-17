const KEY = (sessionId: string | null | undefined) => `deck:draft:${sessionId ?? "new"}`;

export function loadDraft(sessionId: string | null | undefined): string {
  try {
    return localStorage.getItem(KEY(sessionId)) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(sessionId: string | null | undefined, text: string): void {
  try {
    if (text) localStorage.setItem(KEY(sessionId), text);
    else localStorage.removeItem(KEY(sessionId));
  } catch {
    /* ignore */
  }
}

export function clearDraft(sessionId: string | null | undefined): void {
  try {
    localStorage.removeItem(KEY(sessionId));
  } catch {
    /* ignore */
  }
}
