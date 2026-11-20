import * as THREE from "three";
import type {
  Quat,
  Spawn,
} from "../../model/baked-track";
import {
  CONIFER_SIZE,
  buildConiferFoliage,
  coniferTone,
  coniferTrunk,
  type ConiferTone,
} from "../../kernel/conifer";
import type {
  CentrelineOverlayData,
  SceneState,
  TerrainPointOverlayData,
} from "./types";

const MAIN_CENTERLINE_COLOR = 0xffd166;
const BRANCH_CENTERLINE_COLOR = 0x38bdf8;

const CONIFER_PREVIEW_COLORS: Record<ConiferTone, number> = {
  deep: 0x0c2a0e,
  mid: 0x143d15,
  light: 0x20531d,
  gold: 0x8a6410,
};

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const renderable = child as THREE.Mesh | THREE.Line | THREE.LineSegments | THREE.Points;
    if (!("geometry" in renderable) || !renderable.geometry) {
      return;
    }
    renderable.geometry.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose();
      }
    } else if (material) {
      material.dispose();
    }
  });
}

export function quaternionFromArray(quaternion: Quat): THREE.Quaternion {
  return new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
}

export function centerlineOverlayPositions(centerline: CentrelineOverlayData): {
  linePositions: Float32Array;
  pointPositions: Float32Array;
} {
  const linePoints = centerline.linePoints ?? centerline.points;
  const linePositions = new Float32Array(linePoints.length * 3);
  const pointPositions = new Float32Array(centerline.points.length * 3);
  for (let i = 0; i < linePoints.length; i += 1) {
    const point = linePoints[i]!;
    linePositions[i * 3] = point[0];
    linePositions[i * 3 + 1] = (centerline.lineHeights?.[i] ?? 0) + 0.14;
    linePositions[i * 3 + 2] = point[1];
  }
  for (let i = 0; i < centerline.points.length; i += 1) {
    const point = centerline.points[i]!;
    pointPositions[i * 3] = point[0];
    pointPositions[i * 3 + 1] = (centerline.pointHeights?.[i] ?? 0) + 0.16;
    pointPositions[i * 3 + 2] = point[1];
  }
  return { linePositions, pointPositions };
}

export function terrainPointPositions(
  terrainPoints: readonly TerrainPointOverlayData[],
): Float32Array {
  const pointData = new Float32Array(terrainPoints.length * 3);
  for (let i = 0; i < terrainPoints.length; i += 1) {
    const point = terrainPoints[i]!;
    pointData[i * 3] = point.position[0];
    pointData[i * 3 + 1] = point.height + 0.3;
    pointData[i * 3 + 2] = point.position[1];
  }
  return pointData;
}

