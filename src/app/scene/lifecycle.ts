import * as THREE from "three";
import type { BakedTrack, Spawn } from "../../model/baked-track";
import type { TopologyReport } from "../../kernel/topology";
import {
  frameScene,
  resizeScene,
  updateSun,
} from "./core";
import {
  buildCenterlineOverlays,
  buildKerbOverlays,
  buildProps,
  buildSpawnOverlay,
  buildTerrainPointOverlays,
  disposeObject,
  updateJoinTargetMarker,
  updateSelectionMarker,
  updateSpawnOverlay,
  updateTerrainSelectionMarker,
} from "./overlays";
import { pickGround } from "./picking";
import { buildSurfaceMeshes } from "./surfaces";
import type {
  CentrelineOverlayData,
  ControlPointPick,
  KerbOverlayData,
  PropOverlayData,
  SceneState,
  TerrainPointOverlayData,
} from "./types";

export function buildContent(state: SceneState, requestRender: () => void): void {
  disposeObject(state.content);
  state.content.clear();
  state.surfaceMesh = null;
  state.kerbMesh = null;
  state.wallMesh = null;
  state.linePickables = [];
  state.spawnGroup = null;

  state.centerlineOverlayGroup = new THREE.Group();
  state.centerlineOverlayGroup.name = "centerline-overlays";
  state.centerlineOverlayGroup.visible = state.centerlineVisible;
  state.content.add(state.centerlineOverlayGroup);
  state.terrainPointOverlayGroup = new THREE.Group();
  state.terrainPointOverlayGroup.name = "terrain-point-overlays";
  state.content.add(state.terrainPointOverlayGroup);
  state.kerbOverlayGroup = new THREE.Group();
  state.kerbOverlayGroup.name = "kerb-overlays";
  state.content.add(state.kerbOverlayGroup);
  state.propGroup = new THREE.Group();
  state.propGroup.name = "props";
  state.content.add(state.propGroup);

  buildSurfaceMeshes(state);

  buildCenterlineOverlays(state);
  buildTerrainPointOverlays(state);
  buildKerbOverlays(state);
  buildProps(state);

  buildSpawnOverlay(state, state.track.spawns[0]);

  updateSun(state);
  updateSelectionMarker(state);
  updateTerrainSelectionMarker(state);
  updateJoinTargetMarker(state);
  requestRender();
}

export interface SceneLifecycle {
  buildContent(): void;
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
  focusAt(x: number, y: number): boolean;
  screenUnitsPerPixel(): number;
  resize(): void;
  dispose(): void;
}

