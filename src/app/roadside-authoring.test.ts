import { describe, expect, it } from "vitest";
import {
  resizeSpan,
  spanContains,
  spanEnd,
  spanFromPaint,
  spanIntervals,
  spansOverlap,
} from "./roadside-authoring";

function expectSpan(
  actual: { start: number; length: number } | null,
  start: number,
  length: number,
): void {
  expect(actual).not.toBeNull();
  expect(actual!.start).toBeCloseTo(start, 9);
  expect(actual!.length).toBeCloseTo(length, 9);
}

describe("roadside run painting", () => {
  it("paints forward from the drag origin", () => {
    expectSpan(spanFromPaint(0.2, 0.1, 0.3), 0.1, 0.2);
  });

  it("paints backwards from the released fraction", () => {
    expectSpan(spanFromPaint(-0.2, 0.3, 0.1), 0.1, 0.2);
  });

  it("ignores a click without a drag", () => {
    expect(spanFromPaint(0.000001, 0.4, 0.4)).toBeNull();
  });

  it("keeps a painted run shorter than the full loop", () => {
    expectSpan(spanFromPaint(2, 0.1, 0.1), 0.1, 1 - 1e-9);
  });
});

describe("roadside run resize", () => {
  it("moves the entry handle forward", () => {
    expectSpan(
      resizeSpan({ start: 0.2, length: 0.3 }, "entry", 0.4, false),
      0.4,
      0.1,
    );
  });

  it("moves the exit handle forward", () => {
    expectSpan(
      resizeSpan({ start: 0.2, length: 0.3 }, "exit", 0.7, false),
      0.2,
      0.5,
    );
  });

  it("handles a closed seam", () => {
    expectSpan(
      resizeSpan({ start: 0.8, length: 0.3 }, "exit", 0.2, true),
      0.8,
      0.4,
    );
    expectSpan(
      resizeSpan({ start: 0.8, length: 0.3 }, "entry", 0.95, true),
      0.95,
      0.15,
    );
  });

  it("rejects an arc that crosses an open section end", () => {
    expect(
      resizeSpan({ start: 0.8, length: 0.1 }, "exit", 1.2, false),
    ).toBeNull();
  });

  it("rejects a collapsed handle", () => {
    expect(
      resizeSpan({ start: 0.2, length: 0.3 }, "entry", 0.5, false),
    ).toBeNull();
    expect(
      resizeSpan({ start: 0.2, length: 0.3 }, "exit", 0.2, false),
    ).toBeNull();
  });
});

describe("roadside span intervals", () => {
  it("splits a wrapping closed run", () => {
    const intervals = spanIntervals(0.8, 0.4, true);
    expect(intervals).toHaveLength(2);
    expect(intervals[0]![0]).toBeCloseTo(0.8, 9);
    expect(intervals[0]![1]).toBeCloseTo(1, 9);
    expect(intervals[1]![0]).toBeCloseTo(0, 9);
    expect(intervals[1]![1]).toBeCloseTo(0.2, 9);
    expect(spanEnd(0.8, 0.4)).toBeCloseTo(0.2, 9);
  });

  it("detects overlapping wrapped runs on a closed section", () => {
    expect(spansOverlap(0.9, 0.2, 0.0, 0.1, true)).toBe(true);
    expect(spansOverlap(0.1, 0.2, 0.4, 0.1, true)).toBe(false);
  });

  it("detects containment across the seam", () => {
    expect(spanContains(0.9, 0.2, 0.05, true)).toBe(true);
    expect(spanContains(0.1, 0.2, 0.4, false)).toBe(false);
  });
});
