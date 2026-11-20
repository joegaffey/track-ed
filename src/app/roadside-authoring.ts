export interface SpanRange {
  start: number;
  length: number;
}

export type SpanEdge = "entry" | "exit";

/** Split a forward arc into up to two intervals when it wraps a closed seam. */
export function spanIntervals(
  start: number,
  length: number,
  closed: boolean,
): Array<[number, number]> {
  const end = start + length;
  if (closed && end > 1) {
    return [
      [start, 1],
      [0, end - 1],
    ];
  }
  return [[start, end]];
}

export function spanEnd(start: number, length: number): number {
  return (start + length) % 1;
}

export function spansOverlap(
  aStart: number,
  aLength: number,
  bStart: number,
  bLength: number,
  closed: boolean,
): boolean {
  for (const a of spanIntervals(aStart, aLength, closed)) {
    for (const b of spanIntervals(bStart, bLength, closed)) {
      if (a[0] < b[1] - 1e-9 && a[1] > b[0] + 1e-9) {
        return true;
      }
    }
  }
  return false;
}

export function spanContains(
  start: number,
  length: number,
  fraction: number,
  closed: boolean,
): boolean {
  return spanIntervals(start, length, closed).some(
    (interval) =>
      fraction >= interval[0] - 1e-9 && fraction <= interval[1] + 1e-9,
  );
}

/**
 * Turn a drag from an origin fraction into a forward run. Dragging backwards
 * keeps the released position as the entry and measures forward from there.
 */
export function spanFromPaint(
  signedLength: number,
  originFraction: number,
  previousFraction: number,
): SpanRange | null {
  const length = Math.abs(signedLength);
  if (length <= 1e-5) {
    return null;
  }
  const start = signedLength >= 0 ? originFraction : previousFraction;
  return {
    start: ((start % 1) + 1) % 1,
    length: Math.min(1 - 1e-9, length),
  };
}

/** Resize a run by moving its entry or exit handle, rejecting invalid arcs. */
export function resizeSpan(
  span: SpanRange,
  edge: SpanEdge,
  fraction: number,
  closed: boolean,
  minimum = 0.002,
): SpanRange | null {
  let start = span.start;
  let length = span.length;
  if (edge === "entry") {
    const exit = spanEnd(span.start, span.length);
    const forward = closed ? (exit - fraction + 1) % 1 : exit - fraction;
    if (forward <= minimum || forward >= 1) {
      return null;
    }
    start = fraction;
    length = forward;
  } else {
    const forward = closed
      ? (fraction - span.start + 1) % 1
      : fraction - span.start;
    if (forward <= minimum || forward >= 1) {
      return null;
    }
    length = forward;
  }
  if (!closed && start + length > 1 + 1e-9) {
    return null;
  }
  return { start, length };
}
