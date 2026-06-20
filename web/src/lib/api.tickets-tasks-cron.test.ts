import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "./api";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("automation api methods", () => {
  it("tickets() GETs /api/tickets with cookies", async () => {
    const f = mockFetch(200, [{ id: "t1", title: "x" }]);
    vi.stubGlobal("fetch", f);
    const out = await api.tickets();
    expect(f).toHaveBeenCalledWith("/api/tickets", { credentials: "same-origin" });
    expect(out).toEqual([{ id: "t1", title: "x" }]);
  });

  it("createTicket() POSTs title/body/project as JSON", async () => {
    const f = mockFetch(200, { id: "t2" });
    vi.stubGlobal("fetch", f);
    await api.createTicket({ project: "deck", title: "Fix", body: "do it" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/tickets");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ project: "deck", title: "Fix", body: "do it" });
  });

  it("runTicket() POSTs to the run subroute", async () => {
    const f = mockFetch(200, { session_id: "s1" });
    vi.stubGlobal("fetch", f);
    const out = await api.runTicket("t1");
    expect(f.mock.calls[0][0]).toBe("/api/tickets/t1/run");
    expect(out).toEqual({ session_id: "s1" });
  });

  it("createCron() surfaces backend validation error as ApiError", async () => {
    const f = mockFetch(400, { error: "invalid cron expression" });
    vi.stubGlobal("fetch", f);
    await expect(
      api.createCron({ schedule: "nope", project: "deck", prompt: "x" }),
    ).rejects.toMatchObject({ status: 400, message: "invalid cron expression" } as ApiError);
  });

  it("updateCron() PATCHes the given patch object", async () => {
    const f = mockFetch(200, { id: "c1", enabled: 0 });
    vi.stubGlobal("fetch", f);
    await api.updateCron("c1", { enabled: false });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/cron/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });

  it("updateCron() can PATCH schedule + prompt", async () => {
    const f = mockFetch(200, { id: "c1" });
    vi.stubGlobal("fetch", f);
    await api.updateCron("c1", { schedule: "0 4 * * *", prompt: "p" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ schedule: "0 4 * * *", prompt: "p" });
  });

  it("deleteTask() DELETEs and tolerates 204", async () => {
    const f = mockFetch(204, undefined);
    vi.stubGlobal("fetch", f);
    await api.deleteTask("task1");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/tasks/task1");
    expect(init.method).toBe("DELETE");
  });

  it("deleteTask() surfaces a 409 as ApiError", async () => {
    const f = mockFetch(409, { error: "cancel the task before deleting it" });
    vi.stubGlobal("fetch", f);
    await expect(api.deleteTask("task1")).rejects.toMatchObject({ status: 409 });
  });

  it("cancelTask() POSTs to the cancel subroute and returns {aborted}", async () => {
    const f = mockFetch(200, { aborted: true });
    vi.stubGlobal("fetch", f);
    const out = await api.cancelTask("task1");
    expect(f.mock.calls[0][0]).toBe("/api/tasks/task1/cancel");
    expect(f.mock.calls[0][1].method).toBe("POST");
    expect(out).toEqual({ aborted: true });
  });

  it("runCron() POSTs to the run subroute and returns {session_id}", async () => {
    const f = mockFetch(200, { session_id: "s1" });
    vi.stubGlobal("fetch", f);
    const out = await api.runCron("c1");
    expect(f.mock.calls[0][0]).toBe("/api/cron/c1/run");
    expect(f.mock.calls[0][1].method).toBe("POST");
    expect(out).toEqual({ session_id: "s1" });
  });

  it("updateTicket() can PATCH title + body", async () => {
    const f = mockFetch(200, { id: "t1" });
    vi.stubGlobal("fetch", f);
    await api.updateTicket("t1", { title: "T", body: "B" });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ title: "T", body: "B" });
  });

  it("deleteCron() DELETEs and tolerates 204", async () => {
    const f = mockFetch(204, undefined);
    vi.stubGlobal("fetch", f);
    await api.deleteCron("c1");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });

  it("createTask() POSTs project/prompt and returns {id}", async () => {
    const f = mockFetch(200, { id: "task1" });
    vi.stubGlobal("fetch", f);
    const out = await api.createTask({ project: "deck", prompt: "go" });
    expect(out).toEqual({ id: "task1" });
  });

  it("createGoal() POSTs the goal fields", async () => {
    const f = mockFetch(200, { id: "g1", status: "queued" });
    vi.stubGlobal("fetch", f);
    await api.createGoal({ project: "deck", title: "T", expected_output: "x", acceptance: "y" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/goals");
    expect(JSON.parse(init.body)).toEqual({ project: "deck", title: "T", expected_output: "x", acceptance: "y" });
  });

  it("runGoal() POSTs to the run subroute; goals() GETs the list", async () => {
    const f = mockFetch(200, { id: "g1", status: "building" });
    vi.stubGlobal("fetch", f);
    await api.runGoal("g1");
    expect(f.mock.calls[0][0]).toBe("/api/goals/g1/run");
    const f2 = mockFetch(200, [{ id: "g1" }]);
    vi.stubGlobal("fetch", f2);
    expect(await api.goals()).toEqual([{ id: "g1" }]);
  });

  it("cancelGoal() POSTs cancel; deleteGoal() DELETEs", async () => {
    const f = mockFetch(200, { cancelled: true });
    vi.stubGlobal("fetch", f);
    await api.cancelGoal("g1");
    expect(f.mock.calls[0][0]).toBe("/api/goals/g1/cancel");
    const f2 = mockFetch(204, undefined);
    vi.stubGlobal("fetch", f2);
    await api.deleteGoal("g1");
    expect(f2.mock.calls[0][1].method).toBe("DELETE");
  });
});

// The void (no-body) endpoints share the same failure path as the JSON ones via
// the internal `fail()` helper: on !ok they throw ApiError carrying the server's
// `{error}` message, falling back to the bare status when the body isn't JSON.
describe("void-response error path (shared fail helper)", () => {
  it("deleteGoal() surfaces the body's error message as ApiError", async () => {
    const f = mockFetch(409, { error: "cancel the goal before deleting it" });
    vi.stubGlobal("fetch", f);
    await expect(api.deleteGoal("g1")).rejects.toMatchObject({
      status: 409,
      message: "cancel the goal before deleting it",
    } as ApiError);
  });

  it("deleteSession() falls back to the status when the error body isn't JSON", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    vi.stubGlobal("fetch", f);
    await expect(api.deleteSession("s1")).rejects.toMatchObject({ status: 500, message: "500" } as ApiError);
  });
});