export function propHash(id: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

export function updateSelectionMarker(state: SceneState): void {
  if (!state.selectedPoint) {
    state.selectionMarker.visible = false;
    return;
  }
  const centerline = state.centerlines[state.selectedPoint.centerlineIndex];
  const point = centerline?.points[state.selectedPoint.pointIndex];
  if (!point) {
    state.selectionMarker.visible = false;
    return;
  }
  const height = state.centerlines[state.selectedPoint.centerlineIndex]?.pointHeights?.[
    state.selectedPoint.pointIndex
  ] ?? 0;
  state.selectionMarker.position.set(point[0], height + 0.3, point[1]);
  state.selectionMarker.visible = true;
}

export function updateTerrainSelectionMarker(state: SceneState): void {
  if (state.selectedTerrainPoint === null) {
    state.terrainSelectionMarker.visible = false;
    return;
  }
  const point = state.terrainPoints[state.selectedTerrainPoint];
  if (!point) {
    state.terrainSelectionMarker.visible = false;
    return;
  }
  state.terrainSelectionMarker.position.set(
    point.position[0],
    point.height + 0.4,
    point.position[1],
  );
  state.terrainSelectionMarker.visible = true;
}

export function updateJoinTargetMarker(state: SceneState): void {
  if (!state.joinTarget) {
    state.joinTargetMarker.visible = false;
    return;
  }
  const centerline = state.centerlines[state.joinTarget.centerlineIndex];
  const point = centerline?.points[state.joinTarget.pointIndex];
  if (!centerline || !point) {
    state.joinTargetMarker.visible = false;
    return;
  }
  const height = centerline.pointHeights?.[state.joinTarget.pointIndex] ?? 0;
  state.joinTargetMarker.position.set(point[0], height + 0.35, point[1]);
  state.joinTargetMarker.visible = true;
}

export function buildCenterlineOverlays(state: SceneState): void {
  const group = state.centerlineOverlayGroup;
  if (!group) {
    return;
  }
  disposeObject(group);
  group.clear();
  state.linePickables = [];

  for (let centerlineIndex = 0; centerlineIndex < state.centerlines.length; centerlineIndex += 1) {
    const centerline = state.centerlines[centerlineIndex]!;
    if (centerline.points.length === 0) {
      continue;
    }
    const color = centerline.closed ? MAIN_CENTERLINE_COLOR : BRANCH_CENTERLINE_COLOR;
    const { linePositions, pointPositions } = centerlineOverlayPositions(centerline);

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    const lineMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const line = centerline.closed
      ? new THREE.LineLoop(lineGeometry, lineMaterial)
      : new THREE.Line(lineGeometry, lineMaterial);
    line.name = `centerline-${centerline.id}`;
    line.renderOrder = 3;
    group.add(line);
    state.linePickables.push({ line, centerlineIndex });

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(pointPositions, 3));
    const controlPoints = new THREE.Points(
      pointGeometry,
      new THREE.PointsMaterial({
        color,
        size: 8,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    controlPoints.name = `centerline-points-${centerline.id}`;
    controlPoints.renderOrder = 4;
    group.add(controlPoints);
  }
}

export function buildTerrainPointOverlays(state: SceneState): void {
  const group = state.terrainPointOverlayGroup;
  if (!group) {
    return;
  }
  disposeObject(group);
  group.clear();
  if (state.terrainPoints.length === 0) {
    return;
  }
  const pointData = terrainPointPositions(state.terrainPoints);
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(pointData, 3));
  const pointMarkers = new THREE.Points(
    pointGeometry,
    new THREE.PointsMaterial({
      color: 0xff5cd6,
      size: 10,
      sizeAttenuation: false,
      depthTest: false,
    }),
  );
  pointMarkers.name = "terrain-points";
  pointMarkers.renderOrder = 5;
  group.add(pointMarkers);
}

export function buildKerbOverlays(state: SceneState): void {
  const group = state.kerbOverlayGroup;
  if (!group) {
    return;
  }
  disposeObject(group);
  group.clear();
  state.kerbRailPickables = [];
  state.kerbHandlePickables = [];

  for (const rail of state.kerbs.rails) {
    if (rail.points.length < 2) {
      continue;
    }
    const data = new Float32Array(rail.points.length * 3);
    for (let index = 0; index < rail.points.length; index += 1) {
      const point = rail.points[index]!;
      data[index * 3] = point[0];
      data[index * 3 + 1] = point[1];
      data[index * 3 + 2] = point[2];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
    const material = new THREE.LineDashedMaterial({
      color: rail.kind === "wall" ? 0x60a5fa : 0xf472b6,
      dashSize: 1.2,
      gapSize: 1.2,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.name = `${rail.kind}-rail-${rail.sectionId}-${rail.side}`;
    line.renderOrder = 5;
    group.add(line);
    state.kerbRailPickables.push(rail);
  }

  for (const span of state.kerbs.spans) {
    const color = span.selected
      ? 0x67e8f9
      : span.kind === "wall"
        ? 0x60a5fa
        : span.kind === "prop"
          ? 0x4ade80
          : 0xf472b6;
    for (const piece of span.pieces) {
      if (piece.length < 2) {
        continue;
      }
      const data = new Float32Array(piece.length * 3);
      for (let index = 0; index < piece.length; index += 1) {
        const point = piece[index]!;
        data[index * 3] = point[0];
        data[index * 3 + 1] = point[1];
        data[index * 3 + 2] = point[2];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: span.selected ? 1 : 0.85,
          depthTest: false,
          depthWrite: false,
        }),
      );
      line.name = `${span.kind}-span-${span.sectionId}-${span.spanIndex}`;
      line.renderOrder = 6;
      group.add(line);
    }
    if (span.selected) {
      const handleData = new Float32Array(6);
      handleData.set(span.entry, 0);
      handleData.set(span.exit, 3);
      const handleGeometry = new THREE.BufferGeometry();
      handleGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(handleData, 3),
      );
      const handles = new THREE.Points(
        handleGeometry,
        new THREE.PointsMaterial({
          color: 0xffffff,
          size: 12,
          sizeAttenuation: false,
          depthTest: false,
        }),
      );
      handles.name = `${span.kind}-handles-${span.sectionId}-${span.spanIndex}`;
      handles.renderOrder = 8;
      group.add(handles);
      state.kerbHandlePickables.push(
        {
          position: span.entry,
          kind: span.kind,
          sectionId: span.sectionId,
          ...(span.splineId !== undefined ? { splineId: span.splineId } : {}),
          spanIndex: span.spanIndex,
          handle: "entry",
        },
        {
          position: span.exit,
          kind: span.kind,
          sectionId: span.sectionId,
          ...(span.splineId !== undefined ? { splineId: span.splineId } : {}),
          spanIndex: span.spanIndex,
          handle: "exit",
        },
      );
    }
  }

  if (state.kerbs.preview) {
    for (const piece of state.kerbs.preview.pieces) {
      if (piece.length < 2) {
        continue;
      }
      const data = new Float32Array(piece.length * 3);
      for (let index = 0; index < piece.length; index += 1) {
        const point = piece[index]!;
        data[index * 3] = point[0];
        data[index * 3 + 1] = point[1];
        data[index * 3 + 2] = point[2];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: 0xfde047,
          transparent: true,
          opacity: 1,
          depthTest: false,
          depthWrite: false,
        }),
      );
      line.name = `${state.kerbs.preview.kind}-preview`;
      line.renderOrder = 7;
      group.add(line);
    }
  }
}

