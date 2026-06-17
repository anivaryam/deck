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

  it("updateCron() PATCHes enabled", async () => {
    const f = mockFetch(200, { id: "c1", enabled: 0 });
    vi.stubGlobal("fetch", f);
    await api.updateCron("c1", false);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/cron/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
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
});
