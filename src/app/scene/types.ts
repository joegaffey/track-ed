import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  BakedTrack,
  PropKind,
  Quat,
  Spawn,
  Vec3,
} from "../../model/baked-track";
import type { TopologyReport } from "../../kernel/topology";
import type { Vec2 } from "../../kernel/math2";

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

export type RoadsideKind = "kerb" | "wall" | "prop" | "spline";

export interface KerbRailOverlayData {
  kind: RoadsideKind;
  sectionId: string;
  splineId?: string;
  side: "left" | "right";
  offset?: number;
  active?: boolean;
  points: Vec3[];
}

export interface KerbSpanOverlayData {
  kind: RoadsideKind;
  sectionId: string;
  splineId?: string;
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
  splineId?: string;
  side: "left" | "right";
  offset?: number;
  fraction: number;
}

export interface KerbHandlePick {
  kind: RoadsideKind;
  sectionId: string;
  splineId?: string;
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
  setRacingLineVisible(visible: boolean): void;
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
  focusAt(x: number, y: number): boolean;
  screenUnitsPerPixel(): number;
  requestRender(): void;
  resize(): void;
  dispose(): void;
}

export interface CenterlinePickable {
  line: THREE.Line | THREE.LineLoop;
  centerlineIndex: number;
}

export interface PropPickable {
  id: string;
  mesh: THREE.Mesh;
}

export interface KerbHandlePickable {
  position: Vec3;
  kind: RoadsideKind;
  sectionId: string;
  splineId?: string;
  spanIndex: number;
  handle: "entry" | "exit";
}

/**
 * Mutable state shared by the scene modules. It is a plain context object, not
 * a store: modules operate on it directly and the public `TrackView` remains the
 * only external API.
 */
export interface SceneState {
  container: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  sun: THREE.DirectionalLight;
  selectionMarker: THREE.Mesh;
  terrainSelectionMarker: THREE.Mesh;
  joinTargetMarker: THREE.Mesh;

  track: BakedTrack;
  topology: TopologyReport;
  kerbTopology: TopologyReport | undefined;
  kerbs: KerbOverlayData;
  props: readonly PropOverlayData[];
  centerlines: readonly CentrelineOverlayData[];
  terrainPoints: readonly TerrainPointOverlayData[];

  surfaceMesh: THREE.Mesh | null;
  kerbMesh: THREE.Mesh | null;
  wallMesh: THREE.Mesh | null;
  racingLineMesh: THREE.Mesh | null;

  selectedPoint: ControlPointPick | null;
  selectedTerrainPoint: number | null;
  joinTarget: ControlPointPick | null;

  linePickables: CenterlinePickable[];
  centerlineOverlayGroup: THREE.Group | null;
  terrainPointOverlayGroup: THREE.Group | null;
  kerbOverlayGroup: THREE.Group | null;
  propGroup: THREE.Group | null;
  propPickables: PropPickable[];
  kerbRailPickables: KerbRailOverlayData[];
  kerbHandlePickables: KerbHandlePickable[];
  spawnGroup: THREE.Group | null;
  activeSpawn: Spawn | undefined;

  wireframeVisible: boolean;
  boundaryVisible: boolean;
  tJunctionsVisible: boolean;
  collisionVisible: boolean;
  centerlineVisible: boolean;
  racingLineVisible: boolean;

  renderFrame: number | null;
  renderDirty: boolean;
  disposed: boolean;

  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  groundPlane: THREE.Plane;
}
