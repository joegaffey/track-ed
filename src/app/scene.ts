import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BakedTrack, Surface, Vec3 } from "../model/baked-track";
import type { EdgeInfo, TopologyReport } from "../kernel/topology";
import {
  distancePointToSegmentSq,
  pointOnSegmentParameter,
  type Vec2,
} from "../kernel/math2";

export const SURFACE_COLORS: Record<string, number> = {
  asphalt: 0x4b5563,
  dirt: 0x8b5e3c,
  grass: 0x2f6b3a,
};

const MAIN_CENTERLINE_COLOR = 0xffd166;
const BRANCH_CENTERLINE_COLOR = 0x38bdf8;

export interface PickResult {
  triangle: number;
  surfaceId: number;
  surfaceName: string;
  area: number;
  point: Vec3;
}

export interface TerrainPointOverlayData {
  position: Vec2;
  height: number;
}

export interface CentrelineOverlayData {
  id: string;
  closed: boolean;
  points: ReadonlyArray<readonly [number, number]>;
  pointHeights?: readonly number[];
  linePoints?: ReadonlyArray<readonly [number, number]>;
  lineHeights?: readonly number[];
}

export interface ControlPointPick {
  centerlineIndex: number;
  pointIndex: number;
}

export interface CenterlineSegmentPick {
  centerlineIndex: number;
  segmentIndex: number;
  position: Vec2;
}

export interface TrackView {
  update(
    track: BakedTrack,
    topology: TopologyReport,
    centerlines: readonly CentrelineOverlayData[],
    terrainPoints: readonly TerrainPointOverlayData[],
  ): void;
  frame(): void;
  setWireframeVisible(visible: boolean): void;
  setBoundaryVisible(visible: boolean): void;
  setTJunctionsVisible(visible: boolean): void;
  setCollisionVisible(visible: boolean): void;
  setCenterlinesVisible(visible: boolean): void;
  setControlsEnabled(enabled: boolean): void;
  setSelectedPoint(point: ControlPointPick | null): void;
  setSelectedTerrainPoint(index: number | null): void;
  setJoinTarget(point: ControlPointPick | null): void;
  pick(x: number, y: number): PickResult | null;
  pickControlPoint(x: number, y: number): ControlPointPick | null;
  pickCenterlineSegment(x: number, y: number): CenterlineSegmentPick | null;
  pickTerrainPoint(x: number, y: number): number | null;
  pickSpawn(x: number, y: number): boolean;
  pickGround(x: number, y: number): Vec2 | null;
  screenUnitsPerPixel(): number;
  render(): void;
  resize(): void;
  dispose(): void;
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
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

function colorForSurface(surface: Surface): number {
  return SURFACE_COLORS[surface.name] ?? 0xb0b8c4;
}

function edgePositions(edges: readonly EdgeInfo[], positions: readonly Vec3[]): Float32Array {
  const data = new Float32Array(edges.length * 6);
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    const a = positions[edge.a]!;
    const b = positions[edge.b]!;
    data[i * 6] = a[0];
    data[i * 6 + 1] = a[1] + 0.02;
    data[i * 6 + 2] = a[2];
    data[i * 6 + 3] = b[0];
    data[i * 6 + 4] = b[1] + 0.02;
    data[i * 6 + 5] = b[2];
  }
  return data;
}