export function installLifecycle(
  state: SceneState,
  requestRender: () => void,
  onVisibilityChange: () => void,
): SceneLifecycle {
  const setCenterlineVisibility = (visible: boolean): void => {
    state.centerlineVisible = visible;
    if (state.centerlineOverlayGroup) {
      state.centerlineOverlayGroup.visible = visible;
    }
  };

  return {
    buildContent(): void {
      buildContent(state, requestRender);
    },
    update(
      nextTrack,
      nextTopology,
      nextCenterlines,
      nextTerrainPoints,
      nextKerbTopology,
      nextKerbs,
      nextProps,
    ): void {
      state.track = nextTrack;
      state.topology = nextTopology;
      state.kerbTopology = nextKerbTopology;
      state.centerlines = nextCenterlines;
      state.terrainPoints = nextTerrainPoints;
      state.kerbs = nextKerbs ?? state.kerbs;
      state.props = nextProps ?? state.props;
      buildContent(state, requestRender);
      requestRender();
    },
    updateOverlays(nextCenterlines, nextTerrainPoints, nextKerbs, nextProps): void {
      state.centerlines = nextCenterlines;
      state.terrainPoints = nextTerrainPoints;
      state.kerbs = nextKerbs ?? state.kerbs;
      state.props = nextProps ?? state.props;
      buildCenterlineOverlays(state);
      buildTerrainPointOverlays(state);
      buildKerbOverlays(state);
      buildProps(state);
      updateSelectionMarker(state);
      updateTerrainSelectionMarker(state);
      updateJoinTargetMarker(state);
      requestRender();
    },
    frame(): void {
      frameScene(state, requestRender);
    },
    setWireframeVisible(visible: boolean): void {
      state.wireframeVisible = visible;
      const wireframe = state.content.getObjectByName("wireframe");
      if (wireframe) {
        wireframe.visible = visible;
      }
      requestRender();
    },
    setBoundaryVisible(visible: boolean): void {
      state.boundaryVisible = visible;
      const group = state.content.getObjectByName("boundary-edges");
      if (group) {
        group.visible = visible;
      }
      requestRender();
    },
    setTJunctionsVisible(visible: boolean): void {
      state.tJunctionsVisible = visible;
      const points = state.content.getObjectByName("t-junctions");
      if (points) {
        points.visible = visible;
      }
      requestRender();
    },
    setCollisionVisible(visible: boolean): void {
      state.collisionVisible = visible;
      const collision = state.content.getObjectByName("collision-overlay");
      if (collision) {
        collision.visible = visible;
      }
      requestRender();
    },
    setCenterlinesVisible(visible: boolean): void {
      setCenterlineVisibility(visible);
      requestRender();
    },
    setRacingLineVisible(visible: boolean): void {
      state.racingLineVisible = visible;
      if (state.racingLineMesh) {
        state.racingLineMesh.visible = visible;
      }
      requestRender();
    },
    setControlsEnabled(enabled: boolean): void {
      state.controls.enabled = enabled;
    },
    setSelectedPoint(point: ControlPointPick | null): void {
      state.selectedPoint = point;
      updateSelectionMarker(state);
      requestRender();
    },
    setSelectedTerrainPoint(index: number | null): void {
      state.selectedTerrainPoint = index;
      updateTerrainSelectionMarker(state);
      requestRender();
    },
    setJoinTarget(point: ControlPointPick | null): void {
      state.joinTarget = point;
      updateJoinTargetMarker(state);
      requestRender();
    },
    updateSpawn(spawn: Spawn | null): void {
      updateSpawnOverlay(state, spawn);
      requestRender();
    },
    focusAt(x: number, y: number): boolean {
      const focusMeshes = [state.surfaceMesh, state.kerbMesh, state.wallMesh].filter(
        (mesh): mesh is THREE.Mesh => mesh !== null,
      );
      state.pointer.set(x, y);
      state.raycaster.setFromCamera(state.pointer, state.camera);
      const hit = state.raycaster.intersectObjects(focusMeshes, false)[0];
      let focus = hit?.point.clone();
      if (!focus) {
        const ground = pickGround(state, x, y);
        if (!ground) {
          return false;
        }
        focus = new THREE.Vector3(ground[0], 0, ground[1]);
      }
      const delta = focus.clone().sub(state.controls.target);
      state.controls.target.add(delta);
      state.camera.position.add(delta);
      state.controls.update();
      requestRender();
      return true;
    },
    screenUnitsPerPixel(): number {
      const distance = state.camera.position.distanceTo(state.controls.target);
      const height = Math.max(state.renderer.domElement.clientHeight, 1);
      return (
        (2 * distance * Math.tan((state.camera.fov * Math.PI) / 360)) /
        height
      );
    },
    resize(): void {
      resizeScene(state, requestRender);
    },
    dispose(): void {
      state.disposed = true;
      if (state.renderFrame !== null) {
        window.cancelAnimationFrame(state.renderFrame);
        state.renderFrame = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      state.controls.removeEventListener("change", requestRender);
      state.controls.dispose();
      disposeObject(state.content);
      state.selectionMarker.geometry.dispose();
      (state.selectionMarker.material as THREE.Material).dispose();
      state.terrainSelectionMarker.geometry.dispose();
      (state.terrainSelectionMarker.material as THREE.Material).dispose();
      state.joinTargetMarker.geometry.dispose();
      (state.joinTargetMarker.material as THREE.Material).dispose();
      state.renderer.dispose();
      state.renderer.domElement.remove();
    },
  };
}
