import { describe, it, expect } from "vitest";
import { toastForTask, type TaskFrame } from "./automation-events";

const base: TaskFrame = { id: "s1", source_kind: "cron", source_id: "c1", status: "idle", result: "success" };

describe("toastForTask", () => {
  it("returns a success intent for a finished cron run", () => {
    expect(toastForTask(base)).toEqual({ intent: "success", message: expect.stringContaining("cron") });
  });
  it("returns an error intent for a failed ticket run", () => {
    expect(toastForTask({ ...base, source_kind: "ticket", result: "error" })).toMatchObject({ intent: "error" });
  });
  it("returns null while a run is still active", () => {
    expect(toastForTask({ ...base, status: "active", result: null })).toBeNull();
  });
  it("returns null for manual/unsourced runs (no noise)", () => {
    expect(toastForTask({ ...base, source_kind: null })).toBeNull();
  });
  it("returns null for cancelled runs", () => {
    expect(toastForTask({ ...base, result: "cancelled" })).toBeNull();
  });
});
