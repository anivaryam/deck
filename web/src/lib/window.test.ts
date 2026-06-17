import { describe, expect, it } from "vitest";
import { hiddenAbove, tailWindow } from "./window";

const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("tailWindow", () => {
  it("returns all items when fewer than the window", () => {
    expect(tailWindow(seq(5), 40)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns all items when exactly the window size", () => {
    expect(tailWindow(seq(40), 40)).toEqual(seq(40));
  });

  it("returns only the tail when longer than the window", () => {
    expect(tailWindow(seq(100), 40)).toEqual(seq(100).slice(60));
    expect(tailWindow(seq(100), 40)).toHaveLength(40);
  });

  it("includes the very last item (the latest message)", () => {
    const out = tailWindow(seq(100), 40);
    expect(out[out.length - 1]).toBe(99);
  });

  it("grows monotonically without dropping the latest as count increases", () => {
    const small = tailWindow(seq(100), 40);
    const bigger = tailWindow(seq(100), 80);
    expect(bigger).toHaveLength(80);
    // the smaller window is a tail-suffix of the bigger one
    expect(bigger.slice(bigger.length - small.length)).toEqual(small);
  });

  it("does not mutate the input", () => {
    const input = seq(100);
    tailWindow(input, 40);
    expect(input).toEqual(seq(100));
  });

  it("treats a non-positive count as an empty window", () => {
    expect(tailWindow(seq(10), 0)).toEqual([]);
  });
});

describe("hiddenAbove", () => {
  it("is zero when everything fits in the window", () => {
    expect(hiddenAbove(5, 40)).toBe(0);
    expect(hiddenAbove(40, 40)).toBe(0);
  });

  it("counts the messages above the window", () => {
    expect(hiddenAbove(100, 40)).toBe(60);
  });

  it("never goes negative", () => {
    expect(hiddenAbove(3, 40)).toBe(0);
  });

  it("matches tailWindow's hidden remainder", () => {
    const total = 137;
    const count = 40;
    expect(hiddenAbove(total, count)).toBe(total - tailWindow(seq(total), count).length);
  });
});
