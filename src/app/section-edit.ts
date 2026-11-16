import { bakeProject } from "../kernel/bake";
import { centerlineLength, samplePolyline, type Vec2 } from "../kernel/geometry";
import {
  add2,
  distancePointToSegmentSq,
  leftNormal,
  normalize2,
  scale2,
  signedArea2,
  sub2,
} from "../kernel/math2";
import type {
  Project,
  ProjectCenterline,
  ProjectJunction,
  ProjectJunctionMember,
  ProjectKerbSpan,
  ProjectPropSpan,
  ProjectRoadsideRun,
  ProjectRoadsideSpline,
  ProjectWallSpan,
} from "../kernel/project";
import { isVenueSchema } from "../kernel/project";
import { fractionAtControlPoint, sampleCenterline } from "../kernel/spline";
import { validateBakedTrack } from "../kernel/validate-baked";

export type SectionEditResult =
  | { ok: true; project: Project }
  | { ok: false; message: string };

export interface SectionEnd {
  section: ProjectCenterline;
  sectionIndex: number;
  pointIndex: number;
  pointId: string;
}

function flipKerbSide(side: ProjectKerbSpan["side"]): ProjectKerbSpan["side"] {
  return side === "left" ? "right" : "left";
}

interface KerbInterval {
  side: ProjectKerbSpan["side"];
  start: number;
  end: number;
  flatHeight?: number;
  cornerHeight?: number;
}

function spanIntervals(span: ProjectKerbSpan, closed: boolean): KerbInterval[] {
  const end = span.start + span.length;
  const heights = {
    ...(span.flatHeight !== undefined ? { flatHeight: span.flatHeight } : {}),
    ...(span.cornerHeight !== undefined ? { cornerHeight: span.cornerHeight } : {}),
  };
  if (closed && end > 1) {
    return [
      { side: span.side, start: span.start, end: 1, ...heights },
      { side: span.side, start: 0, end: end - 1, ...heights },
    ];
  }
  return [{ side: span.side, start: span.start, end, ...heights }];
}

function sameKerbProfile(a: KerbInterval, b: KerbInterval): boolean {
  return (
    a.side === b.side &&
    a.flatHeight === b.flatHeight &&
    a.cornerHeight === b.cornerHeight
  );
}

function mergeKerbSpans(
  spans: readonly ProjectKerbSpan[],
  closed = false,
): ProjectKerbSpan[] {
  const intervals = spans
    .flatMap((span) => spanIntervals(span, closed))
    .filter((interval) => interval.end - interval.start > 1e-6)
    .sort(
      (a, b) =>
        a.side.localeCompare(b.side) ||
        (a.flatHeight ?? -1) - (b.flatHeight ?? -1) ||
        (a.cornerHeight ?? -1) - (b.cornerHeight ?? -1) ||
        a.start - b.start,
    );
  const merged: KerbInterval[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      sameKerbProfile(previous, interval) &&
      interval.start <= previous.end + 1e-6
    ) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  if (closed) {
    for (let index = 0; index < merged.length; index += 1) {
      const first = merged[index]!;
      if (first.start > 1e-6) {
        continue;
      }
      const last = merged.find(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          candidate.end >= 1 - 1e-6 &&
          sameKerbProfile(candidate, first),
      );
      if (!last || last.start <= first.end + 1e-9) {
        continue;
      }
      merged.splice(merged.indexOf(last), 1);
      merged.splice(index, 1, {
        ...first,
        start: last.start,
        end: first.end + 1 + 1e-9,
      });
      break;
    }
  }

  return merged
    .filter((interval) => interval.end - interval.start > 1e-6)
    .map((interval) => {
      const length = interval.end - interval.start;
      const start = interval.start >= 1 ? interval.start - 1 : interval.start;
      return {
        side: interval.side,
        start: Math.max(0, Math.min(1 - 1e-9, start)),
        length: Math.max(0, Math.min(1 - 1e-9, length)),
        ...(interval.flatHeight !== undefined ? { flatHeight: interval.flatHeight } : {}),
        ...(interval.cornerHeight !== undefined
          ? { cornerHeight: interval.cornerHeight }
          : {}),
      };
    });
}

function flipWallSide(side: ProjectWallSpan["side"]): ProjectWallSpan["side"] {
  return side === "left" ? "right" : "left";
}

interface WallInterval {
  side: ProjectWallSpan["side"];
  start: number;
  end: number;
  height?: number;
  offset?: number;
}

function wallSpanIntervals(
  span: ProjectWallSpan,
  closed: boolean,
): WallInterval[] {
  const end = span.start + span.length;
  const profile = {
    ...(span.height !== undefined ? { height: span.height } : {}),
    ...(span.offset !== undefined ? { offset: span.offset } : {}),
  };
  if (closed && end > 1) {
    return [
      { side: span.side, start: span.start, end: 1, ...profile },
      { side: span.side, start: 0, end: end - 1, ...profile },
    ];
  }
  return [{ side: span.side, start: span.start, end, ...profile }];
}

function sameWallProfile(a: WallInterval, b: WallInterval): boolean {
  return (
    a.side === b.side &&
    a.height === b.height &&
    a.offset === b.offset
  );
}

function mergeWallSpans(
  spans: readonly ProjectWallSpan[],
  closed = false,
): ProjectWallSpan[] {
  const intervals = spans
    .flatMap((span) => wallSpanIntervals(span, closed))
    .filter((interval) => interval.end - interval.start > 1e-6)
    .sort(
      (a, b) =>
        a.side.localeCompare(b.side) ||
        (a.height ?? -1) - (b.height ?? -1) ||
        (a.offset ?? -1) - (b.offset ?? -1) ||
        a.start - b.start,
    );
  const merged: WallInterval[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      sameWallProfile(previous, interval) &&
      interval.start <= previous.end + 1e-6
    ) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  if (closed) {
    for (let index = 0; index < merged.length; index += 1) {
      const first = merged[index]!;
      if (first.start > 1e-6) {
        continue;
      }
      const last = merged.find(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          candidate.end >= 1 - 1e-6 &&
          sameWallProfile(candidate, first),
      );
      if (!last || last.start <= first.end + 1e-9) {
        continue;
      }
      merged.splice(merged.indexOf(last), 1);
      merged.splice(index, 1, {
        ...first,
        start: last.start,
        end: first.end + 1 + 1e-9,
      });
      break;
    }
  }

  return merged
    .filter((interval) => interval.end - interval.start > 1e-6)
    .map((interval) => {
      const length = interval.end - interval.start;
      const start = interval.start >= 1 ? interval.start - 1 : interval.start;
      return {
        side: interval.side,
        start: Math.max(0, Math.min(1 - 1e-9, start)),
        length: Math.max(0, Math.min(1 - 1e-9, length)),
        ...(interval.height !== undefined ? { height: interval.height } : {}),
        ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
      };
    });
}

