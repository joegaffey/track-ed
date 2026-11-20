import type {
  Project,
  ProjectRoadsideKind,
  ProjectRoadsideRun,
  ProjectRoadsideSpline,
} from "../../kernel/project";
import type { BakedTrack } from "../../model/baked-track";
import type { Vec2 } from "../../kernel/math2";
import type { ValidationReport } from "../../kernel/validate-baked";
import type {
  CenterlineSegmentPick,
  ControlPointPick,
  TrackView,
} from "../scene";
import type { DragState } from "./drag";

export type EditorMode = "terrain" | "track" | "roadside";
export type StatusTone = "ok" | "error" | "";

export type Section = Project["centerlines"][number];

export interface RoadsideSelection {
  sectionId: string;
  splineId: string;
}

export interface RoadsideRunSelection extends RoadsideSelection {
  runIndex: number;
}

export interface LocatedRoadsideSpline {
  section: Section;
  spline: ProjectRoadsideSpline;
}

export interface LocatedRoadsideRun extends LocatedRoadsideSpline {
  run: ProjectRoadsideRun;
}

export interface EditingElements {
  statusToggle: HTMLButtonElement;
  pickInfo: HTMLDivElement;
  viewport: HTMLDivElement;
  exportButton: HTMLButtonElement;
  testDriveButton: HTMLButtonElement;
  exportStatus: HTMLDivElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  addSectionButton: HTMLButtonElement;
  addJunctionButton: HTMLButtonElement;
  splitLoopButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  openButton: HTMLButtonElement;
  frameButton: HTMLButtonElement;
  newButton: HTMLButtonElement;
  openFile: HTMLInputElement;
  spawnCenterline: HTMLSelectElement;
  terrainMode: HTMLSelectElement;
  addTerrainPointButton: HTMLButtonElement;
  deleteTerrainPointButton: HTMLButtonElement;
  clearTerrainPointsButton: HTMLButtonElement;
  terrainPointHeight: HTMLInputElement;
  modeRoadsideButton: HTMLButtonElement;
  modeTerrainButton: HTMLButtonElement;
  modePointsButton: HTMLButtonElement;
  roadsideSectionSelect: HTMLSelectElement;
  roadsideNewOffset: HTMLInputElement;
  roadsideAddSplineButton: HTMLButtonElement;
  roadsideRemoveSplineButton: HTMLButtonElement;
  roadsideRunProperty: HTMLInputElement;
  roadsideRunRemoveButton: HTMLButtonElement;
  roadsideKindButtons: Array<[HTMLButtonElement, ProjectRoadsideKind]>;
  centerlineToggle: HTMLInputElement;
  racingLineToggle: HTMLInputElement;
  wireframeToggle: HTMLInputElement;
  boundaryToggle: HTMLInputElement;
  tJunctionToggle: HTMLInputElement;
  collisionToggle: HTMLInputElement;
}

/**
 * Narrow typed surface over the existing app state. The app keeps the mutable
 * project/selection state; editing modules only read and mutate it through
 * this context so the handlers stay independently reviewable.
 */
export interface EditingContext {
  // Project, view and transient editor state.
  getProject(): Project | null;
  setProject(project: Project): void;
  cloneProject(project: Project): Project;
  getView(): TrackView | null;
  isBakeValid(): boolean;
  getCurrentTrack(): BakedTrack | null;
  getCurrentReport(): ValidationReport | null;
  getUndoDepth(): number;

  // Selection.
  getSelectedPoint(): ControlPointPick | null;
  setSelection(point: ControlPointPick | null): void;
  getSelectedTerrainPoint(): number | null;
  setTerrainSelection(index: number | null): void;

  // Editing mode and drag state.
  getEditorMode(): EditorMode;
  setEditorMode(mode: EditorMode): void;
  getDrag(): DragState;
  setDrag(drag: DragState): void;

  // Terrain authoring.
  getAddTerrainPointMode(): boolean;
  setAddTerrainPointMode(value: boolean): void;
  addTerrainPointAt(position: [number, number, number]): void;
  deleteSelectedTerrainPoint(): void;
  clearTerrainPoints(): void;

