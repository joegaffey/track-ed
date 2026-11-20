import * as THREE from "three";
import type { Vec3 } from "../../model/baked-track";
import {
  distancePointToSegmentSq,
  pointOnSegmentParameter,
  type Vec2,
} from "../../kernel/math2";
import type {
  CenterlineSegmentPick,
  ControlPointPick,
  KerbHandlePick,
  KerbRailPick,
  PickResult,
  SceneState,
} from "./types";

export function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.hypot(nx, ny, nz) / 2;
}

export function pickGround(state: SceneState, x: number, y: number): Vec2 | null {
  state.pointer.set(x, y);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const intersection = new THREE.Vector3();
  if (!state.raycaster.ray.intersectPlane(state.groundPlane, intersection)) {
    return null;
  }
  return [intersection.x, intersection.z];
}

export function pickSurface(state: SceneState, x: number, y: number): PickResult | null {
  const pickMeshes = [state.surfaceMesh, state.kerbMesh, state.wallMesh].filter(
    (mesh): mesh is THREE.Mesh => mesh !== null,
  );
  if (pickMeshes.length === 0) {
    return null;
  }
  state.pointer.set(x, y);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const hits = state.raycaster.intersectObjects(pickMeshes, false);
  const hit = hits[0];
  if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) {
    return null;
  }
  const graph =
    hit.object === state.kerbMesh
      ? state.track.kerbGraph
      : hit.object === state.wallMesh
        ? state.track.wallGraph
        : state.track.surfaceGraph;
  if (!graph) {
    return null;
  }
  const triangle: number = hit.faceIndex;
  const surfaceId = graph.triangleSurfaces[triangle];
  const surface = state.track.surfaces.find((candidate) => candidate.id === surfaceId);
  if (surfaceId === undefined || !surface) {
    return null;
  }
  const a = graph.positions[graph.indices[triangle * 3]!]!;
  const b = graph.positions[graph.indices[triangle * 3 + 1]!]!;
  const c = graph.positions[graph.indices[triangle * 3 + 2]!]!;
  return {
    triangle,
    surfaceId,
    surfaceName: surface.name,
    area: triangleArea(a, b, c),
    point: [hit.point.x, hit.point.y, hit.point.z],
  };
}

export function pickControlPoint(
  state: SceneState,
  x: number,
  y: number,
): ControlPointPick | null {
  const width = Math.max(state.renderer.domElement.clientWidth, 1);
  const height = Math.max(state.renderer.domElement.clientHeight, 1);
  const projected = new THREE.Vector3();
  let best: {
    centerlineIndex: number;
    pointIndex: number;
    distance: number;
    closed: boolean;
  } | null = null;

  for (
    let centerlineIndex = 0;
    centerlineIndex < state.centerlines.length;
    centerlineIndex += 1
  ) {
    const centerline = state.centerlines[centerlineIndex]!;
    for (let pointIndex = 0; pointIndex < centerline.points.length; pointIndex += 1) {
      const point = centerline.points[pointIndex]!;
      projected
        .set(point[0], (centerline.pointHeights?.[pointIndex] ?? 0) + 0.16, point[1])
        .project(state.camera);
      if (projected.z < -1 || projected.z > 1) {
        continue;
      }
      const dx = (projected.x - x) * (width / 2);
      const dy = (projected.y - y) * (height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance > 14) {
        continue;
      }
      const better =
        !best ||
        distance < best.distance - 3 ||
        (Math.abs(distance - best.distance) <= 3 && !centerline.closed && best.closed);
      if (better) {
        best = {
          centerlineIndex,
          pointIndex,
          distance,
          closed: centerline.closed,
        };
      }
    }
  }

  return best
    ? { centerlineIndex: best.centerlineIndex, pointIndex: best.pointIndex }
    : null;
}

export function pickTerrainPoint(state: SceneState, x: number, y: number): number | null {
  const width = Math.max(state.renderer.domElement.clientWidth, 1);
  const height = Math.max(state.renderer.domElement.clientHeight, 1);
  const projected = new THREE.Vector3();
  let best: { index: number; distance: number } | null = null;

  for (let index = 0; index < state.terrainPoints.length; index += 1) {
    const point = state.terrainPoints[index]!;
    projected
      .set(point.position[0], point.height + 0.3, point.position[1])
      .project(state.camera);
    if (projected.z < -1 || projected.z > 1) {
      continue;
    }
    const dx = (projected.x - x) * (width / 2);
    const dy = (projected.y - y) * (height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance <= 14 && (!best || distance < best.distance)) {
      best = { index, distance };
    }
  }

  return best ? best.index : null;
}

export function pickSpawn(state: SceneState, x: number, y: number): boolean {
  const spawn = state.activeSpawn;
  if (!spawn) {
    return false;
  }
  const width = Math.max(state.renderer.domElement.clientWidth, 1);
  const height = Math.max(state.renderer.domElement.clientHeight, 1);
  const base = new THREE.Vector3(
    spawn.position[0],
    spawn.position[1] + 0.1,
    spawn.position[2],
  );
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(
      spawn.rotation[0],
      spawn.rotation[1],
      spawn.rotation[2],
      spawn.rotation[3],
    ),
  );
  const tip = base.clone().addScaledVector(direction, 9);
  const baseProjected = base.clone().project(state.camera);
  const tipProjected = tip.clone().project(state.camera);
  if (
    (baseProjected.z < -1 || baseProjected.z > 1) &&
    (tipProjected.z < -1 || tipProjected.z > 1)
  ) {
    return false;
  }

  const baseX = (baseProjected.x - x) * (width / 2);
  const baseY = (baseProjected.y - y) * (height / 2);
  const tipX = (tipProjected.x - x) * (width / 2);
  const tipY = (tipProjected.y - y) * (height / 2);
  const segmentX = tipX - baseX;
  const segmentY = tipY - baseY;
  const lengthSq = segmentX * segmentX + segmentY * segmentY;
  const t =
    lengthSq > 0
      ? Math.max(0, Math.min(1, -(baseX * segmentX + baseY * segmentY) / lengthSq))
      : 0;
  const closestX = baseX + segmentX * t;
  const closestY = baseY + segmentY * t;
  return Math.hypot(closestX, closestY) <= 16;
}