function splitWallSpans(
  spans: readonly ProjectWallSpan[],
  fraction: number,
): { left: ProjectWallSpan[]; right: ProjectWallSpan[] } {
  const safe = Math.max(1e-6, Math.min(1 - 1e-6, fraction));
  const left: ProjectWallSpan[] = [];
  const right: ProjectWallSpan[] = [];
  for (const span of spans) {
    for (const interval of wallSpanIntervals(span, false)) {
      const leftEnd = Math.min(interval.end, safe);
      if (leftEnd - interval.start > 1e-6) {
        left.push({
          side: interval.side,
          start: interval.start / safe,
          length: (leftEnd - interval.start) / safe,
          ...(interval.height !== undefined ? { height: interval.height } : {}),
          ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
        });
      }
      const rightStart = Math.max(interval.start, safe);
      if (interval.end - rightStart > 1e-6) {
        right.push({
          side: interval.side,
          start: (rightStart - safe) / (1 - safe),
          length: (interval.end - rightStart) / (1 - safe),
          ...(interval.height !== undefined ? { height: interval.height } : {}),
          ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
        });
      }
    }
  }
  return {
    left: mergeWallSpans(left, false),
    right: mergeWallSpans(right, false),
  };
}

function mapWallSpansToOpen(
  spans: readonly ProjectWallSpan[],
  closed: boolean,
  startDistance: number,
  pathLength: number,
  total: number,
): ProjectWallSpan[] {
  if (pathLength <= 1e-9 || total <= 1e-9) {
    return [];
  }
  const mapped: ProjectWallSpan[] = [];
  for (const span of spans) {
    for (const interval of wallSpanIntervals(span, closed)) {
      const start = interval.start * total;
      const end = interval.end * total;
      for (const offset of [-total, 0, total]) {
        const from = Math.max(start + offset, startDistance);
        const to = Math.min(end + offset, startDistance + pathLength);
        if (to - from <= 1e-6) {
          continue;
        }
        mapped.push({
          side: interval.side,
          start: Math.max(0, Math.min(1, (from - startDistance) / pathLength)),
          length: Math.max(0, Math.min(1, (to - from) / pathLength)),
          ...(interval.height !== undefined ? { height: interval.height } : {}),
          ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
        });
      }
    }
  }
  return mergeWallSpans(mapped, false);
}

function mapWallSpansForMerge(
  spans: readonly ProjectWallSpan[],
  reversed: boolean,
  startFraction: number,
  lengthFraction: number,
): ProjectWallSpan[] {
  return spans.map((span) => {
    const start = reversed ? 1 - (span.start + span.length) : span.start;
    return {
      side: reversed ? flipWallSide(span.side) : span.side,
      start: startFraction + start * lengthFraction,
      length: span.length * lengthFraction,
      ...(span.height !== undefined ? { height: span.height } : {}),
      ...(span.offset !== undefined ? { offset: span.offset } : {}),
    };
  });
}

function flipPropSide(side: ProjectPropSpan["side"]): ProjectPropSpan["side"] {
  return side === "left" ? "right" : "left";
}

interface PropInterval {
  kind: ProjectPropSpan["kind"];
  side: ProjectPropSpan["side"];
  start: number;
  end: number;
  offset?: number;
  spacing?: number;
  collision?: "solid" | "none";
}

function propSpanIntervals(span: ProjectPropSpan, closed: boolean): PropInterval[] {
  const end = span.start + span.length;
  const profile = {
    ...(span.offset !== undefined ? { offset: span.offset } : {}),
    ...(span.spacing !== undefined ? { spacing: span.spacing } : {}),
    ...(span.collision !== undefined ? { collision: span.collision } : {}),
  };
  if (closed && end > 1) {
    return [
      { kind: span.kind, side: span.side, start: span.start, end: 1, ...profile },
      { kind: span.kind, side: span.side, start: 0, end: end - 1, ...profile },
    ];
  }
  return [{ kind: span.kind, side: span.side, start: span.start, end, ...profile }];
}

function samePropProfile(a: PropInterval, b: PropInterval): boolean {
  return (
    a.kind === b.kind &&
    a.side === b.side &&
    a.offset === b.offset &&
    a.spacing === b.spacing &&
    a.collision === b.collision
  );
}

function mergePropSpans(
  spans: readonly ProjectPropSpan[],
  closed = false,
): ProjectPropSpan[] {
  const intervals = spans
    .flatMap((span) => propSpanIntervals(span, closed))
    .filter((interval) => interval.end - interval.start > 1e-6)
    .sort(
      (a, b) =>
        a.side.localeCompare(b.side) ||
        a.kind.localeCompare(b.kind) ||
        (a.offset ?? -1) - (b.offset ?? -1) ||
        (a.spacing ?? -1) - (b.spacing ?? -1) ||
        a.start - b.start,
    );
  const merged: PropInterval[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      samePropProfile(previous, interval) &&
      interval.start <= previous.end + 1e-6
    ) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged
    .filter((interval) => interval.end - interval.start > 1e-6)
    .map((interval) => {
      const length = interval.end - interval.start;
      const start = interval.start >= 1 ? interval.start - 1 : interval.start;
      return {
        kind: interval.kind,
        side: interval.side,
        start: Math.max(0, Math.min(1 - 1e-9, start)),
        length: Math.max(0, Math.min(1 - 1e-9, length)),
        ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
        ...(interval.spacing !== undefined ? { spacing: interval.spacing } : {}),
        ...(interval.collision !== undefined ? { collision: interval.collision } : {}),
      };
    });
}

function splitPropSpans(
  spans: readonly ProjectPropSpan[],
  fraction: number,
): { left: ProjectPropSpan[]; right: ProjectPropSpan[] } {
  const safe = Math.max(1e-6, Math.min(1 - 1e-6, fraction));
  const left: ProjectPropSpan[] = [];
  const right: ProjectPropSpan[] = [];
  for (const span of spans) {
    for (const interval of propSpanIntervals(span, false)) {
      const leftEnd = Math.min(interval.end, safe);
      if (leftEnd - interval.start > 1e-6) {
        left.push({
          kind: interval.kind,
          side: interval.side,
          start: interval.start / safe,
          length: (leftEnd - interval.start) / safe,
          ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
          ...(interval.spacing !== undefined ? { spacing: interval.spacing } : {}),
          ...(interval.collision !== undefined ? { collision: interval.collision } : {}),
        });
      }
      const rightStart = Math.max(interval.start, safe);
      if (interval.end - rightStart > 1e-6) {
        right.push({
          kind: interval.kind,
          side: interval.side,
          start: (rightStart - safe) / (1 - safe),
          length: (interval.end - rightStart) / (1 - safe),
          ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
          ...(interval.spacing !== undefined ? { spacing: interval.spacing } : {}),
          ...(interval.collision !== undefined ? { collision: interval.collision } : {}),
        });
      }
    }
  }
  return {
    left: mergePropSpans(left, false),
    right: mergePropSpans(right, false),
  };
}

function mapPropSpansToOpen(
  spans: readonly ProjectPropSpan[],
  closed: boolean,
  startDistance: number,
  pathLength: number,
  total: number,
): ProjectPropSpan[] {
  if (pathLength <= 1e-9 || total <= 1e-9) {
    return [];
  }
  const mapped: ProjectPropSpan[] = [];
  for (const span of spans) {
    for (const interval of propSpanIntervals(span, closed)) {
      const start = interval.start * total;
      const end = interval.end * total;
      for (const offset of [-total, 0, total]) {
        const from = Math.max(start + offset, startDistance);
        const to = Math.min(end + offset, startDistance + pathLength);
        if (to - from <= 1e-6) {
          continue;
        }
        mapped.push({
          kind: interval.kind,
          side: interval.side,
          start: Math.max(0, Math.min(1, (from - startDistance) / pathLength)),
          length: Math.max(0, Math.min(1, (to - from) / pathLength)),
          ...(interval.offset !== undefined ? { offset: interval.offset } : {}),
          ...(interval.spacing !== undefined ? { spacing: interval.spacing } : {}),
          ...(interval.collision !== undefined ? { collision: interval.collision } : {}),
        });
      }
    }
  }
  return mergePropSpans(mapped, false);
}