function buildEdgeLines(
  edges: readonly EdgeInfo[],
  positions: readonly Vec3[],
  color: number,
  opacity: number,
  depthTest: boolean,
): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(edgePositions(edges, positions), 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

function disposeObject(object: THREE.Object3D): void {
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

function quaternionFromArray(quaternion: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
}

export function createTrackView(
  container: HTMLElement,
  initialTrack: BakedTrack,
  initialTopology: TopologyReport,
  initialCenterlines: readonly CentrelineOverlayData[],
  initialTerrainPoints: readonly TerrainPointOverlayData[],
): TrackView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.className = "viewport-canvas";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b10);
  scene.fog = new THREE.Fog(0x080b10, 220, 900);

  const camera = new THREE.PerspectiveCamera(
    50,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    0.1,
    5000,
  );
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.maxPolarAngle = Math.PI / 2 - 0.01;

  const hemisphere = new THREE.HemisphereLight(0xcfe0ff, 0x1a2418, 1.4);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sun);

  const content = new THREE.Group();
  content.name = "track-content";
  scene.add(content);

  const selectionMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  selectionMarker.renderOrder = 20;
  selectionMarker.visible = false;
  scene.add(selectionMarker);

  const terrainSelectionMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5cd6, depthTest: false }),
  );
  terrainSelectionMarker.renderOrder = 20;
  terrainSelectionMarker.visible = false;
  scene.add(terrainSelectionMarker);

  const joinTargetMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false }),
  );
  joinTargetMarker.renderOrder = 21;
  joinTargetMarker.visible = false;
  scene.add(joinTargetMarker);

  let track = initialTrack;
  let topology = initialTopology;
  let centerlines = initialCenterlines;
  let terrainPoints = initialTerrainPoints;
  let surfaceMesh: THREE.Mesh | null = null;
  let selectedPoint: ControlPointPick | null = null;
  let selectedTerrainPoint: number | null = null;
  let joinTarget: ControlPointPick | null = null;
  let linePickables: Array<{
    line: THREE.Line | THREE.LineLoop;
    centerlineIndex: number;
  }> = [];

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const updateSun = (): void => {
    const centerX = (track.bounds.min[0] + track.bounds.max[0]) / 2;
    const centerZ = (track.bounds.min[2] + track.bounds.max[2]) / 2;
    sun.position.set(centerX + 120, 220, centerZ + 80);
  };

  const updateSelectionMarker = (): void => {
    if (!selectedPoint) {
      selectionMarker.visible = false;
      return;
    }
    const centerline = centerlines[selectedPoint.centerlineIndex];
    const point = centerline?.points[selectedPoint.pointIndex];
    if (!point) {
      selectionMarker.visible = false;
      return;
    }
    const height = centerlines[selectedPoint.centerlineIndex]?.pointHeights?.[
      selectedPoint.pointIndex
    ] ?? 0;
    selectionMarker.position.set(point[0], height + 0.3, point[1]);
    selectionMarker.visible = true;
  };

  const updateTerrainSelectionMarker = (): void => {
    if (selectedTerrainPoint === null) {
      terrainSelectionMarker.visible = false;
      return;
    }
    const point = terrainPoints[selectedTerrainPoint];
    if (!point) {
      terrainSelectionMarker.visible = false;
      return;
    }
    terrainSelectionMarker.position.set(point.position[0], point.height + 0.4, point.position[1]);
    terrainSelectionMarker.visible = true;
  };

  const updateJoinTargetMarker = (): void => {
    if (!joinTarget) {
      joinTargetMarker.visible = false;
      return;
    }
    const centerline = centerlines[joinTarget.centerlineIndex];
    const point = centerline?.points[joinTarget.pointIndex];
    if (!centerline || !point) {
      joinTargetMarker.visible = false;
      return;
    }
    const height = centerline.pointHeights?.[joinTarget.pointIndex] ?? 0;
    joinTargetMarker.position.set(point[0], height + 0.35, point[1]);
    joinTargetMarker.visible = true;
  };

  const buildContent = (): void => {
    disposeObject(content);
    content.clear();
    surfaceMesh = null;
    linePickables = [];

    const surfaces = [...track.surfaces].sort((a, b) => a.id - b.id);
    const materialIndexById = new Map(surfaces.map((surface, index) => [surface.id, index]));
    const materials = surfaces.map(
      (surface) =>
        new THREE.MeshStandardMaterial({
          color: colorForSurface(surface),
          roughness: surface.roughness,
          metalness: 0,
          side: THREE.FrontSide,
        }),
    );

    const graph = track.surfaceGraph;
    const geometry = new THREE.BufferGeometry();
    const positionData = new Float32Array(graph.positions.length * 3);
    for (let i = 0; i < graph.positions.length; i += 1) {
      const position = graph.positions[i]!;
      positionData[i * 3] = position[0];
      positionData[i * 3 + 1] = position[1];
      positionData[i * 3 + 2] = position[2];
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positionData, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(graph.indices), 1));
    geometry.computeVertexNormals();

    const triangleCount = graph.triangleSurfaces.length;
    let runStart = 0;
    while (runStart < triangleCount) {
      const surfaceId = graph.triangleSurfaces[runStart]!;
      let runEnd = runStart + 1;
      while (runEnd < triangleCount && graph.triangleSurfaces[runEnd] === surfaceId) {
        runEnd += 1;
      }
      const materialIndex = materialIndexById.get(surfaceId);
      if (materialIndex !== undefined) {
        geometry.addGroup(runStart * 3, (runEnd - runStart) * 3, materialIndex);
      }
      runStart = runEnd;
    }
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = "track-surfaces";
    surfaceMesh = mesh;
    content.add(mesh);

    const wireframe = buildEdgeLines(
      topology.edges,
      topology.weldedPositions,
      0x9fb0c8,
      0.35,
      true,
    );
    wireframe.name = "wireframe";
    wireframe.visible = wireframeVisible;
    content.add(wireframe);

    const interiorBoundary = buildEdgeLines(
      topology.interiorBoundaryEdges,
      topology.weldedPositions,
      0xff4d4d,
      1,
      false,
    );
    const outerBoundary = buildEdgeLines(
      topology.outerBoundaryEdges,
      topology.weldedPositions,
      0x4ade80,
      0.9,
      false,
    );
    const nonManifold = buildEdgeLines(
      topology.nonManifoldEdges,
      topology.weldedPositions,
      0xff3df2,
      1,
      false,
    );
    const boundaryGroup = new THREE.Group();
    boundaryGroup.name = "boundary-edges";
    boundaryGroup.visible = boundaryVisible;
    boundaryGroup.add(interiorBoundary, outerBoundary, nonManifold);
    content.add(boundaryGroup);

    const tJunctionVertices = new Set<number>();
    for (const tJunction of topology.tJunctions) {
      tJunctionVertices.add(tJunction.vertex);
    }
    const tJunctionData = new Float32Array(tJunctionVertices.size * 3);
    let tJunctionIndex = 0;
    for (const vertex of tJunctionVertices) {
      const position = topology.weldedPositions[vertex]!;
      tJunctionData[tJunctionIndex * 3] = position[0];
      tJunctionData[tJunctionIndex * 3 + 1] = position[1] + 0.08;
      tJunctionData[tJunctionIndex * 3 + 2] = position[2];
      tJunctionIndex += 1;
    }
    const tJunctionGeometry = new THREE.BufferGeometry();
    tJunctionGeometry.setAttribute("position", new THREE.BufferAttribute(tJunctionData, 3));
    const tJunctions = new THREE.Points(
      tJunctionGeometry,
      new THREE.PointsMaterial({
        color: 0xffd166,
        size: 9,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    tJunctions.name = "t-junctions";
    tJunctions.visible = tJunctionsVisible;
    content.add(tJunctions);

    for (let centerlineIndex = 0; centerlineIndex < centerlines.length; centerlineIndex += 1) {
      const centerline = centerlines[centerlineIndex]!;
      if (centerline.points.length === 0) {
        continue;
      }
      const color = centerline.closed ? MAIN_CENTERLINE_COLOR : BRANCH_CENTERLINE_COLOR;
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
      line.visible = centerlineVisible;
      content.add(line);
      linePickables.push({ line, centerlineIndex });

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
      controlPoints.visible = centerlineVisible;
      content.add(controlPoints);
    }
    centerlineGroup = content.children.filter(
      (child) => child.name.startsWith("centerline"),
    ) as THREE.Object3D[];

    const collisionMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const collision = new THREE.Mesh(geometry, collisionMaterial);
    collision.name = "collision-overlay";
    collision.position.y = 0.03;
    collision.renderOrder = 2;
    collision.visible = collisionVisible;
    content.add(collision);

    if (terrainPoints.length > 0) {
      const pointData = new Float32Array(terrainPoints.length * 3);
      for (let i = 0; i < terrainPoints.length; i += 1) {
        const point = terrainPoints[i]!;
        pointData[i * 3] = point.position[0];
        pointData[i * 3 + 1] = point.height + 0.3;
        pointData[i * 3 + 2] = point.position[1];
      }
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
      content.add(pointMarkers);
    }

    const spawn = track.spawns[0];
    if (spawn) {
      const spawnGroup = new THREE.Group();
      spawnGroup.position.set(spawn.position[0], spawn.position[1] + 0.1, spawn.position[2]);
      spawnGroup.quaternion.copy(quaternionFromArray(spawn.rotation));
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0, 0, 0),
        9,
        0xff8a4c,
        2.6,
        1.4,
      );
      spawnGroup.add(arrow);
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
      spawnGroup.add(ring);
      content.add(spawnGroup);
    }

    updateSun();
    updateSelectionMarker();
    updateTerrainSelectionMarker();
    updateJoinTargetMarker();
  };

  let centerlineGroup: THREE.Object3D[] = [];

  let wireframeVisible = true;
  let boundaryVisible = true;
  let tJunctionsVisible = true;
  let collisionVisible = false;
  let centerlineVisible = true;

  const setCenterlineVisibility = (visible: boolean): void => {
    centerlineVisible = visible;
    for (const object of centerlineGroup) {
      object.visible = visible;
    }
  };

  const frame = (): void => {
    const bounds = track.bounds;
    const center = new THREE.Vector3(
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    );
    const span = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[2] - bounds.min[2],
      bounds.max[1] - bounds.min[1],
      10,
    );
    camera.position.set(center.x + span * 0.7, center.y + span * 0.85, center.z + span * 0.7);
    controls.target.copy(center);
    controls.update();
  };

  const pickGround = (x: number, y: number): Vec2 | null => {
    pointer.set(x, y);
    raycaster.setFromCamera(pointer, camera);
    const intersection = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, intersection)) {
      return null;
    }
    return [intersection.x, intersection.z];
  };

  buildContent();
  frame();

  return {
    update(nextTrack, nextTopology, nextCenterlines, nextTerrainPoints): void {
      track = nextTrack;
      topology = nextTopology;
      centerlines = nextCenterlines;
      terrainPoints = nextTerrainPoints;
      buildContent();
    },
    frame,
    setWireframeVisible(visible: boolean): void {
      wireframeVisible = visible;
      const wireframe = content.getObjectByName("wireframe");
      if (wireframe) {
        wireframe.visible = visible;
      }
    },
    setBoundaryVisible(visible: boolean): void {
      boundaryVisible = visible;
      const group = content.getObjectByName("boundary-edges");
      if (group) {
        group.visible = visible;
      }
    },
    setTJunctionsVisible(visible: boolean): void {
      tJunctionsVisible = visible;
      const points = content.getObjectByName("t-junctions");
      if (points) {
        points.visible = visible;
      }
    },
    setCollisionVisible(visible: boolean): void {
      collisionVisible = visible;
      const collision = content.getObjectByName("collision-overlay");
      if (collision) {
        collision.visible = visible;
      }
    },
    setCenterlinesVisible(visible: boolean): void {
      setCenterlineVisibility(visible);
    },
    setControlsEnabled(enabled: boolean): void {
      controls.enabled = enabled;
    },
    setSelectedPoint(point: ControlPointPick | null): void {
      selectedPoint = point;
      updateSelectionMarker();
    },
    setSelectedTerrainPoint(index: number | null): void {
      selectedTerrainPoint = index;
      updateTerrainSelectionMarker();
    },
    setJoinTarget(point: ControlPointPick | null): void {
      joinTarget = point;
      updateJoinTargetMarker();
    },
    pick(x: number, y: number): PickResult | null {
      if (!surfaceMesh) {
        return null;
      }
      pointer.set(x, y);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(surfaceMesh, false);
      const hit = hits[0];
      if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) {
        return null;
      }
      const triangle: number = hit.faceIndex;
      const surfaceId = track.surfaceGraph.triangleSurfaces[triangle];
      const surface = track.surfaces.find((candidate) => candidate.id === surfaceId);
      if (surfaceId === undefined || !surface) {
        return null;
      }
      const graph = track.surfaceGraph;
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
    },
    pickControlPoint(x: number, y: number): ControlPointPick | null {
      const width = Math.max(renderer.domElement.clientWidth, 1);
      const height = Math.max(renderer.domElement.clientHeight, 1);
      const projected = new THREE.Vector3();
      let best: {
        centerlineIndex: number;
        pointIndex: number;
        distance: number;
        closed: boolean;
      } | null = null;

      for (let centerlineIndex = 0; centerlineIndex < centerlines.length; centerlineIndex += 1) {
        const centerline = centerlines[centerlineIndex]!;
        for (let pointIndex = 0; pointIndex < centerline.points.length; pointIndex += 1) {
          const point = centerline.points[pointIndex]!;
          projected
            .set(point[0], (centerline.pointHeights?.[pointIndex] ?? 0) + 0.16, point[1])
            .project(camera);
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
    },
    pickTerrainPoint(x: number, y: number): number | null {
      const width = Math.max(renderer.domElement.clientWidth, 1);
      const height = Math.max(renderer.domElement.clientHeight, 1);
      const projected = new THREE.Vector3();
      let best: { index: number; distance: number } | null = null;

      for (let index = 0; index < terrainPoints.length; index += 1) {
        const point = terrainPoints[index]!;
        projected
          .set(point.position[0], point.height + 0.3, point.position[1])
          .project(camera);
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
    },
    pickSpawn(x: number, y: number): boolean {
      const spawn = track.spawns[0];
      if (!spawn) {
        return false;
      }
      const width = Math.max(renderer.domElement.clientWidth, 1);
      const height = Math.max(renderer.domElement.clientHeight, 1);
      const base = new THREE.Vector3(
        spawn.position[0],
        spawn.position[1] + 0.1,
        spawn.position[2],
      );
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
        quaternionFromArray(spawn.rotation),
      );
      const tip = base.clone().addScaledVector(direction, 9);
      const baseProjected = base.clone().project(camera);
      const tipProjected = tip.clone().project(camera);
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
    },
    pickCenterlineSegment(x: number, y: number): CenterlineSegmentPick | null {
      const ground = pickGround(x, y);
      if (!ground) {
        return null;
      }
      pointer.set(x, y);
      raycaster.setFromCamera(pointer, camera);
      const distance = camera.position.distanceTo(controls.target);
      raycaster.params.Line.threshold = Math.max(0.6, distance * 0.012);
      const hits = raycaster.intersectObjects(
        linePickables.map((entry) => entry.line),
        false,
      );
      const hit = hits[0];
      if (!hit) {
        return null;
      }
      const entry = linePickables.find((candidate) => candidate.line === hit.object);
      if (!entry) {
        return null;
      }
      const centerline = centerlines[entry.centerlineIndex];
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
    },
    pickGround,
    screenUnitsPerPixel(): number {
      const distance = camera.position.distanceTo(controls.target);
      const height = Math.max(renderer.domElement.clientHeight, 1);
      return (
        (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) /
        height
      );
    },
    render(): void {
      controls.update();
      renderer.render(scene, camera);
    },
    resize(): void {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose(): void {
      controls.dispose();
      disposeObject(content);
      selectionMarker.geometry.dispose();
      (selectionMarker.material as THREE.Material).dispose();
      terrainSelectionMarker.geometry.dispose();
      (terrainSelectionMarker.material as THREE.Material).dispose();
      joinTargetMarker.geometry.dispose();
      (joinTargetMarker.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