export function buildSpawnOverlay(state: SceneState, spawn: Spawn | undefined): void {
  if (state.spawnGroup) {
    state.content.remove(state.spawnGroup);
    disposeObject(state.spawnGroup);
    state.spawnGroup = null;
  }
  state.activeSpawn = spawn;
  if (!spawn) {
    return;
  }
  const group = new THREE.Group();
  group.position.set(spawn.position[0], spawn.position[1] + 0.1, spawn.position[2]);
  group.quaternion.copy(quaternionFromArray(spawn.rotation));
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, 0),
    9,
    0xff8a4c,
    2.6,
    1.4,
  );
  group.add(arrow);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.7, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff8a4c,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  group.add(ring);
  state.content.add(group);
  state.spawnGroup = group;
}

export function buildProps(state: SceneState): void {
  const group = state.propGroup;
  if (!group) {
    return;
  }
  disposeObject(group);
  group.clear();
  state.propPickables = [];
  for (const prop of state.props) {
    const propGroup = new THREE.Group();
    propGroup.name = `prop-${prop.id}`;
    propGroup.position.set(prop.position[0], prop.position[1], prop.position[2]);
    propGroup.quaternion.copy(quaternionFromArray(prop.rotation));
    propGroup.scale.setScalar(prop.scale);
    const material = (color: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0,
        flatShading: true,
        emissive: prop.selected ? 0x2b6cff : 0x000000,
        emissiveIntensity: prop.selected ? 0.5 : 0,
      });
    const addMesh = (
      geometry: THREE.BufferGeometry,
      y: number,
      color: number,
    ): void => {
      const mesh = new THREE.Mesh(geometry, material(color));
      mesh.position.y = y;
      mesh.userData.propId = prop.id;
      propGroup.add(mesh);
      state.propPickables.push({ id: prop.id, mesh });
    };
    if (prop.kind === "tree") {
      const variant = propHash(prop.id, 0x4);
      const treeScale = CONIFER_SIZE;
      const trunkSize = coniferTrunk(variant);
      const trunkHeight = trunkSize.height * treeScale;
      const trunkRadius = trunkSize.radius * treeScale;
      addMesh(
        new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, trunkHeight, 6),
        trunkHeight / 2,
        0x5f321a,
      );
      const tree = buildConiferFoliage(prop.id, variant, treeScale);
      const data = new Float32Array(tree.positions.length * 3);
      for (let index = 0; index < tree.positions.length; index += 1) {
        const position = tree.positions[index]!;
        data[index * 3] = position[0];
        data[index * 3 + 1] = position[1];
        data[index * 3 + 2] = position[2];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(tree.indices), 1));
      geometry.computeVertexNormals();
      addMesh(
        geometry,
        0,
        CONIFER_PREVIEW_COLORS[coniferTone(prop.id, variant)],
      );
    } else if (prop.kind === "tyre") {
      for (let index = 0; index < 3; index += 1) {
        addMesh(
          new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8),
          0.15 + index * 0.3,
          index % 2 === 0 ? 0x2255aa : 0xdddddd,
        );
      }
    } else if (prop.kind === "block") {
      addMesh(new THREE.BoxGeometry(0.6, 0.8, 1.8), 0.4, 0xaaaaaa);
    }
    group.add(propGroup);
  }
}

export function updateSpawnOverlay(state: SceneState, spawn: Spawn | null): void {
  state.activeSpawn = spawn ?? undefined;
  if (!spawn) {
    if (state.spawnGroup) {
      state.spawnGroup.visible = false;
    }
    return;
  }
  if (!state.spawnGroup) {
    buildSpawnOverlay(state, spawn);
    return;
  }
  state.spawnGroup.visible = true;
  state.spawnGroup.position.set(spawn.position[0], spawn.position[1] + 0.1, spawn.position[2]);
  state.spawnGroup.quaternion.copy(quaternionFromArray(spawn.rotation));
}
