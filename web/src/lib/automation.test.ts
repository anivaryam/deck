import { describe, it, expect } from "vitest";
import {
  normalizeTicketStatus,
  taskStatus,
  goalStatus,
  statusDotClass,
  statusChipClass,
  relativeTime,
  projectNameForPath,
  byProjectPath,
  resolveSelectedGoal,
  TICKET_TABS,
  filterTicketsByTab,
} from "./automation";
import type { Session, Ticket } from "./types";

describe("normalizeTicketStatus", () => {
  it("passes through known statuses", () => {
    expect(normalizeTicketStatus("review")).toBe("review");
    expect(normalizeTicketStatus("failed")).toBe("failed");
  });
  it("falls back to open for unknown/empty", () => {
    expect(normalizeTicketStatus("weird")).toBe("open");
    expect(normalizeTicketStatus("")).toBe("open");
  });
});

describe("taskStatus", () => {
  it("maps session status to a normalized automation status", () => {
    expect(taskStatus({ status: "active" } as Session)).toBe("running");
    expect(taskStatus({ status: "errored" } as Session)).toBe("failed");
    expect(taskStatus({ status: "idle" } as Session)).toBe("done");
  });
});

describe("status classes", () => {
  it("uses destructive only for failed", () => {
    expect(statusDotClass("failed")).toContain("destructive");
    expect(statusDotClass("running")).not.toContain("destructive");
    expect(statusChipClass("failed")).toContain("destructive");
  });
});

describe("relativeTime", () => {
  it("formats recent timestamps", () => {
    const now = 10_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
  it("renders null as a dash", () => {
    expect(relativeTime(null, 1)).toBe("—");
  });
});

describe("projectNameForPath / byProjectPath", () => {
  const projects = [
    { name: "deck", path: "/p/deck" },
    { name: "merge-port", path: "/p/mp" },
  ];
  it("resolves a name from a path", () => {
    expect(projectNameForPath(projects, "/p/deck")).toBe("deck");
    expect(projectNameForPath(projects, "/p/none")).toBeNull();
  });
  it("filters rows by project_path", () => {
    const rows = [{ project_path: "/p/deck" }, { project_path: "/p/mp" }] as Ticket[];
    expect(byProjectPath(rows, "/p/deck")).toHaveLength(1);
  });
});

describe("filterTicketsByTab", () => {
  const rows = [
    { status: "open" },
    { status: "running" },
    { status: "review" },
  ] as Ticket[];
  it("returns all for the 'all' tab", () => {
    expect(filterTicketsByTab(rows, "all")).toHaveLength(3);
  });
  it("filters by normalized status", () => {
    expect(filterTicketsByTab(rows, "running")).toHaveLength(1);
  });
  it("exposes the tab list", () => {
    expect(TICKET_TABS[0]).toBe("all");
  });
});

describe("merged/closed statuses", () => {
  it("normalizes merged and closed", () => {
    expect(normalizeTicketStatus("merged")).toBe("merged");
    expect(normalizeTicketStatus("closed")).toBe("closed");
  });
  it("TICKET_TABS includes merged and closed", () => {
    expect(TICKET_TABS).toContain("merged");
    expect(TICKET_TABS).toContain("closed");
  });
  it("has chip + dot classes for the new statuses (no undefined)", () => {
    expect(statusChipClass("merged")).toBeTruthy();
    expect(statusDotClass("closed")).toBeTruthy();
  });
});

describe("goalStatus", () => {
  it("maps goal statuses to automation statuses", () => {
    expect(goalStatus("queued")).toBe("open");
    expect(goalStatus("building")).toBe("running");
    expect(goalStatus("review")).toBe("review");
    expect(goalStatus("failed")).toBe("failed");
    expect(goalStatus("cancelled")).toBe("closed");
  });
  it("maps verifying and achieved", () => {
    expect(goalStatus("verifying")).toBe("running");
    expect(goalStatus("achieved")).toBe("merged");
  });
});

describe("resolveSelectedGoal", () => {
  const a = { id: "g1", project_path: "/p/a" };
  const b = { id: "g2", project_path: "/p/b" };

  it("returns the live goal when it matches the selection and project", () => {
    expect(resolveSelectedGoal(a, [a], "g1", "/p/a")).toBe(a);
  });

  it("ignores a live goal from a different project (cross-project leak)", () => {
    // selId still points at project-a's goal, but we are now viewing project b.
    // The live query returns the project-a goal; it must NOT be shown for project b.
    expect(resolveSelectedGoal(a, [b], "g1", "/p/b")).toBeNull();
  });

  it("falls back to the project-scoped row when live data is absent", () => {
    expect(resolveSelectedGoal(null, [a], "g1", "/p/a")).toBe(a);
  });

  it("ignores a stale live goal whose id no longer matches the selection", () => {
    expect(resolveSelectedGoal(a, [b], "g2", "/p/b")).toBe(b);
  });

  it("returns null when nothing matches the selection", () => {
    expect(resolveSelectedGoal(null, [], "g1", "/p/a")).toBeNull();
  });
});
