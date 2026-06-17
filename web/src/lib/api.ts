import type { Project, Session } from "./types";

/** Error carrying the HTTP status so callers can branch on it (e.g. 401 → login)
 *  instead of regex-matching the message. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async login(token: string): Promise<boolean> {
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "same-origin",
    });
    return res.status === 204;
  },
  async logout(): Promise<void> {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  },
  async projects(): Promise<Project[]> {
    return json(await fetch("/api/projects", { credentials: "same-origin" }));
  },
  async createProject(name: string): Promise<Project> {
    return json(
      await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
        credentials: "same-origin",
      }),
    );
  },
  async sessions(): Promise<Session[]> {
    return json(await fetch("/api/sessions", { credentials: "same-origin" }));
  },
  async session(id: string): Promise<Session> {
    return json(await fetch(`/api/sessions/${id}`, { credentials: "same-origin" }));
  },
  async createSession(
    project: string,
    opts: { model?: string; effort?: string; title?: string } = {},
  ): Promise<Session> {
    const { model, effort, title } = opts;
    return json(
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project,
          ...(title ? { title } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
        }),
        credentials: "same-origin",
      }),
    );
  },
  async setSessionTools(id: string, disabledTools: string[]): Promise<Session> {
    return json(
      await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabledTools }),
        credentials: "same-origin",
      }),
    );
  },
  async upload(sessionId: string, filename: string, dataBase64: string): Promise<{ path: string }> {
    return json(
      await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, filename, dataBase64 }),
        credentials: "same-origin",
      }),
    );
  },
};