function mapPropSpansForMerge(
  spans: readonly ProjectPropSpan[],
  reversed: boolean,
  startFraction: number,
  lengthFraction: number,
): ProjectPropSpan[] {
  return spans.map((span) => {
    const start = reversed ? 1 - (span.start + span.length) : span.start;
    return {
      kind: span.kind,
      side: reversed ? flipPropSide(span.side) : span.side,
      start: startFraction + start * lengthFraction,
      length: span.length * lengthFraction,
      ...(span.offset !== undefined ? { offset: span.offset } : {}),
      ...(span.spacing !== undefined ? { spacing: span.spacing } : {}),
      ...(span.collision !== undefined ? { collision: span.collision } : {}),
    };
  });
}

interface RoadsideInterval {
  start: number;
  end: number;
}

function roadsideRunIntervals(
  run: ProjectRoadsideRun,
  closed: boolean,
): RoadsideInterval[] {
  const end = run.start + run.length;
  if (closed && end > 1 + 1e-9) {
    return [
      { start: run.start, end: 1 },
      { start: 0, end: end - 1 },
    ];
  }
  return [{ start: run.start, end }];
}

function roadsideRunSpan(
  run: ProjectRoadsideRun,
  start: number,
  length: number,
): ProjectRoadsideRun {
  return {
    ...run,
    start,
    length,
  };
}

function splitRoadsideSplines(
  splines: readonly ProjectRoadsideSpline[],
  fraction: number,
): { left: ProjectRoadsideSpline[]; right: ProjectRoadsideSpline[] } {
  const safe = Math.max(1e-6, Math.min(1 - 1e-6, fraction));
  const left: ProjectRoadsideSpline[] = [];
  const right: ProjectRoadsideSpline[] = [];
  for (const spline of splines) {
    const leftRuns: ProjectRoadsideRun[] = [];
    const rightRuns: ProjectRoadsideRun[] = [];
    for (const run of spline.runs) {
      for (const interval of roadsideRunIntervals(run, false)) {
        const leftEnd = Math.min(interval.end, safe);
        if (leftEnd - interval.start > 1e-6) {
          leftRuns.push(
            roadsideRunSpan(
              run,
              interval.start / safe,
              (leftEnd - interval.start) / safe,
            ),
          );
        }
        const rightStart = Math.max(interval.start, safe);
        if (interval.end - rightStart > 1e-6) {
          rightRuns.push(
            roadsideRunSpan(
              run,
              (rightStart - safe) / (1 - safe),
              (interval.end - rightStart) / (1 - safe),
            ),
          );
        }
      }
    }
    if (leftRuns.length > 0) {
      left.push({ ...spline, runs: leftRuns.sort((a, b) => a.start - b.start) });
    }
    if (rightRuns.length > 0) {
      right.push({ ...spline, runs: rightRuns.sort((a, b) => a.start - b.start) });
    }
  }
  return { left, right };
}

function mapRoadsideSplinesToOpen(
  splines: readonly ProjectRoadsideSpline[],
  startDistance: number,
  pathLength: number,
  total: number,
): ProjectRoadsideSpline[] {
  if (pathLength <= 1e-9 || total <= 1e-9) {
    return [];
  }
  const mapped: ProjectRoadsideSpline[] = [];
  for (const spline of splines) {
    const runs: ProjectRoadsideRun[] = [];
    for (const run of spline.runs) {
      for (const interval of roadsideRunIntervals(run, true)) {
        const start = interval.start * total;
        const end = interval.end * total;
        for (const offset of [-total, 0, total]) {
          const from = Math.max(start + offset, startDistance);
          const to = Math.min(end + offset, startDistance + pathLength);
          if (to - from <= 1e-6) {
            continue;
          }
          runs.push(
            roadsideRunSpan(
              run,
              Math.max(0, Math.min(1, (from - startDistance) / pathLength)),
              Math.max(0, Math.min(1, (to - from) / pathLength)),
            ),
          );
        }
      }
    }
    if (runs.length > 0) {
      mapped.push({ ...spline, runs: runs.sort((a, b) => a.start - b.start) });
    }
  }
  return mapped;
}

function mapRoadsideSplinesForMerge(
  splines: readonly ProjectRoadsideSpline[],
  reversed: boolean,
  startFraction: number,
  lengthFraction: number,
): ProjectRoadsideSpline[] {
  return splines.map((spline) => ({
    ...spline,
    side: reversed ? flipWallSide(spline.side) : spline.side,
    runs: spline.runs.map((run) => {
      const start = reversed ? 1 - (run.start + run.length) : run.start;
      return roadsideRunSpan(
        run,
        startFraction + start * lengthFraction,
        run.length * lengthFraction,
      );
    }),
  }));
}

