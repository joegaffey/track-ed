import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BakedTrack } from "../../model/baked-track";
import type { TopologyReport } from "../../kernel/topology";
import type {
  CentrelineOverlayData,
  KerbOverlayData,
  PropOverlayData,
  SceneState,
  TerrainPointOverlayData,
} from "./types";

export function createSceneState(
  container: HTMLElement,
  initialTrack: BakedTrack,
  initialTopology: TopologyReport,
  initialCenterlines: readonly CentrelineOverlayData[],
  initialTerrainPoints: readonly TerrainPointOverlayData[],
  initialKerbTopology?: TopologyReport,
  initialKerbs: KerbOverlayData = { rails: [], spans: [] },
  initialProps: readonly PropOverlayData[] = [],
): SceneState {
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
  controls.zoomToCursor = true;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 1.1;
  controls.minDistance = 0.5;
  controls.screenSpacePanning = true;

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

  return {
    container,
    renderer,
    scene,
    camera,
    controls,
    content,
    sun,
    selectionMarker,
    terrainSelectionMarker,
    joinTargetMarker,

    track: initialTrack,
    topology: initialTopology,
    kerbTopology: initialKerbTopology,
    kerbs: initialKerbs,
    props: initialProps,
    centerlines: initialCenterlines,
    terrainPoints: initialTerrainPoints,

    surfaceMesh: null,
    kerbMesh: null,
    wallMesh: null,
    racingLineMesh: null,

    selectedPoint: null,
    selectedTerrainPoint: null,
    joinTarget: null,

    linePickables: [],
    centerlineOverlayGroup: null,
    terrainPointOverlayGroup: null,
    kerbOverlayGroup: null,
    propGroup: null,
    propPickables: [],
    kerbRailPickables: [],
    kerbHandlePickables: [],
    spawnGroup: null,
    activeSpawn: initialTrack.spawns[0],

    wireframeVisible: true,
    boundaryVisible: true,
    tJunctionsVisible: true,
    collisionVisible: false,
    centerlineVisible: true,
    racingLineVisible: true,

    renderFrame: null,
    renderDirty: true,
    disposed: false,

    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  };
}

export interface RenderLoop {
  requestRender(): void;
  onVisibilityChange(): void;
}

export function installRenderLoop(state: SceneState): RenderLoop {
  function requestRender(): void {
    state.renderDirty = true;
    if (state.renderFrame === null && !state.disposed) {
      state.renderFrame = window.requestAnimationFrame(renderNextFrame);
    }
  }

  function renderNextFrame(): void {
    state.renderFrame = null;
    if (state.disposed || document.hidden) {
      return;
    }
    const dirty = state.renderDirty;
    state.renderDirty = false;
    const controlsChanged = state.controls.update();
    if (!dirty && !controlsChanged) {
      return;
    }
    state.renderer.render(state.scene, state.camera);
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

  return { requestRender, onVisibilityChange };
}

export function updateSun(state: SceneState): void {
  const track = state.track;
  const centerX = (track.bounds.min[0] + track.bounds.max[0]) / 2;
  const centerZ = (track.bounds.min[2] + track.bounds.max[2]) / 2;
  state.sun.position.set(centerX + 120, 220, centerZ + 80);
}

export function frameScene(state: SceneState, requestRender: () => void): void {
  const bounds = state.track.bounds;
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
  state.camera.position.set(
    center.x + span * 0.7,
    center.y + span * 0.85,
    center.z + span * 0.7,
  );
  state.controls.target.copy(center);
  state.controls.update();
  requestRender();
}

export function resizeScene(state: SceneState, requestRender: () => void): void {
  const width = Math.max(state.container.clientWidth, 1);
  const height = Math.max(state.container.clientHeight, 1);
  state.renderer.setSize(width, height);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  requestRender();
}