export function pickKerbRail(state: SceneState, x: number, y: number): KerbRailPick | null {
  const width = Math.max(state.renderer.domElement.clientWidth, 1);
  const height = Math.max(state.renderer.domElement.clientHeight, 1);
  const targetX = (x * 0.5 + 0.5) * width;
  const targetY = (-y * 0.5 + 0.5) * height;
  const projected = new THREE.Vector3();
  let best: {
    kind: KerbRailPick["kind"];
    sectionId: string;
    splineId?: string;
    side: "left" | "right";
    offset?: number;
    fraction: number;
  } | null = null;
  let bestDistance = 14;
  for (const rail of state.kerbRailPickables) {
    if (rail.points.length < 2) {
      continue;
    }
    const points = rail.points.map((point) => {
      projected.set(point[0], point[1], point[2]).project(state.camera);
      return {
        x: (projected.x * 0.5 + 0.5) * width,
        y: (-projected.y * 0.5 + 0.5) * height,
        z: projected.z,
      };
    });
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index]!;
      const b = points[index + 1]!;
      if ((a.z < -1 || a.z > 1) && (b.z < -1 || b.z > 1)) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq > 1e-6
          ? Math.max(
              0,
              Math.min(
                1,
                ((targetX - a.x) * dx + (targetY - a.y) * dy) / lengthSq,
              ),
            )
          : 0;
      const distance = Math.hypot(
        targetX - (a.x + dx * t),
        targetY - (a.y + dy * t),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          kind: rail.kind,
          sectionId: rail.sectionId,
          ...(rail.splineId !== undefined ? { splineId: rail.splineId } : {}),
          side: rail.side,
          ...(rail.offset !== undefined ? { offset: rail.offset } : {}),
          fraction: Math.max(
            0,
            Math.min(1, (index + t) / (rail.points.length - 1)),
          ),
        };
      }
    }
  }
  return best;
}

export function pickKerbHandle(
  state: SceneState,
  x: number,
  y: number,
): KerbHandlePick | null {
  const width = Math.max(state.renderer.domElement.clientWidth, 1);
  const height = Math.max(state.renderer.domElement.clientHeight, 1);
  const targetX = (x * 0.5 + 0.5) * width;
  const targetY = (-y * 0.5 + 0.5) * height;
  const projected = new THREE.Vector3();
  let best: KerbHandlePick | null = null;
  let bestDistance = 15;
  for (const handle of state.kerbHandlePickables) {
    projected
      .set(handle.position[0], handle.position[1], handle.position[2])
      .project(state.camera);
    if (projected.z < -1 || projected.z > 1) {
      continue;
    }
    const screenX = (projected.x * 0.5 + 0.5) * width;
    const screenY = (-projected.y * 0.5 + 0.5) * height;
    const distance = Math.hypot(screenX - targetX, screenY - targetY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        kind: handle.kind,
        sectionId: handle.sectionId,
        ...(handle.splineId !== undefined ? { splineId: handle.splineId } : {}),
        spanIndex: handle.spanIndex,
        handle: handle.handle,
      };
    }
  }
  return best;
}

export function pickProp(state: SceneState, x: number, y: number): string | null {
  if (state.propPickables.length === 0) {
    return null;
  }
  state.pointer.set(x, y);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const hits = state.raycaster.intersectObjects(
    state.propPickables.map((entry) => entry.mesh),
    false,
  );
  const hit = hits[0];
  if (!hit) {
    return null;
  }
  return state.propPickables.find((entry) => entry.mesh === hit.object)?.id ?? null;
}

export function pickCenterlineSegment(
  state: SceneState,
  x: number,
  y: number,
): CenterlineSegmentPick | null {
  const ground = pickGround(state, x, y);
  if (!ground) {
    return null;
  }
  state.pointer.set(x, y);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const distance = state.camera.position.distanceTo(state.controls.target);
  state.raycaster.params.Line.threshold = Math.max(0.6, distance * 0.012);
  const hits = state.raycaster.intersectObjects(
    state.linePickables.map((entry) => entry.line),
    false,
  );
  const hit = hits[0];
  if (!hit) {
    return null;
  }
  const entry = state.linePickables.find((candidate) => candidate.line === hit.object);
  if (!entry) {
    return null;
  }
  const centerline = state.centerlines[entry.centerlineIndex];
  if (!centerline) {
    return null;
  }
  const points = centerline.points;
  const segmentCount = centerline.closed ? points.length : points.length - 1;
  if (segmentCount < 1) {
    return null;
  }
  let bestSegment = 0;
  let bestDistance = Infinity;
  let bestPoint: Vec2 = [ground[0], ground[1]];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const a = points[segment]!;
    const b = points[(segment + 1) % points.length]!;
    const a2: Vec2 = [a[0], a[1]];
    const b2: Vec2 = [b[0], b[1]];
    const distanceSq = distancePointToSegmentSq(ground, a2, b2);
    if (distanceSq < bestDistance) {
      const t = Math.max(0, Math.min(1, pointOnSegmentParameter(ground, a2, b2)));
      bestDistance = distanceSq;
      bestSegment = segment;
      bestPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return {
    centerlineIndex: entry.centerlineIndex,
    segmentIndex: bestSegment,
    position: bestPoint,
  };
}
