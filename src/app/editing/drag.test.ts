import { describe, expect, it } from "vitest";
import {
  advancePaint,
  clampSpawnFraction,
  isLooseEndpoint,
  paintSpan,
  previewResize,
  shouldDetach,
  spanContains,
  spanEnd,
  spanFromPaint,
  spansOverlap,
} from "./drag";

function expectSpan(
  actual: { start: number; length: number } | null,
  start: number,
  length: number,
): void {
  expect(actual).not.toBeNull();
  expect(actual!.start).toBeCloseTo(start, 9);
  expect(actual!.length).toBeCloseTo(length, 9);
}

describe("drag paint spans", () => {
  it("paints forward from the press origin", () => {
    expectSpan(spanFromPaint(0.2, 0.1, 0.3), 0.1, 0.2);
  });

  it("paints backward from the released fraction", () => {
    expectSpan(spanFromPaint(-0.2, 0.3, 0.1), 0.1, 0.2);
  });

  it("ignores a zero-length drag", () => {
    expect(spanFromPaint(0.000001, 0.4, 0.4)).toBeNull();
    expect(paintSpan({ signedLength: 0, originFraction: 0.2, previousFraction: 0.2 })).toBeNull();
  });

  it("keeps a painted run shorter than the full loop", () => {
    expectSpan(spanFromPaint(2, 0.1, 0.1), 0.1, 1 - 1e-9);
  });

  it("accumulates forward progress on a closed seam", () => {
    const first = advancePaint(
      { originFraction: 0.9, previousFraction: 0.9, signedLength: 0 },
      0.05,
      true,
    );
    expect(first.signedLength).toBeCloseTo(0.15, 9);
    expect(first.previousFraction).toBeCloseTo(0.05, 9);
    const second = advancePaint(
      { originFraction: 0.9, ...first },
      0.1,
      true,
    );
    expect(second.signedLength).toBeCloseTo(0.2, 9);
    expectSpan(paintSpan({ originFraction: 0.9, ...second }), 0.9, 0.2);
  });

  it("accumulates backward progress across the seam", () => {
    const progress = advancePaint(
      { originFraction: 0.1, previousFraction: 0.1, signedLength: 0 },
      0.95,
      true,
    );
    expect(progress.signedLength).toBeCloseTo(-0.15, 9);
    expectSpan(paintSpan({ originFraction: 0.1, ...progress }), 0.95, 0.15);
  });

  it("measures open-section drags from the origin", () => {
    const progress = advancePaint(
      { originFraction: 0.2, previousFraction: 0.3, signedLength: 0.1 },
      0.55,
      false,
    );
    expect(progress.signedLength).toBeCloseTo(0.35, 9);
  });
});

describe("drag resize decisions", () => {
  it("accepts a forward entry handle", () => {
    expectSpan(
      previewResize({ start: 0.2, length: 0.3 }, "entry", 0.4, false),
      0.4,
      0.1,
    );
  });

  it("accepts a forward exit handle", () => {
    expectSpan(
      previewResize({ start: 0.2, length: 0.3 }, "exit", 0.7, false),
      0.2,
      0.5,
    );
  });

  it("handles a closed seam", () => {
    expectSpan(
      previewResize({ start: 0.8, length: 0.3 }, "exit", 0.2, true),
      0.8,
      0.4,
    );
    expectSpan(
      previewResize({ start: 0.8, length: 0.3 }, "entry", 0.95, true),
      0.95,
      0.15,
    );
  });

  it("rejects an arc that crosses an open section end", () => {
    expect(
      previewResize({ start: 0.8, length: 0.1 }, "exit", 1.2, false),
    ).toBeNull();
  });

  it("rejects a collapsed handle", () => {
    expect(
      previewResize({ start: 0.2, length: 0.3 }, "entry", 0.5, false),
    ).toBeNull();
    expect(
      previewResize({ start: 0.2, length: 0.3 }, "exit", 0.2, false),
    ).toBeNull();
  });
});

describe("drag span predicates", () => {
  it("reuses overlap and containment checks across the seam", () => {
    expect(spansOverlap(0.9, 0.2, 0.0, 0.1, true)).toBe(true);
    expect(spansOverlap(0.1, 0.2, 0.4, 0.1, true)).toBe(false);
    expect(spanContains(0.9, 0.2, 0.05, true)).toBe(true);
    expect(spanContains(0.1, 0.2, 0.4, false)).toBe(false);
    expect(spanEnd(0.8, 0.4)).toBeCloseTo(0.2, 9);
  });

  it("identifies open-section endpoints only", () => {
    expect(isLooseEndpoint(false, 0, 5)).toBe(true);
    expect(isLooseEndpoint(false, 4, 5)).toBe(true);
    expect(isLooseEndpoint(false, 2, 5)).toBe(false);
    expect(isLooseEndpoint(true, 0, 5)).toBe(false);
  });

  it("detaches only a joined final end", () => {
    expect(shouldDetach(false, 4, 5, true)).toBe(true);
    expect(shouldDetach(false, 4, 5, false)).toBe(false);
    expect(shouldDetach(false, 3, 5, true)).toBe(false);
    expect(shouldDetach(true, 4, 5, true)).toBe(false);
  });

  it("clamps spawn fractions", () => {
    expect(clampSpawnFraction(-1)).toBe(0);
    expect(clampSpawnFraction(0.5)).toBe(0.5);
    expect(clampSpawnFraction(2)).toBe(0.999);
  });
});
