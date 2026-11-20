import type { Project, ProjectRoadsideKind } from "../../kernel/project";
import {
  resizeSpan,
  spanEnd,
  spanFromPaint,
  spanIntervals,
  spansOverlap,
  spanContains,
  type SpanEdge,
  type SpanRange,
} from "../roadside-authoring";

/**
 * Pure drag-transition helpers shared by the pointer state machine.
 *
 * This module deliberately has no DOM or three.js dependency so the decisions
 * can be unit tested without a browser.
 */

export type { SpanEdge, SpanRange };
export {
  resizeSpan,
  spanEnd,
  spanFromPaint,
  spanIntervals,
  spansOverlap,
  spanContains,
};

export type DragState =
  | {
      kind: "point";
      centerlineIndex: number;
      pointIndex: number;
      startProject: Project;
      pendingDetach?: boolean;
    }
  | { kind: "attach"; startProject: Project }
  | { kind: "spawn"; startProject: Project }
  | {
      kind: "roadside-paint";
      sectionId: string;
      splineId: string;
      runKind: ProjectRoadsideKind;
      closed: boolean;
      originFraction: number;
      previousFraction: number;
      signedLength: number;
      startProject: Project;
    }
  | {
      kind: "roadside-entry" | "roadside-exit";
      sectionId: string;
      splineId: string;
      runIndex: number;
      startProject: Project;
    }
  | {
      kind: "terrain-point";
      index: number;
      startProject: Project;
      startHeight: number;
      startClientY: number;
      unitsPerPixel: number;
    }
  | null;

export interface PaintTracker {
  originFraction: number;
  previousFraction: number;
  signedLength: number;
}

export interface PaintProgress {
  signedLength: number;
  previousFraction: number;
}

export interface PaintDrag {
  originFraction: number;
  previousFraction: number;
  signedLength: number;
}

/**
 * Advance a guide-rail paint drag by one sampled fraction. Closed sections
 * accumulate a signed length and unwrap seam crossings; open sections measure
 * directly from the original press.
 */
export function advancePaint(
  tracker: PaintTracker,
  fraction: number,
  closed: boolean,
): PaintProgress {
  if (closed) {
    let delta = fraction - tracker.previousFraction;
    if (delta > 0.5) {
      delta -= 1;
    } else if (delta < -0.5) {
      delta += 1;
    }
    return {
      signedLength: tracker.signedLength + delta,
      previousFraction: fraction,
    };
  }
  return {
    signedLength: fraction - tracker.originFraction,
    previousFraction: fraction,
  };
}

/** Resolve a completed paint drag into a forward span, or null if tiny. */
export function paintSpan(drag: PaintDrag): SpanRange | null {
  return spanFromPaint(
    drag.signedLength,
    drag.originFraction,
    drag.previousFraction,
  );
}

/** Resolve a handle resize preview; invalid/rejected arcs return null. */
export function previewResize(
  span: SpanRange,
  edge: SpanEdge,
  fraction: number,
  closed: boolean,
  minimum = 0.002,
): SpanRange | null {
  return resizeSpan(span, edge, fraction, closed, minimum);
}

export function isLooseEndpoint(
  closed: boolean,
  pointIndex: number,
  pointCount: number,
): boolean {
  return !closed && (pointIndex === 0 || pointIndex === pointCount - 1);
}

/** A joined end becomes detached only while it still carries an endAttach. */
export function shouldDetach(
  closed: boolean,
  pointIndex: number,
  pointCount: number,
  endAttached: boolean,
): boolean {
  return (
    !closed && pointIndex === pointCount - 1 && endAttached
  );
}

export function clampSpawnFraction(fraction: number): number {
  return Math.max(0, Math.min(0.999, fraction));
}
