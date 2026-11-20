import type { BakedTrack } from "../model/baked-track";
import type { TopologyReport } from "../kernel/topology";
import { createSceneState, installRenderLoop } from "./scene/core";
import { installLifecycle } from "./scene/lifecycle";
import {
  pickCenterlineSegment,
  pickControlPoint,
  pickGround as pickGroundAt,
  pickKerbHandle,
  pickKerbRail,
  pickProp,
  pickSpawn,
  pickSurface,
  pickTerrainPoint,
} from "./scene/picking";
import type {
  CentrelineOverlayData,
  KerbOverlayData,
  PropOverlayData,
  TerrainPointOverlayData,
  TrackView,
} from "./scene/types";

export { SURFACE_COLORS } from "./scene/surfaces";
export type {
  CenterlineSegmentPick,
  CentrelineOverlayData,
  ControlPointPick,
  KerbHandlePick,
  KerbOverlayData,
  KerbPreviewOverlayData,
  KerbRailOverlayData,
  KerbRailPick,
  KerbSpanOverlayData,
  PickResult,
  PropOverlayData,
  RoadsideKind,
  TerrainPointOverlayData,
  TrackView,
} from "./scene/types";

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
  const state = createSceneState(
    container,
    initialTrack,
    initialTopology,
    initialCenterlines,
    initialTerrainPoints,
    initialKerbTopology,
    initialKerbs,
    initialProps,
  );
  const { requestRender, onVisibilityChange } = installRenderLoop(state);
  state.controls.addEventListener("change", requestRender);
  const lifecycle = installLifecycle(state, requestRender, onVisibilityChange);

  lifecycle.buildContent();
  lifecycle.frame();

  return {
    update: lifecycle.update,
    updateOverlays: lifecycle.updateOverlays,
    frame: lifecycle.frame,
    setWireframeVisible: lifecycle.setWireframeVisible,
    setBoundaryVisible: lifecycle.setBoundaryVisible,
    setTJunctionsVisible: lifecycle.setTJunctionsVisible,
    setCollisionVisible: lifecycle.setCollisionVisible,
    setCenterlinesVisible: lifecycle.setCenterlinesVisible,
    setRacingLineVisible: lifecycle.setRacingLineVisible,
    setControlsEnabled: lifecycle.setControlsEnabled,
    setSelectedPoint: lifecycle.setSelectedPoint,
    setSelectedTerrainPoint: lifecycle.setSelectedTerrainPoint,
    setJoinTarget: lifecycle.setJoinTarget,
    updateSpawn: lifecycle.updateSpawn,
    pick: (x, y) => pickSurface(state, x, y),
    pickControlPoint: (x, y) => pickControlPoint(state, x, y),
    pickCenterlineSegment: (x, y) => pickCenterlineSegment(state, x, y),
    pickKerbRail: (x, y) => pickKerbRail(state, x, y),
    pickKerbHandle: (x, y) => pickKerbHandle(state, x, y),
    pickProp: (x, y) => pickProp(state, x, y),
    pickTerrainPoint: (x, y) => pickTerrainPoint(state, x, y),
    pickSpawn: (x, y) => pickSpawn(state, x, y),
    pickGround: (x, y) => pickGroundAt(state, x, y),
    focusAt: lifecycle.focusAt,
    screenUnitsPerPixel: lifecycle.screenUnitsPerPixel,
    requestRender,
    resize: lifecycle.resize,
    dispose: lifecycle.dispose,
  };
}
