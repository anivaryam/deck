import type { Cron, Goal, GoalDetail, Project, Session, Ticket, TaskDetail } from "./types";

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
  async deleteSession(id: string): Promise<void> {
    const res = await fetch(`/api/sessions/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
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

  // ---- tasks ----
  async tasks(): Promise<Session[]> {
    return json(await fetch("/api/tasks", { credentials: "same-origin" }));
  },
  async task(id: string): Promise<TaskDetail> {
    return json(await fetch(`/api/tasks/${id}`, { credentials: "same-origin" }));
  },
  async createTask(body: {
    project: string;
    prompt: string;
    model?: string;
    effort?: string;
  }): Promise<{ id: string }> {
    return json(
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },
  async cancelTask(id: string): Promise<{ aborted: boolean }> {
    return json(
      await fetch(`/api/tasks/${id}/cancel`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },
  async deleteTask(id: string): Promise<void> {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
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
  },

  // ---- runs ----
  async runs(sourceKind: "cron" | "ticket", sourceId: string): Promise<Session[]> {
    const q = new URLSearchParams({ source_kind: sourceKind, source_id: sourceId });
    return json(await fetch(`/api/runs?${q}`, { credentials: "same-origin" }));
  },

  // ---- cron ----
  async listCron(): Promise<Cron[]> {
    return json(await fetch("/api/cron", { credentials: "same-origin" }));
  },
  async createCron(body: {
    schedule: string;
    project: string;
    prompt: string;
  }): Promise<Cron> {
    return json(
      await fetch("/api/cron", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },
  async updateCron(
    id: string,
    patch: { enabled?: boolean; schedule?: string; prompt?: string },
  ): Promise<Cron> {
    return json(
      await fetch(`/api/cron/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        credentials: "same-origin",
      }),
    );
  },
  async runCron(id: string): Promise<{ session_id: string }> {
    return json(
      await fetch(`/api/cron/${id}/run`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },
  async deleteCron(id: string): Promise<void> {
    const res = await fetch(`/api/cron/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
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
  },

  // ---- tickets (no GET :id route — detail comes from the list) ----
  async tickets(): Promise<Ticket[]> {
    return json(await fetch("/api/tickets", { credentials: "same-origin" }));
  },
  async createTicket(body: {
    project: string;
    title: string;
    body?: string;
  }): Promise<Ticket> {
    return json(
      await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },
  async updateTicket(
    id: string,
    patch: { status?: string; pr_url?: string; title?: string; body?: string },
  ): Promise<Ticket> {
    return json(
      await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
        credentials: "same-origin",
      }),
    );
  },
  async runTicket(id: string): Promise<{ session_id: string }> {
    return json(
      await fetch(`/api/tickets/${id}/run`, {
        method: "POST",
        credentials: "same-origin",
      }),
    );
  },
  async deleteTicket(id: string): Promise<void> {
    const res = await fetch(`/api/tickets/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
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
  },

  // ---- goals ----
  async goals(): Promise<Goal[]> {
    return json(await fetch("/api/goals", { credentials: "same-origin" }));
  },
  async goal(id: string): Promise<GoalDetail> {
    return json(await fetch(`/api/goals/${id}`, { credentials: "same-origin" }));
  },
  async createGoal(body: { project: string; title: string; expected_output: string; acceptance?: string; max_iterations?: number; qa_dimensions?: string[] }): Promise<Goal> {
    return json(
      await fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      }),
    );
  },
  async runGoal(id: string): Promise<Goal> {
    return json(await fetch(`/api/goals/${id}/run`, { method: "POST", credentials: "same-origin" }));
  },
  async cancelGoal(id: string): Promise<{ cancelled: boolean }> {
    return json(await fetch(`/api/goals/${id}/cancel`, { method: "POST", credentials: "same-origin" }));
  },
  async deleteGoal(id: string): Promise<void> {
    const res = await fetch(`/api/goals/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
  },
};