function mergeRoadsideSplines(
  splines: readonly ProjectRoadsideSpline[],
): ProjectRoadsideSpline[] {
  const groups = new Map<string, ProjectRoadsideSpline>();
  for (const spline of splines) {
    const key = `${spline.side}:${spline.offset.toFixed(6)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.runs.push(...spline.runs);
    } else {
      groups.set(key, {
        ...spline,
        runs: [...spline.runs],
      });
    }
  }
  return [...groups.values()].map((spline) => ({
    ...spline,
    runs: spline.runs.sort((a, b) => a.start - b.start),
  }));
}

function splitKerbSpans(
  spans: readonly ProjectKerbSpan[],
  fraction: number,
): { left: ProjectKerbSpan[]; right: ProjectKerbSpan[] } {
  const safe = Math.max(1e-6, Math.min(1 - 1e-6, fraction));
  const left: ProjectKerbSpan[] = [];
  const right: ProjectKerbSpan[] = [];
  for (const span of spans) {
    for (const interval of spanIntervals(span, false)) {
      const leftEnd = Math.min(interval.end, safe);
      if (leftEnd - interval.start > 1e-6) {
        left.push({
          side: interval.side,
          start: interval.start / safe,
          length: (leftEnd - interval.start) / safe,
          ...(interval.flatHeight !== undefined ? { flatHeight: interval.flatHeight } : {}),
          ...(interval.cornerHeight !== undefined
            ? { cornerHeight: interval.cornerHeight }
            : {}),
        });
      }
      const rightStart = Math.max(interval.start, safe);
      if (interval.end - rightStart > 1e-6) {
        right.push({
          side: interval.side,
          start: (rightStart - safe) / (1 - safe),
          length: (interval.end - rightStart) / (1 - safe),
          ...(interval.flatHeight !== undefined ? { flatHeight: interval.flatHeight } : {}),
          ...(interval.cornerHeight !== undefined
            ? { cornerHeight: interval.cornerHeight }
            : {}),
        });
      }
    }
  }
  return {
    left: mergeKerbSpans(left, false),
    right: mergeKerbSpans(right, false),
  };
}

function mapKerbSpansToOpen(
  spans: readonly ProjectKerbSpan[],
  closed: boolean,
  startDistance: number,
  pathLength: number,
  total: number,
): ProjectKerbSpan[] {
  if (pathLength <= 1e-9 || total <= 1e-9) {
    return [];
  }
  const mapped: ProjectKerbSpan[] = [];
  for (const span of spans) {
    for (const interval of spanIntervals(span, closed)) {
      const start = interval.start * total;
      const end = interval.end * total;
      for (const offset of [-total, 0, total]) {
        const from = Math.max(start + offset, startDistance);
        const to = Math.min(end + offset, startDistance + pathLength);
        if (to - from <= 1e-6) {
          continue;
        }
        mapped.push({
          side: interval.side,
          start: Math.max(0, Math.min(1, (from - startDistance) / pathLength)),
          length: Math.max(0, Math.min(1, (to - from) / pathLength)),
          ...(interval.flatHeight !== undefined ? { flatHeight: interval.flatHeight } : {}),
          ...(interval.cornerHeight !== undefined
            ? { cornerHeight: interval.cornerHeight }
            : {}),
        });
      }
    }
  }
  return mergeKerbSpans(mapped, false);
}

function mapKerbSpansForMerge(
  spans: readonly ProjectKerbSpan[],
  reversed: boolean,
  startFraction: number,
  lengthFraction: number,
): ProjectKerbSpan[] {
  return spans.map((span) => {
    const start = reversed ? 1 - (span.start + span.length) : span.start;
    return {
      side: reversed ? flipKerbSide(span.side) : span.side,
      start: startFraction + start * lengthFraction,
      length: span.length * lengthFraction,
      ...(span.flatHeight !== undefined ? { flatHeight: span.flatHeight } : {}),
      ...(span.cornerHeight !== undefined ? { cornerHeight: span.cornerHeight } : {}),
    };
  });
}

function sectionEnd(
  project: Project,
  sectionId: string,
  pointIndex: number,
): SectionEnd | null {
  const sectionIndex = project.centerlines.findIndex(
    (candidate) => candidate.id === sectionId,
  );
  const section = project.centerlines[sectionIndex];
  const pointId = section?.pointIds[pointIndex];
  return section && pointId ? { section, sectionIndex, pointIndex, pointId } : null;
}

function junctionAt(
  project: Project,
  sectionId: string,
  pointId: string,
): ProjectJunction | undefined {
  return project.junctions.find((junction) =>
    (junction.members ?? []).some(
      (member) => member.section === sectionId && member.point === pointId,
    ),
  );
}

export function isSectionPointInJunction(
  project: Project,
  sectionId: string,
  pointId: string,
): boolean {
  return junctionAt(project, sectionId, pointId) !== undefined;
}

export function isLooseSectionEnd(
  project: Project,
  sectionId: string,
  pointIndex: number,
): boolean {
  const end = sectionEnd(project, sectionId, pointIndex);
  if (!end || end.section.closed) {
    return false;
  }
  if (pointIndex !== 0 && pointIndex !== end.section.points.length - 1) {
    return false;
  }
  return !isSectionPointInJunction(project, sectionId, end.pointId);
}

export function syncSectionJunctions(project: Project): void {
  for (const junction of project.junctions) {
    const members = junction.members;
    if (!members) {
      continue;
    }
    const anchor = sectionEnd(
      project,
      junction.centerline,
      project.centerlines
        .find((section) => section.id === junction.centerline)
        ?.pointIds.indexOf(junction.point) ?? -1,
    );
    if (!anchor) {
      continue;
    }
    const anchorPosition = anchor.section.points[anchor.pointIndex]!;
    for (const member of members) {
      if (member.section === junction.centerline && member.point === junction.point) {
        continue;
      }
      const section = project.centerlines.find(
        (candidate) => candidate.id === member.section,
      );
      const pointIndex = section?.pointIds.indexOf(member.point) ?? -1;
      if (section && pointIndex >= 0) {
        section.points[pointIndex] = [anchorPosition[0], anchorPosition[1]];
      }
    }
  }
}

function nextId(prefix: string, used: ReadonlySet<string>): string {
  let index = 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function nextPointId(used: ReadonlySet<string>, sectionId: string): string {
  let index = 0;
  let id = `${sectionId}-p${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${sectionId}-p${index}`;
  }
  return id;
}

function localTangent(section: ProjectCenterline, pointIndex: number): Vec2 {
  const points = section.points;
  const index = Math.max(0, Math.min(pointIndex, points.length - 1));
  if (points.length < 2) {
    return [1, 0];
  }
  if (index === 0) {
    return normalize2(sub2(points[1]!, points[0]!));
  }
  if (index === points.length - 1) {
    return normalize2(sub2(points[index]!, points[index - 1]!));
  }
  return normalize2(sub2(points[index + 1]!, points[index - 1]!));
}

function outwardDirection(section: ProjectCenterline, pointIndex: number): Vec2 {
  if (!section.closed) {
    return leftNormal(localTangent(section, pointIndex));
  }
  const fraction =
    fractionAtControlPoint(
      section.points as Vec2[],
      true,
      section.spline,
      pointIndex,
    ) ?? 0;
  const sampled = sampleCenterline(section.points as Vec2[], true, section.spline);
  const sample = samplePolyline(sampled, true, fraction);
  const side = signedArea2(sampled) > 0 ? -1 : 1;
  return scale2(leftNormal(sample.tangent), side);
}

function buildSectionAtPoint(
  source: Project,
  sectionId: string,
  pointIndex: number,
  direction: Vec2,
): SectionEditResult {
  const project = structuredClone(source);
  const end = sectionEnd(project, sectionId, pointIndex);
  if (!end) {
    return { ok: false, message: "Select a section control point." };
  }
  const position = end.section.points[end.pointIndex]!;
  const usedSections = new Set(project.centerlines.map((section) => section.id));
  const sectionIdNew = nextId("section", usedSections);
  const points: [number, number][] = [
    [position[0], position[1]],
    [position[0] + direction[0] * 30, position[1] + direction[1] * 30],
    [position[0] + direction[0] * 60, position[1] + direction[1] * 60],
  ];
  const usedPoints = new Set<string>();
  const pointIds = points.map(() => {
    const id = nextPointId(usedPoints, sectionIdNew);
    usedPoints.add(id);
    return id;
  });

  project.centerlines.push({
    id: sectionIdNew,
    closed: false,
    points,
    pointIds,
    spline: { type: "catmull-rom", samplesPerSegment: 12 },
  });

  const targetPointId = end.pointId;
  let junction = junctionAt(project, sectionId, targetPointId);
  if (!junction) {
    const usedJunctions = new Set(project.junctions.map((candidate) => candidate.id));
    junction = {
      id: nextId("junction", usedJunctions),
      centerline: sectionId,
      point: targetPointId,
      members: [
        { section: sectionId, point: targetPointId },
        { section: sectionIdNew, point: pointIds[0]! },
      ],
    };
    project.junctions.push(junction);
  } else {
    junction.members = [
      ...(junction.members ?? []),
      { section: sectionIdNew, point: pointIds[0]! },
    ];
  }

  return { ok: true, project };
}

export function addSectionAtPoint(
  source: Project,
  sectionId: string,
  pointIndex: number,
  flip = false,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Section authoring requires track-ed/project@3 or project@4." };
  }
  const end = sectionEnd(source, sectionId, pointIndex);
  if (!end) {
    return { ok: false, message: "Select a section control point." };
  }
  const outward = outwardDirection(end.section, end.pointIndex);
  return buildSectionAtPoint(
    source,
    sectionId,
    pointIndex,
    flip ? scale2(outward, -1) : outward,
  );
}

function buildLooseSectionAtPoint(
  source: Project,
  sectionId: string,
  pointIndex: number,
  direction: Vec2,
): SectionEditResult {
  const project = structuredClone(source);
  const end = sectionEnd(project, sectionId, pointIndex);
  if (!end) {
    return { ok: false, message: "Select a section control point." };
  }

  const position = end.section.points[end.pointIndex]!;
  const offset = source.road.shoulderHalfWidth * 2 + 20;
  const base = add2(position, scale2(direction, offset));
  const points: [number, number][] = [
    [base[0], base[1]],
    add2(base, scale2(direction, 30)),
    add2(base, scale2(direction, 60)),
  ];

  const usedSections = new Set(project.centerlines.map((section) => section.id));
  const sectionIdNew = nextId("section", usedSections);
  const usedPoints = new Set<string>();
  const pointIds = points.map(() => {
    const id = nextPointId(usedPoints, sectionIdNew);
    usedPoints.add(id);
    return id;
  });

  project.centerlines.push({
    id: sectionIdNew,
    closed: false,
    points,
    pointIds,
    spline: { type: "catmull-rom", samplesPerSegment: 12 },
  });

  return { ok: true, project };
}

export function addLooseSectionAtPoint(
  source: Project,
  sectionId: string,
  pointIndex: number,
  flip = false,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Section authoring requires track-ed/project@3 or project@4." };
  }
  const end = sectionEnd(source, sectionId, pointIndex);
  if (!end) {
    return { ok: false, message: "Select a section control point." };
  }
  const outward = outwardDirection(end.section, end.pointIndex);
  return buildLooseSectionAtPoint(
    source,
    sectionId,
    pointIndex,
    flip ? scale2(outward, -1) : outward,
  );
}

export function addJunctionMember(
  source: Project,
  targetSectionId: string,
  targetPointId: string,
  memberSectionId: string,
  memberPointId: string,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Junction authoring requires track-ed/project@3 or project@4." };
  }
  if (targetSectionId === memberSectionId) {
    return { ok: false, message: "A section cannot join itself." };
  }
  const project = structuredClone(source);
  const targetSection = project.centerlines.find(
    (section) => section.id === targetSectionId,
  );
  const memberSection = project.centerlines.find(
    (section) => section.id === memberSectionId,
  );
  const targetIndex = targetSection?.pointIds.indexOf(targetPointId) ?? -1;
  const memberIndex = memberSection?.pointIds.indexOf(memberPointId) ?? -1;
  if (!targetSection || targetIndex < 0 || !memberSection || memberIndex < 0) {
    return { ok: false, message: "The junction target no longer exists." };
  }
  if (
    memberSection.closed ||
    (memberIndex !== 0 && memberIndex !== memberSection.points.length - 1)
  ) {
    return { ok: false, message: "Only loose section ends can join a junction." };
  }
  if (isSectionPointInJunction(project, memberSectionId, memberPointId)) {
    return { ok: false, message: "The section end is already attached." };
  }

  const targetPosition = targetSection.points[targetIndex]!;
  memberSection.points[memberIndex] = [targetPosition[0], targetPosition[1]];

  const junction = junctionAt(project, targetSectionId, targetPointId);
  if (junction) {
    if (
      (junction.members ?? []).some((member) => member.section === memberSectionId)
    ) {
      return {
        ok: false,
        message: "A junction cannot contain two points from the same section.",
      };
    }
    junction.members = [
      ...(junction.members ?? []),
      { section: memberSectionId, point: memberPointId },
    ];
  } else {
    const used = new Set(project.junctions.map((candidate) => candidate.id));
    project.junctions.push({
      id: nextId("junction", used),
      centerline: targetSectionId,
      point: targetPointId,
      members: [
        { section: targetSectionId, point: targetPointId },
        { section: memberSectionId, point: memberPointId },
      ],
    });
  }

  return { ok: true, project };
}

function pointIndexFromMember(
  project: Project,
  member: ProjectJunctionMember,
): { section: ProjectCenterline; pointIndex: number } | null {
  const section = project.centerlines.find(
    (candidate) => candidate.id === member.section,
  );
  const pointIndex = section?.pointIds.indexOf(member.point) ?? -1;
  return section && pointIndex >= 0 ? { section, pointIndex } : null;
}

export function removeJunctionWithGap(
  source: Project,
  junctionId: string,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Junction removal requires track-ed/project@3 or project@4." };
  }
  const project = structuredClone(source);
  const junction = project.junctions.find((candidate) => candidate.id === junctionId);
  if (!junction?.members) {
    return { ok: false, message: "The junction no longer exists." };
  }
  syncSectionJunctions(project);
  for (const member of junction.members) {
    if (member.section === junction.centerline && member.point === junction.point) {
      continue;
    }
    const located = pointIndexFromMember(project, member);
    if (!located) {
      return { ok: false, message: "A junction member no longer exists." };
    }
    const { section, pointIndex } = located;
    const last = section.points.length - 1;
    if (pointIndex !== 0 && pointIndex !== last) {
      return {
        ok: false,
        message: "Cannot detach a junction from an interior section point.",
      };
    }
    if (section.points.length <= 2) {
      return {
        ok: false,
        message: "A two-point section cannot be detached without deleting it.",
      };
    }
    section.points.splice(pointIndex, 1);
    section.pointIds.splice(pointIndex, 1);
    delete section.spline;
  }

  project.junctions = project.junctions.filter(
    (candidate) => candidate.id !== junctionId,
  );
  syncSectionJunctions(project);
  return { ok: true, project };
}

export function splitOpenSection(
  source: Project,
  sectionId: string,
  pointIndex: number,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Section splitting requires track-ed/project@3 or project@4." };
  }
  const sourceSection = source.centerlines.find(
    (candidate) => candidate.id === sectionId,
  );
  if (!sourceSection || sourceSection.closed) {
    return { ok: false, message: "Select an open section control point to split." };
  }
  const count = sourceSection.points.length;
  if (pointIndex <= 0 || pointIndex >= count - 1) {
    return { ok: false, message: "Select an interior control point to split." };
  }
  const splitPointId = sourceSection.pointIds[pointIndex]!;
  if (isSectionPointInJunction(source, sectionId, splitPointId)) {
    return {
      ok: false,
      message: "Detach the junction from this point before splitting the section.",
    };
  }

  const current = sourceSection.points[pointIndex]!;
  const previous = sourceSection.points[pointIndex - 1]!;
  const next = sourceSection.points[pointIndex + 1]!;
  const incoming = normalize2(sub2(previous, current));
  const outgoing = normalize2(sub2(next, current));
  const incomingLength = Math.hypot(
    current[0] - previous[0],
    current[1] - previous[1],
  );
  const outgoingLength = Math.hypot(next[0] - current[0], next[1] - current[1]);
  const spread = Math.hypot(outgoing[0] - incoming[0], outgoing[1] - incoming[1]);
  if (spread < 1e-9) {
    return { ok: false, message: "The adjacent segments are collinear." };
  }
  const baseGap = source.road.halfWidth * 2;
  const maximumGap = Math.min(incomingLength, outgoingLength) * spread * 0.9;

  const usedSections = new Set(source.centerlines.map((section) => section.id));
  const rightId = nextId("section", usedSections);

  for (let gap = baseGap; gap <= maximumGap; gap += 2) {
    const half = gap / spread;
    if (half >= incomingLength || half >= outgoingLength) {
      continue;
    }
    const leftEnd = add2(current, scale2(incoming, half));
    const rightStart = add2(current, scale2(outgoing, half));

    const candidate = structuredClone(source);
    const original = candidate.centerlines.find(
      (section) => section.id === sectionId,
    );
    if (!original) {
      continue;
    }
    const leftPoints: [number, number][] = original.points
      .slice(0, pointIndex)
      .map((point) => [point[0], point[1]]);
    const leftIds = original.pointIds.slice(0, pointIndex);
    const rightPoints: [number, number][] = [
      [rightStart[0], rightStart[1]],
      ...original.points
        .slice(pointIndex + 1)
        .map((point) => [point[0], point[1]] as [number, number]),
    ];
    const rightIds = original.pointIds.slice(pointIndex + 1);

    const usedLeft = new Set(leftIds);
    const leftEndId = nextPointId(usedLeft, sectionId);
    const usedRight = new Set(rightIds);
    const rightStartId = nextPointId(usedRight, rightId);
    leftPoints.push([leftEnd[0], leftEnd[1]]);
    leftIds.push(leftEndId);
    rightIds.unshift(rightStartId);

    const splitFraction =
      fractionAtControlPoint(
        sourceSection.points as Vec2[],
        false,
        sourceSection.spline,
        pointIndex,
      ) ?? 0.5;
    const splitKerbs = splitKerbSpans(sourceSection.kerbs ?? [], splitFraction);
    const splitWalls = splitWallSpans(sourceSection.walls ?? [], splitFraction);
    const splitProps = splitPropSpans(sourceSection.props ?? [], splitFraction);
    const splitRoadside = splitRoadsideSplines(
      sourceSection.roadside ?? [],
      splitFraction,
    );
    original.points = leftPoints;
    original.pointIds = leftIds;
    if (splitKerbs.left.length > 0) {
      original.kerbs = splitKerbs.left;
    } else {
      delete original.kerbs;
    }
    if (splitWalls.left.length > 0) {
      original.walls = splitWalls.left;
    } else {
      delete original.walls;
    }
    if (splitProps.left.length > 0) {
      original.props = splitProps.left;
    } else {
      delete original.props;
    }
    if (splitRoadside.left.length > 0) {
      original.roadside = splitRoadside.left;
    } else {
      delete original.roadside;
    }
    candidate.centerlines.push({
      id: rightId,
      closed: false,
      points: rightPoints,
      pointIds: rightIds,
      ...(original.spline ? { spline: original.spline } : {}),
      ...(splitKerbs.right.length > 0 ? { kerbs: splitKerbs.right } : {}),
      ...(splitWalls.right.length > 0 ? { walls: splitWalls.right } : {}),
      ...(splitProps.right.length > 0 ? { props: splitProps.right } : {}),
      ...(splitRoadside.right.length > 0
        ? { roadside: splitRoadside.right }
        : {}),
    });

    const leftIdSet = new Set(leftIds);
    const rightIdSet = new Set(rightIds);
    for (const junction of candidate.junctions) {
      junction.members = (junction.members ?? []).map((member) => {
        if (member.section !== sectionId) {
          return member;
        }
        if (member.point === splitPointId) {
          return member;
        }
        if (rightIdSet.has(member.point) && !leftIdSet.has(member.point)) {
          return { section: rightId, point: member.point };
        }
        return member;
      });
    }

    if (candidate.spawn.centerline === sectionId) {
      if (candidate.spawn.fraction > splitFraction) {
        candidate.spawn.centerline = rightId;
      }
    }

    try {
      const report = validateBakedTrack(bakeProject(structuredClone(candidate)));
      if (report.ok) {
        return { ok: true, project: candidate };
      }
    } catch {
      // Try a wider gap.
    }
  }

  return { ok: false, message: "Could not split this section cleanly." };
}

export function closeSectionLoop(
  source: Project,
  sectionId: string,
  draggedPointIndex: number,
  targetPointIndex: number,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Closing a loop requires track-ed/project@3 or project@4." };
  }
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  if (!section || section.closed) {
    return { ok: false, message: "Select an open section end to close." };
  }
  const last = section.points.length - 1;
  if (
    !(
      (draggedPointIndex === 0 && targetPointIndex === last) ||
      (draggedPointIndex === last && targetPointIndex === 0)
    )
  ) {
    return { ok: false, message: "Close a loop by joining its two loose ends." };
  }
  if (
    !isLooseSectionEnd(source, sectionId, draggedPointIndex) ||
    !isLooseSectionEnd(source, sectionId, targetPointIndex)
  ) {
    return { ok: false, message: "Both section ends must be loose to close the loop." };
  }
  if (section.points.length <= 3) {
    return {
      ok: false,
      message: "The section needs more than three points to close into a loop.",
    };
  }

  const project = structuredClone(source);
  const candidate = project.centerlines.find(
    (candidateSection) => candidateSection.id === sectionId,
  )!;
  const target = candidate.points[targetPointIndex]!;
  candidate.points[draggedPointIndex] = [target[0], target[1]];
  candidate.points.splice(draggedPointIndex, 1);
  candidate.pointIds.splice(draggedPointIndex, 1);
  candidate.closed = true;
  if (candidate.kerbs) {
    candidate.kerbs = mergeKerbSpans(candidate.kerbs, true);
    if (candidate.kerbs.length === 0) {
      delete candidate.kerbs;
    }
  }
  if (candidate.walls) {
    candidate.walls = mergeWallSpans(candidate.walls, true);
    if (candidate.walls.length === 0) {
      delete candidate.walls;
    }
  }
  if (candidate.props) {
    candidate.props = mergePropSpans(candidate.props, true);
    if (candidate.props.length === 0) {
      delete candidate.props;
    }
  }
  return { ok: true, project };
}

export function mergeLooseSectionEnds(
  source: Project,
  sectionAId: string,
  pointAIndex: number,
  sectionBId: string,
  pointBIndex: number,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Section merging requires track-ed/project@3 or project@4." };
  }
  if (sectionAId === sectionBId) {
    return { ok: false, message: "Select two different sections to merge." };
  }
  if (
    !isLooseSectionEnd(source, sectionAId, pointAIndex) ||
    !isLooseSectionEnd(source, sectionBId, pointBIndex)
  ) {
    return { ok: false, message: "Both section ends must be loose before merging." };
  }

  const project = structuredClone(source);
  const a = sectionEnd(project, sectionAId, pointAIndex)!;
  const b = sectionEnd(project, sectionBId, pointBIndex)!;
  const aReversed = pointAIndex === 0;
  const bReversed = pointBIndex !== 0;

  const aPoints = a.section.points.map((point) => [point[0], point[1]] as [number, number]);
  const aPointIds = [...a.section.pointIds];
  if (aReversed) {
    aPoints.reverse();
    aPointIds.reverse();
  }
  const bPoints = b.section.points.map((point) => [point[0], point[1]] as [number, number]);
  const bPointIds = [...b.section.pointIds];
  if (bReversed) {
    bPoints.reverse();
    bPointIds.reverse();
  }

  const target = bPoints[0]!;
  aPoints[aPoints.length - 1] = [target[0], target[1]];

  const used = new Set(aPointIds);
  const pointRemap = new Map<string, string>();
  for (let index = 1; index < bPoints.length; index += 1) {
    const oldId = bPointIds[index]!;
    let id = oldId;
    if (used.has(id)) {
      id = nextPointId(used, a.section.id);
    }
    used.add(id);
    pointRemap.set(oldId, id);
    aPoints.push([bPoints[index]![0], bPoints[index]![1]]);
    aPointIds.push(id);
  }

  const joinId = bPointIds[0]!;
  if (junctionAt(project, b.section.id, joinId)) {
    return { ok: false, message: "The merge target is still attached." };
  }

  for (const junction of project.junctions) {
    junction.members = (junction.members ?? []).map((member) => {
      if (member.section !== b.section.id) {
        return member;
      }
      return {
        section: a.section.id,
        point: pointRemap.get(member.point) ?? member.point,
      };
    });
  }

  const lengthA = centerlineLength(
    sampleCenterline(a.section.points as Vec2[], false, a.section.spline),
    false,
  );
  const lengthB = centerlineLength(
    sampleCenterline(b.section.points as Vec2[], false, b.section.spline),
    false,
  );
  if (project.spawn.centerline === a.section.id) {
    if (aReversed) {
      project.spawn.fraction = 1 - project.spawn.fraction;
    }
  } else if (project.spawn.centerline === b.section.id) {
    const fraction = bReversed ? 1 - project.spawn.fraction : project.spawn.fraction;
    project.spawn.centerline = a.section.id;
    project.spawn.fraction = Math.max(
      0,
      Math.min(0.999, (lengthA + fraction * lengthB) / (lengthA + lengthB)),
    );
  }

  const mergedLength = lengthA + lengthB;
  const mergedKerbs = mergeKerbSpans([
    ...mapKerbSpansForMerge(
      a.section.kerbs ?? [],
      aReversed,
      0,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
    ),
    ...mapKerbSpansForMerge(
      b.section.kerbs ?? [],
      bReversed,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
      mergedLength > 0 ? lengthB / mergedLength : 0.5,
    ),
  ]);
  const mergedWalls = mergeWallSpans([
    ...mapWallSpansForMerge(
      a.section.walls ?? [],
      aReversed,
      0,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
    ),
    ...mapWallSpansForMerge(
      b.section.walls ?? [],
      bReversed,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
      mergedLength > 0 ? lengthB / mergedLength : 0.5,
    ),
  ]);
  const mergedProps = mergePropSpans([
    ...mapPropSpansForMerge(
      a.section.props ?? [],
      aReversed,
      0,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
    ),
    ...mapPropSpansForMerge(
      b.section.props ?? [],
      bReversed,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
      mergedLength > 0 ? lengthB / mergedLength : 0.5,
    ),
  ]);
  const mergedRoadside = mergeRoadsideSplines([
    ...mapRoadsideSplinesForMerge(
      a.section.roadside ?? [],
      aReversed,
      0,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
    ),
    ...mapRoadsideSplinesForMerge(
      b.section.roadside ?? [],
      bReversed,
      mergedLength > 0 ? lengthA / mergedLength : 0.5,
      mergedLength > 0 ? lengthB / mergedLength : 0.5,
    ),
  ]);
  a.section.points = aPoints;
  a.section.pointIds = aPointIds;
  if (mergedKerbs.length > 0) {
    a.section.kerbs = mergedKerbs;
  } else {
    delete a.section.kerbs;
  }
  if (mergedWalls.length > 0) {
    a.section.walls = mergedWalls;
  } else {
    delete a.section.walls;
  }
  if (mergedProps.length > 0) {
    a.section.props = mergedProps;
  } else {
    delete a.section.props;
  }
  if (mergedRoadside.length > 0) {
    a.section.roadside = mergedRoadside;
  } else {
    delete a.section.roadside;
  }
  if (!a.section.spline && b.section.spline) {
    a.section.spline = b.section.spline;
  }
  project.centerlines = project.centerlines.filter(
    (candidate) => candidate.id !== b.section.id,
  );
  syncSectionJunctions(project);
  return { ok: true, project };
}

function simplifyOpenPolyline(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length <= 2) {
    return points.map((point) => [point[0], point[1]]);
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const toleranceSq = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let farthest = -1;
    let farthestDistance = toleranceSq;
    const a = points[start]!;
    const b = points[end]!;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distancePointToSegmentSq(points[index]!, a, b);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1).map((point) => [point[0], point[1]]);
}

export function splitClosedSection(
  source: Project,
  sectionId: string,
  pointIndex: number,
): SectionEditResult {
  if (!isVenueSchema(source.schema)) {
    return { ok: false, message: "Loop splitting requires track-ed/project@3 or project@4." };
  }
  const sourceEnd = sectionEnd(source, sectionId, pointIndex);
  if (!sourceEnd || !sourceEnd.section.closed) {
    return { ok: false, message: "Select a closed section control point to split." };
  }
  if (
    source.junctions.some((junction) =>
      (junction.members ?? []).some((member) => member.section === sectionId),
    )
  ) {
    return {
      ok: false,
      message: "Detach all junctions from the loop before splitting it.",
    };
  }

  const section = sourceEnd.section;
  const points = section.points;
  const count = points.length;
  const index = sourceEnd.pointIndex;
  const minimumGap = source.road.halfWidth * 2;
  const clearance = source.road.shoulderHalfWidth;

  const sampled = sampleCenterline(points as Vec2[], true, section.spline);
  const total = centerlineLength(sampled, true);
  const fractions = points.map(
    (_, pointIndex) =>
      fractionAtControlPoint(points as Vec2[], true, section.spline, pointIndex) ?? 0,
  );

  const segmentStarts = [index, (index - 1 + count) % count]
    .map((startIndex) => {
      const endIndex = (startIndex + 1) % count;
      const start = points[startIndex]!;
      const end = points[endIndex]!;
      return {
        startIndex,
        endIndex,
        start,
        end,
        length: Math.hypot(end[0] - start[0], end[1] - start[1]),
      };
    })
    .filter((segment) => segment.length > 0)
    .sort((a, b) => b.length - a.length);

  const isCandidateValid = (candidate: Project): boolean => {
    const candidateSection = candidate.centerlines.find(
      (candidateCenterline) => candidateCenterline.id === sectionId,
    );
    if (!candidateSection) {
      return false;
    }
    const quickProject: Project = {
      ...candidate,
      centerlines: [structuredClone(candidateSection)],
      junctions: [],
      spawn: { centerline: sectionId, fraction: 0.2, lateral: 0 },
      cameras: [],
      terrain: { margin: candidate.terrain.margin, mode: "conform" },
    };
    try {
      if (!validateBakedTrack(bakeProject(quickProject)).ok) {
        return false;
      }
    } catch {
      return false;
    }
    try {
      return validateBakedTrack(bakeProject(structuredClone(candidate))).ok;
    } catch {
      return false;
    }
  };

  const attempt = (
    segment: (typeof segmentStarts)[number],
    gap: number,
  ): Project | null => {
    const direction = normalize2(sub2(segment.end, segment.start));
    const segmentFraction =
      (fractions[segment.endIndex]! - fractions[segment.startIndex]! + 1) % 1;
    const segmentDistance = segmentFraction * total;
    const start = add2(
      segment.start,
      scale2(direction, segment.length / 2 + gap / 2),
    );
    const endPoint = add2(
      segment.start,
      scale2(direction, segment.length / 2 - gap / 2),
    );

    const newPoints: [number, number][] = [[start[0], start[1]]];
    const newPointIds: string[] = [];
    for (let step = 0; step < count; step += 1) {
      const sourceIndex = (segment.endIndex + step) % count;
      const point = points[sourceIndex]!;
      const id = section.pointIds[sourceIndex]!;
      newPoints.push([point[0], point[1]]);
      newPointIds.push(id);
    }
    newPoints.push([endPoint[0], endPoint[1]]);

    const used = new Set(newPointIds);
    const startId = nextPointId(used, section.id);
    used.add(startId);
    const endId = nextPointId(used, section.id);
    newPointIds.unshift(startId);
    newPointIds.push(endId);

    const candidate = structuredClone(source);
    const candidateSection = candidate.centerlines.find(
      (candidateCenterline) => candidateCenterline.id === sectionId,
    );
    if (!candidateSection) {
      return null;
    }
    const distanceWithin = (segment.length / 2 + gap / 2) / segment.length;
    const startDistance =
      (fractions[segment.startIndex]! * total + segmentDistance * distanceWithin) %
      total;
    const pathLength = Math.max(1e-9, total - gap);
    if (candidate.spawn.centerline === sectionId) {
      const spawnDistance = candidate.spawn.fraction * total;
      const forward = (spawnDistance - startDistance + total) % total;
      candidate.spawn.fraction =
        forward <= pathLength ? Math.min(0.999, forward / pathLength) : 0;
    }
    candidateSection.closed = false;
    candidateSection.points = newPoints;
    candidateSection.pointIds = newPointIds;
    const kerbs = mapKerbSpansToOpen(
      section.kerbs ?? [],
      true,
      startDistance,
      pathLength,
      total,
    );
    if (kerbs.length > 0) {
      candidateSection.kerbs = kerbs;
    } else {
      delete candidateSection.kerbs;
    }
    const walls = mapWallSpansToOpen(
      section.walls ?? [],
      true,
      startDistance,
      pathLength,
      total,
    );
    if (walls.length > 0) {
      candidateSection.walls = walls;
    } else {
      delete candidateSection.walls;
    }
    const props = mapPropSpansToOpen(
      section.props ?? [],
      true,
      startDistance,
      pathLength,
      total,
    );
    if (props.length > 0) {
      candidateSection.props = props;
    } else {
      delete candidateSection.props;
    }
    const roadside = mapRoadsideSplinesToOpen(
      section.roadside ?? [],
      startDistance,
      pathLength,
      total,
    );
    if (roadside.length > 0) {
      candidateSection.roadside = roadside;
    } else {
      delete candidateSection.roadside;
    }

    return isCandidateValid(candidate) ? candidate : null;
  };

  for (const segment of segmentStarts) {
    const maximumGap = segment.length - clearance * 2;
    if (maximumGap < minimumGap) {
      continue;
    }
    const preferred = Math.min(
      maximumGap,
      Math.max(minimumGap + 2, minimumGap + clearance * 2),
    );
    const gaps = new Set<number>([minimumGap, preferred, maximumGap]);
    for (const offset of [2, 4, 6, 8]) {
      if (preferred + offset <= maximumGap) {
        gaps.add(preferred + offset);
      }
    }
    for (const gap of [...gaps].sort((a, b) => a - b)) {
      const candidate = attempt(segment, gap);
      if (candidate) {
        return { ok: true, project: candidate };
      }
    }
  }

  const cumulative: number[] = [0];
  for (let index = 0; index < sampled.length; index += 1) {
    const a = sampled[index]!;
    const b = sampled[(index + 1) % sampled.length]!;
    cumulative.push(cumulative[index]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }

  const splitFraction = fractions[index]!;
  const buildSampledCandidate = (gap: number, tolerance: number): Project | null => {
    const startFraction = (splitFraction + gap / (2 * total)) % 1;
    const endFraction = (splitFraction - gap / (2 * total) + 1) % 1;
    const startDistance = startFraction * total;
    const endDistance = endFraction * total;
    const start = samplePolyline(sampled, true, startFraction).position;
    const endPoint = samplePolyline(sampled, true, endFraction).position;
    const rawPoints: Vec2[] = [[start[0], start[1]]];
    const addVerticesBetween = (lower: number, upper: number): void => {
      for (let index = 0; index < sampled.length; index += 1) {
        const distance = cumulative[index]!;
        if (distance > lower + 1e-9 && distance < upper - 1e-9) {
          rawPoints.push(sampled[index]!);
        }
      }
    };
    if (startDistance < endDistance) {
      addVerticesBetween(startDistance, endDistance);
    } else {
      addVerticesBetween(startDistance, total);
      addVerticesBetween(0, endDistance);
    }
    rawPoints.push([endPoint[0], endPoint[1]]);
    const pointsForCandidate =
      tolerance > 0 ? simplifyOpenPolyline(rawPoints, tolerance) : rawPoints;

    const pathLength = Math.max(1e-9, total - gap);
    const candidate = structuredClone(source);
    const candidateSection = candidate.centerlines.find(
      (candidateCenterline) => candidateCenterline.id === sectionId,
    );
    if (!candidateSection || pointsForCandidate.length < 2) {
      return null;
    }
    if (candidate.spawn.centerline === sectionId) {
      const spawnDistance = candidate.spawn.fraction * total;
      const pathLength = Math.max(1e-9, total - gap);
      const forward = (spawnDistance - startDistance + total) % total;
      candidate.spawn.fraction =
        forward <= pathLength ? Math.min(0.999, forward / pathLength) : 0;
    }
    const used = new Set<string>();
    const pointIds = pointsForCandidate.map(() => {
      const id = nextPointId(used, section.id);
      used.add(id);
      return id;
    });
    candidateSection.closed = false;
    candidateSection.points = pointsForCandidate.map((point) => [point[0], point[1]]);
    candidateSection.pointIds = pointIds;
    const kerbs = mapKerbSpansToOpen(
      section.kerbs ?? [],
      true,
      startDistance,
      pathLength,
      total,
    );
    if (kerbs.length > 0) {
      candidateSection.kerbs = kerbs;
    } else {
      delete candidateSection.kerbs;
    }
    const walls = mapWallSpansToOpen(
      section.walls ?? [],
      true,
      startDistance,
      pathLength,
      total,
    );
    if (walls.length > 0) {
      candidateSection.walls = walls;
    } else {
      delete candidateSection.walls;
    }
    const props = mapPropSpansToOpen(
      section.props ?? [],
      true,
      startDistance,
      pathLength,
      total,
    );
    if (props.length > 0) {
      candidateSection.props = props;
    } else {
      delete candidateSection.props;
    }
    const roadside = mapRoadsideSplinesToOpen(
      section.roadside ?? [],
      startDistance,
      pathLength,
      total,
    );
    if (roadside.length > 0) {
      candidateSection.roadside = roadside;
    } else {
      delete candidateSection.roadside;
    }

    return isCandidateValid(candidate) ? candidate : null;
  };

  const sampledGaps = new Set<number>([
    minimumGap,
    20,
    24,
    28,
    32,
    36,
    40,
    48,
    56,
    64,
  ]);
  const gapsToTry = [...sampledGaps]
    .filter((value) => value < total * 0.35)
    .sort((a, b) => a - b);
  for (const tolerance of [5, 4, 3, 2, 1.5, 1, 0.5, 0.25, 0]) {
    for (const gap of gapsToTry) {
      const candidate = buildSampledCandidate(gap, tolerance);
      if (candidate) {
        return { ok: true, project: candidate };
      }
    }
  }

  return { ok: false, message: "Could not find a clean split gap on this loop." };
}
