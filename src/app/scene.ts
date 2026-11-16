import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  BakedTrack,
  PropKind,
  Quat,
  Spawn,
  Surface,
  Vec3,
} from "../model/baked-track";
import type { EdgeInfo, TopologyReport } from "../kernel/topology";
import {
  distancePointToSegmentSq,
  pointOnSegmentParameter,
  type Vec2,
} from "../kernel/math2";

export const SURFACE_COLORS: Record<string, number> = {
  kerb_red: 0xb32424,
  kerb_white: 0xededed,
  wall: 0x7b8087,
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

export type RoadsideKind = "kerb" | "wall" | "prop";

export interface KerbRailOverlayData {
  kind: RoadsideKind;
  sectionId: string;
  side: "left" | "right";
  points: Vec3[];
}

export interface KerbSpanOverlayData {
  kind: RoadsideKind;
  sectionId: string;
  spanIndex: number;
  side: "left" | "right";
  selected: boolean;
  pieces: Vec3[][];
  entry: Vec3;
  exit: Vec3;
}

export interface KerbPreviewOverlayData {
  kind: RoadsideKind;
  pieces: Vec3[][];
  entry: Vec3;
  exit: Vec3;
}

export interface KerbOverlayData {
  rails: KerbRailOverlayData[];
  spans: KerbSpanOverlayData[];
  preview?: KerbPreviewOverlayData | null;
}

export interface KerbRailPick {
  kind: RoadsideKind;
  sectionId: string;
  side: "left" | "right";
  fraction: number;
}

export interface KerbHandlePick {
  kind: RoadsideKind;
  sectionId: string;
  spanIndex: number;
  handle: "entry" | "exit";
}

export interface PropOverlayData {
  id: string;
  kind: PropKind;
  position: Vec3;
  rotation: Quat;
  scale: number;
  selected: boolean;
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
    kerbTopology?: TopologyReport,
    kerbs?: KerbOverlayData,
    props?: readonly PropOverlayData[],
  ): void;
  updateOverlays(
    centerlines: readonly CentrelineOverlayData[],
    terrainPoints: readonly TerrainPointOverlayData[],
    kerbs?: KerbOverlayData,
    props?: readonly PropOverlayData[],
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
  updateSpawn(spawn: Spawn | null): void;
  pick(x: number, y: number): PickResult | null;
  pickControlPoint(x: number, y: number): ControlPointPick | null;
  pickCenterlineSegment(x: number, y: number): CenterlineSegmentPick | null;
  pickKerbRail(x: number, y: number): KerbRailPick | null;
  pickKerbHandle(x: number, y: number): KerbHandlePick | null;
  pickProp(x: number, y: number): string | null;
  pickTerrainPoint(x: number, y: number): number | null;
  pickSpawn(x: number, y: number): boolean;
  pickGround(x: number, y: number): Vec2 | null;
  screenUnitsPerPixel(): number;
  requestRender(): void;
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
  initialKerbTopology?: TopologyReport,
  initialKerbs: KerbOverlayData = { rails: [], spans: [] },
  initialProps: readonly PropOverlayData[] = [],
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

  let renderFrame: number | null = null;
  let renderDirty = true;
  let disposed = false;

  function requestRender(): void {
    renderDirty = true;
    if (renderFrame === null && !disposed) {
      renderFrame = window.requestAnimationFrame(renderNextFrame);
    }
  }

  function renderNextFrame(): void {
    renderFrame = null;
    if (disposed || document.hidden) {
      return;
    }
    const dirty = renderDirty;
    renderDirty = false;
    const controlsChanged = controls.update();
    if (!dirty && !controlsChanged) {
      return;
    }
    renderer.render(scene, camera);
    if (controlsChanged) {
      requestRender();
    }
  }

  const onVisibilityChange = (): void => {
    if (!document.hidden) {
      requestRender();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  controls.addEventListener("change", requestRender);

  let track = initialTrack;
  let topology = initialTopology;
  let kerbTopology = initialKerbTopology;
  let kerbs = initialKerbs;
  let props = initialProps;
  let centerlines = initialCenterlines;
  let terrainPoints = initialTerrainPoints;
  let surfaceMesh: THREE.Mesh | null = null;
  let kerbMesh: THREE.Mesh | null = null;
  let wallMesh: THREE.Mesh | null = null;
  let selectedPoint: ControlPointPick | null = null;
  let selectedTerrainPoint: number | null = null;
  let joinTarget: ControlPointPick | null = null;
  let linePickables: Array<{
    line: THREE.Line | THREE.LineLoop;
    centerlineIndex: number;
  }> = [];
  let centerlineOverlayGroup: THREE.Group | null = null;
  let terrainPointOverlayGroup: THREE.Group | null = null;
  let kerbOverlayGroup: THREE.Group | null = null;
  let propGroup: THREE.Group | null = null;
  let propPickables: Array<{ id: string; mesh: THREE.Mesh }> = [];
  let kerbRailPickables: KerbRailOverlayData[] = [];
  let kerbHandlePickables: Array<{
    position: Vec3;
    kind: RoadsideKind;
    sectionId: string;
    spanIndex: number;
    handle: "entry" | "exit";
  }> = [];
  let spawnGroup: THREE.Group | null = null;
  let activeSpawn: Spawn | undefined = initialTrack.spawns[0];

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

  const buildCenterlineOverlays = (): void => {
    if (!centerlineOverlayGroup) {
      return;
    }
    disposeObject(centerlineOverlayGroup);
    centerlineOverlayGroup.clear();
    linePickables = [];

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
      centerlineOverlayGroup.add(line);
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
      centerlineOverlayGroup.add(controlPoints);
    }
  };

  const buildTerrainPointOverlays = (): void => {
    if (!terrainPointOverlayGroup) {
      return;
    }
    disposeObject(terrainPointOverlayGroup);
    terrainPointOverlayGroup.clear();
    if (terrainPoints.length === 0) {
      return;
    }
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
    terrainPointOverlayGroup.add(pointMarkers);
  };

  const buildKerbOverlays = (): void => {
    if (!kerbOverlayGroup) {
      return;
    }
    disposeObject(kerbOverlayGroup);
    kerbOverlayGroup.clear();
    kerbRailPickables = [];
    kerbHandlePickables = [];

    for (const rail of kerbs.rails) {
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
      kerbOverlayGroup.add(line);
      kerbRailPickables.push(rail);
    }

    for (const span of kerbs.spans) {
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
        kerbOverlayGroup.add(line);
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
        kerbOverlayGroup.add(handles);
        kerbHandlePickables.push(
          {
            position: span.entry,
            kind: span.kind,
            sectionId: span.sectionId,
            spanIndex: span.spanIndex,
            handle: "entry",
          },
          {
            position: span.exit,
            kind: span.kind,
            sectionId: span.sectionId,
            spanIndex: span.spanIndex,
            handle: "exit",
          },
        );
      }
    }

    if (kerbs.preview) {
      for (const piece of kerbs.preview.pieces) {
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
        line.name = `${kerbs.preview.kind}-preview`;
        line.renderOrder = 7;
        kerbOverlayGroup.add(line);
      }
    }
  };

  const buildSpawnOverlay = (spawn: Spawn | undefined): void => {
    if (spawnGroup) {
      content.remove(spawnGroup);
      disposeObject(spawnGroup);
      spawnGroup = null;
    }
    activeSpawn = spawn;
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
    content.add(group);
    spawnGroup = group;
  };

  const propHash = (id: string, salt: number): number => {
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
  };

  const buildProps = (): void => {
    if (!propGroup) {
      return;
    }
    disposeObject(propGroup);
    propGroup.clear();
    propPickables = [];
    for (const prop of props) {
      const group = new THREE.Group();
      group.name = `prop-${prop.id}`;
      group.position.set(prop.position[0], prop.position[1], prop.position[2]);
      group.quaternion.copy(quaternionFromArray(prop.rotation));
      group.scale.setScalar(prop.scale);
      const material = (color: number): THREE.MeshStandardMaterial =>
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.8,
          metalness: 0,
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
        group.add(mesh);
        propPickables.push({ id: prop.id, mesh });
      };
      if (prop.kind === "tree") {
        const variant = propHash(prop.id, 0x4);
        const tiers: Array<readonly [number, number, number]> =
          variant < 0.4
            ? [[1, 2, 2.2], [2.1, 1.65, 2], [3.2, 1.3, 1.9], [4.3, 1, 1.8], [5.4, 0.7, 1.7], [6.5, 0.4, 1.5]]
            : variant < 0.75
              ? [[1.1, 2.4, 2.4], [2.3, 1.9, 2.2], [3.5, 1.45, 2], [4.7, 1.05, 1.8], [5.9, 0.65, 1.6]]
              : [[0.5, 1.25, 1.5], [1.4, 0.95, 1.4], [2.3, 0.65, 1.3], [3.2, 0.4, 1.2]];
        const treeScale = 0.6;
        const trunkHeight = (variant < 0.4 ? 1.6 : variant < 0.75 ? 1.8 : 1) * treeScale;
        const trunkRadius = (variant < 0.4 ? 0.18 : variant < 0.75 ? 0.24 : 0.13) * treeScale;
        addMesh(
          new THREE.CylinderGeometry(trunkRadius * 0.5, trunkRadius, trunkHeight, 5),
          trunkHeight / 2,
          0x523b26,
        );
        for (const [offset, radius, height] of tiers) {
          addMesh(
            new THREE.ConeGeometry(radius * treeScale, height * treeScale, 6),
            (offset + height / 2) * treeScale,
            0x336b2e,
          );
        }
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
      propGroup.add(group);
    }
  };

  const buildContent = (): void => {
    disposeObject(content);
    content.clear();
    surfaceMesh = null;
    kerbMesh = null;
    wallMesh = null;
    linePickables = [];
    spawnGroup = null;

    centerlineOverlayGroup = new THREE.Group();
    centerlineOverlayGroup.name = "centerline-overlays";
    centerlineOverlayGroup.visible = centerlineVisible;
    content.add(centerlineOverlayGroup);
    terrainPointOverlayGroup = new THREE.Group();
    terrainPointOverlayGroup.name = "terrain-point-overlays";
    content.add(terrainPointOverlayGroup);
    kerbOverlayGroup = new THREE.Group();
    kerbOverlayGroup.name = "kerb-overlays";
    content.add(kerbOverlayGroup);
    propGroup = new THREE.Group();
    propGroup.name = "props";
    content.add(propGroup);

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

    const buildGraphMesh = (
      graph: NonNullable<typeof track.surfaceGraph>,
      name: string,
    ): THREE.Mesh => {
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
      mesh.name = name;
      content.add(mesh);
      return mesh;
    };

    surfaceMesh = buildGraphMesh(track.surfaceGraph, "track-surfaces");
    if (track.kerbGraph) {
      kerbMesh = buildGraphMesh(track.kerbGraph, "track-kerbs");
    }
    if (track.wallGraph) {
      wallMesh = buildGraphMesh(track.wallGraph, "track-walls");
    }

    const wireframe = new THREE.Group();
    wireframe.name = "wireframe";
    wireframe.visible = wireframeVisible;
    const groundWireframe = buildEdgeLines(
      topology.edges,
      topology.weldedPositions,
      0x9fb0c8,
      0.35,
      true,
    );
    groundWireframe.name = "ground-wireframe";
    wireframe.add(groundWireframe);
    if (kerbTopology) {
      const kerbWireframe = buildEdgeLines(
        kerbTopology.edges,
        kerbTopology.weldedPositions,
        0x38bdf8,
        0.7,
        true,
      );
      kerbWireframe.name = "kerb-wireframe";
      wireframe.add(kerbWireframe);
    }
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
    if (kerbTopology && kerbTopology.nonManifoldEdges.length > 0) {
      const kerbNonManifold = buildEdgeLines(
        kerbTopology.nonManifoldEdges,
        kerbTopology.weldedPositions,
        0xff3df2,
        1,
        false,
      );
      kerbNonManifold.name = "kerb-non-manifold";
      boundaryGroup.add(kerbNonManifold);
    }
    content.add(boundaryGroup);

    const tJunctions = new THREE.Group();
    tJunctions.name = "t-junctions";
    tJunctions.visible = tJunctionsVisible;
    const addTJunctionPoints = (source: TopologyReport): void => {
      if (source.tJunctions.length === 0) {
        return;
      }
      const vertices = new Set<number>();
      for (const tJunction of source.tJunctions) {
        vertices.add(tJunction.vertex);
      }
      const data = new Float32Array(vertices.size * 3);
      let index = 0;
      for (const vertex of vertices) {
        const position = source.weldedPositions[vertex]!;
        data[index * 3] = position[0];
        data[index * 3 + 1] = position[1] + 0.08;
        data[index * 3 + 2] = position[2];
        index += 1;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: 0xffd166,
          size: 9,
          sizeAttenuation: false,
          depthTest: false,
        }),
      );
      tJunctions.add(points);
    };
    addTJunctionPoints(topology);
    if (kerbTopology) {
      addTJunctionPoints(kerbTopology);
    }
    content.add(tJunctions);

    buildCenterlineOverlays();

    const collisionMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const collision = new THREE.Group();
    collision.name = "collision-overlay";
    collision.visible = collisionVisible;
    for (const mesh of [surfaceMesh, kerbMesh, wallMesh]) {
      if (!mesh) {
        continue;
      }
      const overlay = new THREE.Mesh(mesh.geometry, collisionMaterial);
      overlay.position.y = 0.03;
      overlay.renderOrder = 2;
      collision.add(overlay);
    }
    content.add(collision);

    buildTerrainPointOverlays();
    buildKerbOverlays();
    buildProps();

    buildSpawnOverlay(track.spawns[0]);

    updateSun();
    updateSelectionMarker();
    updateTerrainSelectionMarker();
    updateJoinTargetMarker();
    requestRender();
  };

  let wireframeVisible = true;
  let boundaryVisible = true;
  let tJunctionsVisible = true;
  let collisionVisible = false;
  let centerlineVisible = true;

  const setCenterlineVisibility = (visible: boolean): void => {
    centerlineVisible = visible;
    if (centerlineOverlayGroup) {
      centerlineOverlayGroup.visible = visible;
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
    requestRender();
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
    update(
      nextTrack,
      nextTopology,
      nextCenterlines,
      nextTerrainPoints,
      nextKerbTopology,
      nextKerbs,
      nextProps,
    ): void {
      track = nextTrack;
      topology = nextTopology;
      kerbTopology = nextKerbTopology;
      centerlines = nextCenterlines;
      terrainPoints = nextTerrainPoints;
      kerbs = nextKerbs ?? kerbs;
      props = nextProps ?? props;
      buildContent();
      requestRender();
    },
    updateOverlays(nextCenterlines, nextTerrainPoints, nextKerbs, nextProps): void {
      centerlines = nextCenterlines;
      terrainPoints = nextTerrainPoints;
      kerbs = nextKerbs ?? kerbs;
      props = nextProps ?? props;
      buildCenterlineOverlays();
      buildTerrainPointOverlays();
      buildKerbOverlays();
      buildProps();
      updateSelectionMarker();
      updateTerrainSelectionMarker();
      updateJoinTargetMarker();
      requestRender();
    },
    frame,
    setWireframeVisible(visible: boolean): void {
      wireframeVisible = visible;
      const wireframe = content.getObjectByName("wireframe");
      if (wireframe) {
        wireframe.visible = visible;
      }
      requestRender();
    },
    setBoundaryVisible(visible: boolean): void {
      boundaryVisible = visible;
      const group = content.getObjectByName("boundary-edges");
      if (group) {
        group.visible = visible;
      }
      requestRender();
    },
    setTJunctionsVisible(visible: boolean): void {
      tJunctionsVisible = visible;
      const points = content.getObjectByName("t-junctions");
      if (points) {
        points.visible = visible;
      }
      requestRender();
    },
    setCollisionVisible(visible: boolean): void {
      collisionVisible = visible;
      const collision = content.getObjectByName("collision-overlay");
      if (collision) {
        collision.visible = visible;
      }
      requestRender();
    },
    setCenterlinesVisible(visible: boolean): void {
      setCenterlineVisibility(visible);
      requestRender();
    },
    setControlsEnabled(enabled: boolean): void {
      controls.enabled = enabled;
    },
    setSelectedPoint(point: ControlPointPick | null): void {
      selectedPoint = point;
      updateSelectionMarker();
      requestRender();
    },
    setSelectedTerrainPoint(index: number | null): void {
      selectedTerrainPoint = index;
      updateTerrainSelectionMarker();
      requestRender();
    },
    setJoinTarget(point: ControlPointPick | null): void {
      joinTarget = point;
      updateJoinTargetMarker();
      requestRender();
    },
    updateSpawn(spawn: Spawn | null): void {
      activeSpawn = spawn ?? undefined;
      if (!spawn) {
        if (spawnGroup) {
          spawnGroup.visible = false;
        }
        requestRender();
        return;
      }
      if (!spawnGroup) {
        buildSpawnOverlay(spawn);
        requestRender();
        return;
      }
      spawnGroup.visible = true;
      spawnGroup.position.set(spawn.position[0], spawn.position[1] + 0.1, spawn.position[2]);
      spawnGroup.quaternion.copy(quaternionFromArray(spawn.rotation));
      requestRender();
    },
    pick(x: number, y: number): PickResult | null {
      const pickMeshes = [surfaceMesh, kerbMesh, wallMesh].filter(
        (mesh): mesh is THREE.Mesh => mesh !== null,
      );
      if (pickMeshes.length === 0) {
        return null;
      }
      pointer.set(x, y);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickMeshes, false);
      const hit = hits[0];
      if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) {
        return null;
      }
      const graph =
        hit.object === kerbMesh
          ? track.kerbGraph
          : hit.object === wallMesh
            ? track.wallGraph
            : track.surfaceGraph;
      if (!graph) {
        return null;
      }
      const triangle: number = hit.faceIndex;
      const surfaceId = graph.triangleSurfaces[triangle];
      const surface = track.surfaces.find((candidate) => candidate.id === surfaceId);
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
      const spawn = activeSpawn;
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
    pickKerbRail(x: number, y: number): KerbRailPick | null {
      const width = Math.max(renderer.domElement.clientWidth, 1);
      const height = Math.max(renderer.domElement.clientHeight, 1);
      const targetX = (x * 0.5 + 0.5) * width;
      const targetY = (-y * 0.5 + 0.5) * height;
      const projected = new THREE.Vector3();
      let best: {
        kind: RoadsideKind;
        sectionId: string;
        side: "left" | "right";
        fraction: number;
      } | null = null;
      let bestDistance = 14;
      for (const rail of kerbRailPickables) {
        if (rail.points.length < 2) {
          continue;
        }
        const points = rail.points.map((point) => {
          projected.set(point[0], point[1], point[2]).project(camera);
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
              side: rail.side,
              fraction: Math.max(
                0,
                Math.min(1, (index + t) / (rail.points.length - 1)),
              ),
            };
          }
        }
      }
      return best;
    },
    pickKerbHandle(x: number, y: number): KerbHandlePick | null {
      const width = Math.max(renderer.domElement.clientWidth, 1);
      const height = Math.max(renderer.domElement.clientHeight, 1);
      const targetX = (x * 0.5 + 0.5) * width;
      const targetY = (-y * 0.5 + 0.5) * height;
      const projected = new THREE.Vector3();
      let best: KerbHandlePick | null = null;
      let bestDistance = 15;
      for (const handle of kerbHandlePickables) {
        projected
          .set(handle.position[0], handle.position[1], handle.position[2])
          .project(camera);
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
            spanIndex: handle.spanIndex,
            handle: handle.handle,
          };
        }
      }
      return best;
    },
    pickProp(x: number, y: number): string | null {
      if (propPickables.length === 0) {
        return null;
      }
      pointer.set(x, y);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        propPickables.map((entry) => entry.mesh),
        false,
      );
      const hit = hits[0];
      if (!hit) {
        return null;
      }
      return propPickables.find((entry) => entry.mesh === hit.object)?.id ?? null;
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
    requestRender,
    resize(): void {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      requestRender();
    },
    dispose(): void {
      disposed = true;
      if (renderFrame !== null) {
        window.cancelAnimationFrame(renderFrame);
        renderFrame = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controls.removeEventListener("change", requestRender);
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
