import { describe, it, expect } from "vitest";
import { notificationForTask } from "./notifications";
import type { TaskFrame } from "./automation-events";

const base: TaskFrame = { id: "s1", source_kind: "cron", source_id: "c1", status: "idle", result: "success" };

describe("notificationForTask", () => {
  it("notifies on a finished cron run", () => {
    expect(notificationForTask(base)).toMatchObject({ intent: "success", title: "Cron finished" });
  });

  it("notifies on a finished ticket run", () => {
    expect(notificationForTask({ ...base, source_kind: "ticket" })).toMatchObject({ title: "Ticket finished" });
  });

  it("notifies on a manual/unsourced task too (the ticket asks for task completion)", () => {
    expect(notificationForTask({ ...base, source_kind: null })).toMatchObject({
      intent: "success",
      title: "Task finished",
    });
  });

  it("uses an error intent for a failed run", () => {
    expect(notificationForTask({ ...base, status: "errored", result: "error" })).toMatchObject({
      intent: "error",
      title: "Cron failed",
    });
  });

  it("uses an error intent for a queue_full drop", () => {
    expect(notificationForTask({ ...base, status: "errored", result: "queue_full" })).toMatchObject({
      intent: "error",
      title: "Cron dropped",
    });
  });

  it("stays silent while a run is still active", () => {
    expect(notificationForTask({ ...base, status: "active", result: null })).toBeNull();
  });

  it("stays silent for cancelled runs", () => {
    expect(notificationForTask({ ...base, result: "cancelled" })).toBeNull();
  });
});