  // Roadside authoring.
  getRoadsideSectionId(): string | null;
  setRoadsideSectionId(id: string | null): void;
  getSelectedRoadsideSpline(): RoadsideSelection | null;
  setSelectedRoadsideSpline(value: RoadsideSelection | null): void;
  getSelectedRoadsideRun(): RoadsideRunSelection | null;
  setSelectedRoadsideRun(value: RoadsideRunSelection | null): void;
  getRoadsidePaintKind(): ProjectRoadsideKind;
  setRoadsidePaintKind(kind: ProjectRoadsideKind): void;
  addRoadsideSpline(): void;
  removeRoadsideSpline(): void;
  removeRoadsideRun(): void;
  editRoadsideRun(update: (run: ProjectRoadsideRun) => void): void;
  finishRoadsideEdit(): void;
  roadsideDefaultOffset(project: Project, kind: ProjectRoadsideKind): number;
  updateRoadsideUI(project: Project): void;
  findRoadsideSpline(
    project: Project,
    sectionId: string,
    splineId: string,
  ): LocatedRoadsideSpline | null;
  findRoadsideRun(
    project: Project,
    sectionId: string,
    splineId: string,
    runIndex: number,
  ): LocatedRoadsideRun | null;
  findRoadsideRunAt(
    spline: ProjectRoadsideSpline,
    fraction: number,
    closed: boolean,
  ): number | null;
  roadsideRunOverlaps(
    spline: ProjectRoadsideSpline,
    start: number,
    length: number,
    closed: boolean,
    kind: ProjectRoadsideKind,
    ignoreIndex?: number,
  ): boolean;
  nearestPolylineFraction(section: Section, point: Vec2): number | null;

  // Scheduling, rendering and status.
  scheduleRender(options?: { maxWait?: number }): void;
  scheduleDragRender(): void;
  flushPendingRender(): boolean;
  scheduleOverlayUpdate(): void;
  updateAuthoringUI(): void;
  setEditStatus(message: string, tone?: StatusTone): void;
  setRoadsideStatus(message: string, tone?: StatusTone): void;
  pushUndo(snapshot: Project): void;
  renderProject(input: unknown, options?: { frame?: boolean }): boolean;
  loadProject(input: unknown, frame: boolean): void;
  loadDefaultProject(): void;
  undo(): void;
  redo(): void;
  deleteSelectedPoint(): void;
  addLooseSectionAtSelected(): void;
  splitLoopAtSelection(): void;
  addJunction(): void;
  insertPoint(pick: CenterlineSegmentPick): void;
  updateStatusCollapsed(): void;
  isStatusExpanded(): boolean;
  setStatusExpanded(value: boolean): void;

  // Model helpers used by the pointer state machine.
  syncBranchStart(source: Project): void;
  nextPointId(centerline: Section): string;
  mainOf(source: Project): Section | undefined;
  branchesOf(source: Project): Project["centerlines"];
  moveBranchAttach(source: Project, fraction: number): void;
  isJunctionReferenced(source: Project, junctionId: string): boolean;
  findJoinTarget(
    source: Project,
    branchIndex: number,
    pointIndex: number,
    position: Vec2,
  ): ControlPointPick | null;
  applyBranchEndJoin(
    source: Project,
    branch: Section,
    target: ControlPointPick,
  ): boolean;
  applyBranchEndMerge(
    source: Project,
    branch: Section,
    target: ControlPointPick,
  ): string | null;
  applySectionJunction(
    source: Project,
    branch: Section,
    target: ControlPointPick,
    draggedPointIndex: number,
  ): string | null;
  applySectionLoopClose(
    source: Project,
    branch: Section,
    target: ControlPointPick,
    draggedPointIndex: number,
  ): string | null;
  applySectionEndMerge(
    source: Project,
    branch: Section,
    target: ControlPointPick,
    draggedPointIndex: number,
  ): string | null;

  // Output helpers shared with the control wiring.
  formatNumber(value: number): string;
  hashBytes(bytes: Uint8Array): string;
  downloadBytes(name: string, bytes: Uint8Array, mimeType: string): void;
  serializeProject(source: Project): unknown;

  elements: EditingElements;
}
