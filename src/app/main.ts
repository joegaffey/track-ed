import "./style.css";
import loopSplineTerrainJunctionsFixture from "../../fixtures/projects/loop-spline-terrain-junctions.json";
import { bakeProject, BakeError, spawnFor } from "../kernel/bake";
import {
  DEFAULT_KERB_FLAT_HEIGHT,
  DEFAULT_KERB_CORNER_HEIGHT,
  KERB_WIDTH,
} from "../kernel/kerbs";
import { parseProject, type Project, type ProjectKerbSpan } from "../kernel/project";
import { samplePolyline, segmentLengths } from "../kernel/geometry";
import { fractionAtControlPoint, sampleCenterline } from "../kernel/spline";
import { buildPointTerrainSampler, rawTerrainHeight } from "../kernel/terrain";
import {
  distancePointToSegmentSq,
  leftNormal,
  pointOnSegmentParameter,
  scale2,
  signedArea2,
  type Vec2,
} from "../kernel/math2";
import { validateBakedTrack, type ValidationReport } from "../kernel/validate-baked";
import { exportLapsterGlbTrack } from "../export/lapster";
import {
  createTrackView,
  SURFACE_COLORS,
  type CenterlineSegmentPick,
  type CentrelineOverlayData,
  type ControlPointPick,
  type KerbOverlayData,
  type KerbRailOverlayData,
  type TerrainPointOverlayData,
  type TrackView,
} from "./scene";
import type { BakedTrack, Spawn, Vec3 } from "../model/baked-track";
import { mergeLooseBranchEnds } from "./branch-merge";
import { convertProjectToV3 } from "./convert-project";
import {
  addJunctionMember,
  addLooseSectionAtPoint,
  addSectionAtPoint,
  closeSectionLoop,
  isLooseSectionEnd,
  isSectionPointInJunction,
  mergeLooseSectionEnds,
  removeJunctionWithGap,
  splitClosedSection,
  splitOpenSection,
  syncSectionJunctions,
} from "./section-edit";

type DragState =
  | {
      kind: "point";
      centerlineIndex: number;
      pointIndex: number;
      startProject: Project;
      pendingDetach?: boolean;
    }
  | { kind: "attach"; startProject: Project }
  | { kind: "spawn"; startProject: Project }
  | {
      kind: "kerb-paint";
      sectionId: string;
      side: "left" | "right";
      closed: boolean;
      originFraction: number;
      previousFraction: number;
      signedLength: number;
      startProject: Project;
    }
  | {
      kind: "kerb-entry" | "kerb-exit";
      sectionId: string;
      spanIndex: number;
      startProject: Project;
    }
  | {
      kind: "terrain-point";
      index: number;
      startProject: Project;
      startHeight: number;
      startClientY: number;
      unitsPerPixel: number;
    }
  | null;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("missing #app element");
}

app.className = "app-shell";
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark"></span>
      <div>
        <h1>track-ed</h1>
        <p>browser track geometry editor</p>
      </div>
      <span class="badge">v1</span>
    </div>
    <div class="topbar-right">
      <div class="mode-switch" role="group" aria-label="Editing mode">
        <button class="mode-button active" id="mode-points" type="button">Points</button>
        <button class="mode-button" id="mode-kerbs" type="button">Kerbs</button>
      </div>
      <div class="project-meta" id="project-meta"></div>
    </div>
  </header>
  <div class="workspace">
    <div class="viewport" id="viewport"></div>
    <aside class="sidebar">
      <section class="panel status-panel" id="status-panel"></section>
      <section class="panel">
        <h2>Sections</h2>
        <div class="section-list" id="section-list"></div>
      </section>
      <section class="panel">
        <h2>Authoring</h2>
        <div class="edit-actions">
          <button class="edit-button" id="undo-button" type="button">Undo</button>
          <button class="edit-button" id="redo-button" type="button">Redo</button>
          <button class="edit-button" id="delete-button" type="button">Delete point</button>
          <button class="edit-button" id="add-section-button" type="button">Add section</button>
          <button class="edit-button" id="add-junction-button" type="button">Add junction</button>
          <button class="edit-button" id="split-loop-button" type="button">Split loop</button>
        </div>
        <div class="edit-field" id="attach-field" hidden>
          <label for="attach-fraction">attach <span id="attach-value">0.000</span></label>
          <input type="range" id="attach-fraction" min="0" max="0.999" step="0.001" />
        </div>
        <div class="junction-list" id="junction-list"></div>
        <p class="edit-hint">
          Drag control points. Double-click a centreline to insert a point. Delete removes the
          selected point. Select any control point, then Add section for an independent dead-ended
          section, or Add junction for a spur joined at that point. Drag a loose end onto another
          section point to join; drag onto another loose end to merge. Split section opens a
          closed loop or divides an open section with a gap.
        </p>
        <div class="edit-status" id="edit-status"></div>
      </section>
      <section class="panel">
        <h2>Project</h2>
        <div class="edit-actions">
          <button class="edit-button" id="save-button" type="button">Save JSON</button>
          <button class="edit-button" id="open-button" type="button">Open JSON</button>
          <button class="edit-button" id="frame-button" type="button">Frame view</button>
          <button class="edit-button" id="new-button" type="button">New loop</button>
        </div>
        <input type="file" id="open-file" accept=".json,application/json" hidden />
      </section>
      <section class="panel">
        <h2>Spawn</h2>
        <div class="edit-field">
          <label for="spawn-centerline">centreline</label>
          <select id="spawn-centerline"></select>
        </div>
        <div class="edit-field">
          <label for="spawn-fraction">fraction <span id="spawn-fraction-value">0.000</span></label>
          <input type="range" id="spawn-fraction" min="0" max="0.999" step="0.001" />
        </div>
        <div class="edit-field">
          <label for="spawn-lateral">lateral <span id="spawn-lateral-value">0.0 m</span></label>
          <input type="range" id="spawn-lateral" min="-5" max="5" step="0.1" />
        </div>
        <p class="edit-hint">Drag the spawn arrow to move it along its centreline.</p>
      </section>
      <section class="panel">
        <h2>Terrain points</h2>
        <div class="edit-field">
          <label for="terrain-mode">road mode</label>
          <select id="terrain-mode">
            <option value="conform">Terrain conforms to road</option>
            <option value="follow">Road follows terrain</option>
          </select>
        </div>
        <div class="edit-actions">
          <button class="edit-button" id="add-terrain-point" type="button">Add point</button>
          <button class="edit-button" id="delete-terrain-point" type="button">Delete point</button>
          <button class="edit-button" id="clear-terrain-points" type="button">Clear points</button>
        </div>
        <div class="edit-field" id="terrain-point-height-field" hidden>
          <label for="terrain-point-height">point height (m)</label>
          <input type="number" id="terrain-point-height" step="0.1" />
        </div>
        <p class="edit-hint">
          Use Add point, then click the terrain. Drag a terrain point vertically or type an exact
          height. More points create a more detailed terrain.
        </p>
        <div class="edit-status" id="terrain-point-status"></div>
      </section>
      <section class="panel">
        <h2>Kerbs</h2>
        <div class="edit-field">
          <label for="kerb-global-flat">global flat height (m)</label>
          <input type="number" id="kerb-global-flat" min="0" step="0.005" />
        </div>
        <div class="edit-field">
          <label for="kerb-global-corner">global corner height (m)</label>
          <input type="number" id="kerb-global-corner" min="0" step="0.005" />
        </div>
        <div class="junction-list" id="kerb-list"></div>
        <div class="edit-field" id="kerb-span-heights" hidden>
          <label class="toggle"><input type="checkbox" id="kerb-span-override" /> override heights for this span</label>
        </div>
        <div class="edit-field" id="kerb-span-flat-field" hidden>
          <label for="kerb-span-flat">span flat height (m)</label>
          <input type="number" id="kerb-span-flat" min="0" step="0.005" />
        </div>
        <div class="edit-field" id="kerb-span-corner-field" hidden>
          <label for="kerb-span-corner">span corner height (m)</label>
          <input type="number" id="kerb-span-corner" min="0" step="0.005" />
        </div>
        <div class="edit-actions">
          <button class="edit-button" id="kerb-remove" type="button">Remove span</button>
        </div>
        <p class="edit-hint">
          Switch to Kerbs mode, then drag a dotted guide rail to paint a kerb span.
          Select a span and drag its endpoint handles to resize it. Delete removes the selected span.
          Flat and corner heights apply globally, with optional per-span overrides.
        </p>
        <div class="edit-status" id="kerb-status"></div>
      </section>
      <section class="panel">
        <h2>Overlays</h2>
        <div class="toggle-list">
          <label class="toggle"><input type="checkbox" id="toggle-centerline" checked /> Centreline</label>
          <label class="toggle"><input type="checkbox" id="toggle-wireframe" checked /> Wireframe</label>
          <label class="toggle"><input type="checkbox" id="toggle-boundary" checked /> Boundary edges</label>
          <label class="toggle"><input type="checkbox" id="toggle-tjunctions" checked /> T-junctions</label>
          <label class="toggle"><input type="checkbox" id="toggle-collision" /> Collision overlay</label>
        </div>
      </section>
      <section class="panel">
        <h2>Surface legend</h2>
        <div class="legend" id="surface-legend"></div>
      </section>
      <section class="panel">
        <h2>Triangle inspector</h2>
        <div class="pick-info" id="pick-info">Hover a surface triangle.</div>
      </section>
      <section class="panel">
        <h2>Validation</h2>
        <div class="violations" id="violations"></div>
      </section>
      <section class="panel export-panel">
        <h2>Export</h2>
        <button class="export-button" id="export-button" type="button">
          Download track.glb + track.json
        </button>
        <div class="export-status" id="export-status"></div>
      </section>
    </aside>
  </div>
`;

const projectMeta = document.querySelector<HTMLDivElement>("#project-meta")!;
const statusPanel = document.querySelector<HTMLElement>("#status-panel")!;
const surfaceLegend = document.querySelector<HTMLDivElement>("#surface-legend")!;
const pickInfo = document.querySelector<HTMLDivElement>("#pick-info")!;
const violationsContainer = document.querySelector<HTMLDivElement>("#violations")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-button")!;
const exportStatus = document.querySelector<HTMLDivElement>("#export-status")!;
const viewport = document.querySelector<HTMLDivElement>("#viewport")!;
const undoButton = document.querySelector<HTMLButtonElement>("#undo-button")!;
const redoButton = document.querySelector<HTMLButtonElement>("#redo-button")!;
const deleteButton = document.querySelector<HTMLButtonElement>("#delete-button")!;
const addSectionButton =
  document.querySelector<HTMLButtonElement>("#add-section-button")!;
const addJunctionButton =
  document.querySelector<HTMLButtonElement>("#add-junction-button")!;
const splitLoopButton =
  document.querySelector<HTMLButtonElement>("#split-loop-button")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save-button")!;
const openButton = document.querySelector<HTMLButtonElement>("#open-button")!;
const frameButton = document.querySelector<HTMLButtonElement>("#frame-button")!;
const newButton = document.querySelector<HTMLButtonElement>("#new-button")!;
const openFile = document.querySelector<HTMLInputElement>("#open-file")!;
const attachField = document.querySelector<HTMLDivElement>("#attach-field")!;
const attachFraction = document.querySelector<HTMLInputElement>("#attach-fraction")!;
const attachValue = document.querySelector<HTMLSpanElement>("#attach-value")!;
const sectionList = document.querySelector<HTMLDivElement>("#section-list")!;
const junctionList = document.querySelector<HTMLDivElement>("#junction-list")!;
const editStatus = document.querySelector<HTMLDivElement>("#edit-status")!;
const spawnCenterline = document.querySelector<HTMLSelectElement>("#spawn-centerline")!;
const spawnFraction = document.querySelector<HTMLInputElement>("#spawn-fraction")!;
const spawnFractionValue = document.querySelector<HTMLSpanElement>("#spawn-fraction-value")!;
const spawnLateral = document.querySelector<HTMLInputElement>("#spawn-lateral")!;
const spawnLateralValue = document.querySelector<HTMLSpanElement>("#spawn-lateral-value")!;
const terrainMode = document.querySelector<HTMLSelectElement>("#terrain-mode")!;
const addTerrainPointButton = document.querySelector<HTMLButtonElement>("#add-terrain-point")!;
const deleteTerrainPointButton =
  document.querySelector<HTMLButtonElement>("#delete-terrain-point")!;
const clearTerrainPointsButton =
  document.querySelector<HTMLButtonElement>("#clear-terrain-points")!;
const terrainPointHeightField =
  document.querySelector<HTMLDivElement>("#terrain-point-height-field")!;
const terrainPointHeight = document.querySelector<HTMLInputElement>("#terrain-point-height")!;
const terrainPointStatus = document.querySelector<HTMLDivElement>("#terrain-point-status")!;
const modePointsButton = document.querySelector<HTMLButtonElement>("#mode-points")!;
const modeKerbsButton = document.querySelector<HTMLButtonElement>("#mode-kerbs")!;
const kerbGlobalFlat = document.querySelector<HTMLInputElement>("#kerb-global-flat")!;
const kerbGlobalCorner = document.querySelector<HTMLInputElement>("#kerb-global-corner")!;
const kerbSpanHeights = document.querySelector<HTMLDivElement>("#kerb-span-heights")!;
const kerbSpanOverride = document.querySelector<HTMLInputElement>("#kerb-span-override")!;
const kerbSpanFlatField = document.querySelector<HTMLDivElement>("#kerb-span-flat-field")!;
const kerbSpanFlat = document.querySelector<HTMLInputElement>("#kerb-span-flat")!;
const kerbSpanCornerField = document.querySelector<HTMLDivElement>("#kerb-span-corner-field")!;
const kerbSpanCorner = document.querySelector<HTMLInputElement>("#kerb-span-corner")!;
const kerbRemoveButton = document.querySelector<HTMLButtonElement>("#kerb-remove")!;
const kerbList = document.querySelector<HTMLDivElement>("#kerb-list")!;
const kerbStatus = document.querySelector<HTMLDivElement>("#kerb-status")!;

const centerlineToggle = document.querySelector<HTMLInputElement>("#toggle-centerline")!;
const wireframeToggle = document.querySelector<HTMLInputElement>("#toggle-wireframe")!;
const boundaryToggle = document.querySelector<HTMLInputElement>("#toggle-boundary")!;
const tJunctionToggle = document.querySelector<HTMLInputElement>("#toggle-tjunctions")!;
const collisionToggle = document.querySelector<HTMLInputElement>("#toggle-collision")!;

let project: Project | null = null;
let view: TrackView | null = null;
let currentTrack: BakedTrack | null = null;
let currentReport: ValidationReport | null = null;
let selectedPoint: ControlPointPick | null = null;
let undoStack: Project[] = [];
let redoStack: Project[] = [];
let drag: DragState = null;
let sliderStart: Project | null = null;
let spawnFractionStart: Project | null = null;
let spawnLateralStart: Project | null = null;
let selectedTerrainPoint: number | null = null;
let addTerrainPointMode = false;
let selectedKerbSpan: { sectionId: string; index: number } | null = null;
let kerbEditStart: Project | null = null;
let editorMode: "points" | "kerbs" = "points";
let bakeValid = false;

const RENDER_DELAY_MS = 150;
const RENDER_MAX_WAIT_MS = 300;
let renderTimer: number | null = null;
let renderFirstScheduledAt = 0;

function cancelPendingRender(): void {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer);
    renderTimer = null;
  }
  renderFirstScheduledAt = 0;
}

function scheduleRender(options: { maxWait?: number } = {}): void {
  if (!project) {
    return;
  }
  exportButton.disabled = true;
  const now = performance.now();
  if (renderTimer === null) {
    renderFirstScheduledAt = now;
  } else {
    window.clearTimeout(renderTimer);
  }
  const maxWait = options.maxWait ?? RENDER_MAX_WAIT_MS;
  const elapsed = now - renderFirstScheduledAt;
  const wait = Math.max(0, Math.min(RENDER_DELAY_MS, maxWait - elapsed));
  renderTimer = window.setTimeout(() => {
    renderTimer = null;
    renderFirstScheduledAt = 0;
    if (project) {
      renderProject(project, { frame: false });
    }
  }, wait);
}

function scheduleDragRender(): void {
  scheduleRender({ maxWait: Number.POSITIVE_INFINITY });
}

function flushPendingRender(): boolean {
  if (renderTimer === null) {
    return bakeValid;
  }
  cancelPendingRender();
  return project ? renderProject(project, { frame: false }) : false;
}

let overlayFrame: number | null = null;

function cancelOverlayUpdate(): void {
  if (overlayFrame !== null) {
    window.cancelAnimationFrame(overlayFrame);
    overlayFrame = null;
  }
}

function scheduleOverlayUpdate(): void {
  if (!project || !view || overlayFrame !== null) {
    return;
  }
  overlayFrame = window.requestAnimationFrame(() => {
    overlayFrame = null;
    if (!project || !view || !currentTrack) {
      return;
    }
    view.updateOverlays(
      overlayCenterlines(project, currentTrack.bounds),
      overlayTerrainPoints(project),
      overlayKerbs(project, currentTrack.bounds),
    );
    let spawn: Spawn | null = null;
    try {
      spawn = spawnFor(project);
    } catch {
      spawn = null;
    }
    view.updateSpawn(spawn);
  });
}

function cloneProject(source: Project): Project {
  return structuredClone(source);
}

function setEditStatus(message: string, tone: "ok" | "error" | "" = ""): void {
  editStatus.textContent = message;
  editStatus.className = `edit-status ${tone}`.trim();
}

function branchesOf(source: Project): Project["centerlines"] {
  return source.centerlines.filter((centerline) => !centerline.closed);
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

function nextPointId(centerline: Project["centerlines"][number]): string {
  const used = new Set(centerline.pointIds);
  let index = centerline.pointIds.length;
  let id = `${centerline.id}-p${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${centerline.id}-p${index}`;
  }
  return id;
}

function mainOf(source: Project): Project["centerlines"][number] | undefined {
  return source.centerlines.find((centerline) => centerline.closed);
}

function syncBranchStart(source: Project): void {
  if (source.schema === "track-ed/project@3") {
    syncSectionJunctions(source);
    return;
  }
  const moveToJunction = (
    branch: Project["centerlines"][number],
    junctionId: string,
    pointIndex: number,
  ): void => {
    const junction = source.junctions.find((candidate) => candidate.id === junctionId);
    if (!junction) {
      return;
    }
    const host = source.centerlines.find(
      (candidate) => candidate.id === junction.centerline,
    );
    if (!host) {
      return;
    }
    const hostIndex = host.pointIds.indexOf(junction.point);
    const hostPoint = hostIndex >= 0 ? host.points[hostIndex] : undefined;
    if (!hostPoint) {
      return;
    }
    branch.points[pointIndex] = [hostPoint[0], hostPoint[1]];
    branch.pointIds[pointIndex] = junction.point;
  };

  for (const branch of branchesOf(source)) {
    const attach = branch.attach;
    if (!attach || branch.points.length === 0) {
      continue;
    }
    if ("junction" in attach) {
      moveToJunction(branch, attach.junction, 0);
    } else {
      const host = source.centerlines.find((candidate) => candidate.id === attach.to);
      if (!host) {
        continue;
      }
      const sampledHost = sampleCenterline(
        host.points as Vec2[],
        host.closed,
        host.spline,
      );
      const sample = samplePolyline(sampledHost, host.closed, attach.fraction);
      branch.points[0] = [sample.position[0], sample.position[1]];
    }

    const endAttach = branch.endAttach;
    if (endAttach && "junction" in endAttach) {
      moveToJunction(branch, endAttach.junction, branch.points.length - 1);
    }
  }
}

function moveBranchAttach(source: Project, fraction: number): void {
  const branch = branchesOf(source).find(
    (candidate) => candidate.attach && "to" in candidate.attach,
  );
  if (!branch?.attach || !("fraction" in branch.attach)) {
    return;
  }
  branch.attach.fraction = Math.max(0, Math.min(0.999, fraction));
  syncBranchStart(source);
}

function pushUndo(snapshot: Project): void {
  undoStack.push(snapshot);
  if (undoStack.length > 60) {
    undoStack.shift();
  }
  redoStack = [];
}

function updateAuthoringUI(): void {
  updateModeUI();
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
  deleteButton.disabled = selectedPoint === null;
  const sectionVenue = project?.schema === "track-ed/project@3";
  addSectionButton.disabled = !sectionVenue || selectedPoint === null;
  addSectionButton.title = sectionVenue
    ? "Create an independent dead-ended section near the selected control point."
    : "Independent sections require track-ed/project@3.";
  addJunctionButton.disabled = project === null || selectedPoint === null;
  addJunctionButton.title = sectionVenue
    ? "Create a dead-ended section joined at the selected control point."
    : "Create a junction and spur at the selected main-loop control point.";
  const legacyBranch = project
    ? branchesOf(project).find(
        (candidate) => candidate.attach && "to" in candidate.attach,
      )
    : undefined;
  attachField.hidden = !legacyBranch;
  if (legacyBranch?.attach && "fraction" in legacyBranch.attach) {
    attachFraction.value = String(legacyBranch.attach.fraction);
    attachValue.textContent = legacyBranch.attach.fraction.toFixed(3);
  }
  const selectedSection = selectedPoint
    ? project?.centerlines[selectedPoint.centerlineIndex]
    : undefined;
  const selectedPointId =
    selectedPoint && selectedSection
      ? selectedSection.pointIds[selectedPoint.pointIndex]
      : undefined;
  const selectedPointIndex = selectedPoint?.pointIndex;
  const selectedEndpoint =
    selectedSection !== undefined &&
    !selectedSection.closed &&
    (selectedPointIndex === 0 ||
      selectedPointIndex === selectedSection.points.length - 1);
  splitLoopButton.textContent = selectedSection?.closed ? "Split loop" : "Split section";
  splitLoopButton.disabled =
    project?.schema !== "track-ed/project@3" ||
    !selectedSection ||
    selectedPointId === undefined ||
    selectedEndpoint ||
    (project !== null &&
      isSectionPointInJunction(project, selectedSection.id, selectedPointId));
  splitLoopButton.title =
    project?.schema === "track-ed/project@3"
      ? selectedSection?.closed
        ? "Open the selected closed loop with a road-width gap."
        : "Split the selected open section into two capped sections."
      : "Section splitting requires track-ed/project@3.";
  exportButton.disabled =
    renderTimer !== null || !bakeValid || currentReport === null || !currentReport.ok;
  if (project) {
    updateSpawnUI(project);
    updateTerrainPointsUI(project);
    updateSectionList(project);
    updateJunctionList(project);
    updateKerbsUI(project);
  } else {
    sectionList.innerHTML = "";
    kerbList.innerHTML = "";
  }
}

function updateModeUI(): void {
  modePointsButton.classList.toggle("active", editorMode === "points");
  modeKerbsButton.classList.toggle("active", editorMode === "kerbs");
  view?.setCenterlinesVisible(editorMode === "points" && centerlineToggle.checked);
}

function setEditorMode(mode: "points" | "kerbs"): void {
  if (editorMode === mode) {
    return;
  }
  editorMode = mode;
  drag = null;
  if (mode === "kerbs") {
    setSelection(null);
    setTerrainSelection(null);
    addTerrainPointMode = false;
    selectedKerbSpan = null;
  } else {
    selectedKerbSpan = null;
  }
  updateModeUI();
  scheduleOverlayUpdate();
  updateAuthoringUI();
}

function updateTerrainPointsUI(source: Project): void {
  const points = source.terrain.points ?? [];
  terrainMode.value = source.terrain.mode;
  addTerrainPointButton.textContent = addTerrainPointMode ? "Cancel add" : "Add point";
  deleteTerrainPointButton.disabled = selectedTerrainPoint === null;
  clearTerrainPointsButton.disabled = points.length === 0;
  terrainPointStatus.textContent =
    points.length > 0
      ? `${points.length} terrain point${points.length === 1 ? "" : "s"} · point TIN active`
      : "No terrain points. Add points to shape the terrain.";
  const selected = selectedTerrainPoint === null ? undefined : points[selectedTerrainPoint];
  terrainPointHeightField.hidden = !selected;
  if (selected) {
    terrainPointHeight.value = String(selected.height);
  }
}

function updateSpawnUI(source: Project): void {
  const centerlineIds = source.centerlines.map((centerline) => centerline.id).join("\u0000");
  const optionIds = [...spawnCenterline.options].map((option) => option.value).join("\u0000");
  if (centerlineIds !== optionIds) {
    spawnCenterline.innerHTML = "";
    for (const centerline of source.centerlines) {
      const option = document.createElement("option");
      option.value = centerline.id;
      option.textContent = centerline.id;
      spawnCenterline.appendChild(option);
    }
  }
  spawnCenterline.value = source.spawn.centerline;

  spawnFraction.value = String(source.spawn.fraction);
  spawnFractionValue.textContent = source.spawn.fraction.toFixed(3);

  spawnLateral.min = String(-source.road.halfWidth);
  spawnLateral.max = String(source.road.halfWidth);
  spawnLateral.value = String(source.spawn.lateral);
  spawnLateralValue.textContent = `${source.spawn.lateral.toFixed(1)} m`;
}

function showFatal(title: string, details: string[]): void {
  currentTrack = null;
  currentReport = null;
  bakeValid = false;
  statusPanel.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = title;
  statusPanel.appendChild(heading);
  const list = document.createElement("div");
  list.className = "violations";
  for (const detail of details) {
    const item = document.createElement("div");
    item.className = "violation error";
    item.textContent = detail;
    list.appendChild(item);
  }
  statusPanel.appendChild(list);
  surfaceLegend.innerHTML = "";
  violationsContainer.innerHTML = "";
  exportButton.disabled = true;
  exportStatus.textContent = "";
  updateAuthoringUI();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function metric(label: string, value: string, tone = ""): HTMLElement {
  const element = document.createElement("div");
  element.className = `metric ${tone}`.trim();
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  element.append(valueElement, labelElement);
  return element;
}

function renderStatus(track: BakedTrack, report: ValidationReport): void {
  const topology = report.topology;
  statusPanel.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "status-heading";
  const title = document.createElement("h2");
  title.textContent = "Geometry validation";
  const status = document.createElement("span");
  status.className = `status-pill ${report.ok ? "ok" : "bad"}`;
  status.textContent = report.ok ? "VALID" : "BLOCKED";
  heading.append(title, status);
  statusPanel.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "metrics";
  const kerbVertices = track.kerbGraph?.positions.length ?? 0;
  const kerbTriangles = track.kerbGraph
    ? Math.floor(track.kerbGraph.indices.length / 3)
    : 0;
  grid.append(
    metric("vertices", formatNumber(track.surfaceGraph.positions.length)),
    metric("triangles", formatNumber(topology.triangleCount)),
    metric("kerb vertices", formatNumber(kerbVertices)),
    metric("kerb triangles", formatNumber(kerbTriangles)),
    metric(
      "interior boundary edges",
      formatNumber(topology.interiorBoundaryEdges.length),
      topology.interiorBoundaryEdges.length > 0 ? "bad" : "good",
    ),
    metric("outer boundary edges", formatNumber(topology.outerBoundaryEdges.length), "good"),
    metric(
      "non-manifold edges",
      formatNumber(topology.nonManifoldEdges.length),
      topology.nonManifoldEdges.length > 0 ? "bad" : "good",
    ),
    metric(
      "T-junctions",
      formatNumber(topology.tJunctions.length),
      topology.tJunctions.length > 0 ? "bad" : "good",
    ),
    metric(
      "kerb non-manifold",
      formatNumber(report.kerbTopology?.nonManifoldEdges.length ?? 0),
      (report.kerbTopology?.nonManifoldEdges.length ?? 0) > 0 ? "bad" : "good",
    ),
    metric(
      "kerb T-junctions",
      formatNumber(report.kerbTopology?.tJunctions.length ?? 0),
      (report.kerbTopology?.tJunctions.length ?? 0) > 0 ? "bad" : "good",
    ),
    metric(
      "degenerate triangles",
      formatNumber(topology.degenerateTriangles.length),
      topology.degenerateTriangles.length > 0 ? "bad" : "good",
    ),
    metric(
      "overlap pairs",
      formatNumber(topology.overlapPairs.length),
      topology.overlapPairs.length > 0 ? "bad" : "good",
    ),
  );
  statusPanel.appendChild(grid);

  const note = document.createElement("p");
  note.className = "status-note";
  note.textContent =
    topology.interiorBoundaryEdges.length === 0 &&
    topology.nonManifoldEdges.length === 0 &&
    topology.tJunctions.length === 0
      ? track.kerbGraph
        ? "One welded ground graph plus a separate kerb graph. Kerb base edges are expected; ground open edges lie on the scene perimeter."
        : "One welded surface graph. The only open edges lie on the scene perimeter."
      : "Topology errors detected. Export is blocked until the MUST checks pass.";
  statusPanel.appendChild(note);
}

function renderLegend(track: BakedTrack, report: ValidationReport): void {
  surfaceLegend.innerHTML = "";
  const counts = new Map(report.topology.surfaceTriangleCounts);
  for (const [id, count] of report.kerbTopology?.surfaceTriangleCounts ?? []) {
    counts.set(id, (counts.get(id) ?? 0) + count);
  }
  for (const surface of track.surfaces) {
    const row = document.createElement("div");
    row.className = "legend-row";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `#${(SURFACE_COLORS[surface.name] ?? 0xb0b8c4)
      .toString(16)
      .padStart(6, "0")}`;
    const text = document.createElement("div");
    text.className = "legend-text";
    const name = document.createElement("strong");
    name.textContent = surface.name;
    const details = document.createElement("span");
    details.textContent = `μ ${surface.friction.toFixed(2)} · ρ ${surface.roughness.toFixed(
      2,
    )} · ${counts.get(surface.id) ?? 0} tris`;
    text.append(name, details);
    row.append(swatch, text);
    surfaceLegend.appendChild(row);
  }
}

function renderViolations(report: ValidationReport): void {
  violationsContainer.innerHTML = "";
  if (report.violations.length === 0) {
    const item = document.createElement("div");
    item.className = "violation ok";
    item.textContent = "All MUST-level checks pass.";
    violationsContainer.appendChild(item);
    return;
  }
  for (const violation of report.violations) {
    const item = document.createElement("div");
    item.className = `violation ${violation.severity}`;
    const rule = document.createElement("strong");
    rule.textContent = violation.rule;
    const message = document.createElement("span");
    message.textContent = violation.message;
    item.append(rule, message);
    violationsContainer.appendChild(item);
  }
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function downloadBytes(name: string, bytes: Uint8Array, mimeType: string): void {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function centerlineHeightSampler(
  source: Project,
  bounds: { min: Vec3; max: Vec3 },
): (point: Vec2) => number {
  if (source.terrain.mode !== "follow") {
    return () => 0;
  }
  if (source.terrain.points && source.terrain.points.length > 0) {
    return buildPointTerrainSampler(source.terrain.points, bounds);
  }
  if (source.terrain.elevation) {
    const elevation = source.terrain.elevation;
    return (point) => rawTerrainHeight(elevation, point);
  }
  return () => 0;
}

function overlayCenterlines(
  source: Project,
  bounds: { min: Vec3; max: Vec3 },
): CentrelineOverlayData[] {
  const heightAt = centerlineHeightSampler(source, bounds);
  return source.centerlines.map((centerline) => {
    const linePoints = sampleCenterline(
      centerline.points as Vec2[],
      centerline.closed,
      centerline.spline,
    );
    return {
      id: centerline.id,
      closed: centerline.closed,
      points: centerline.points,
      pointHeights: centerline.points.map((point) => heightAt([point[0], point[1]])),
      linePoints,
      lineHeights: linePoints.map((point) => heightAt(point)),
    };
  });
}

function overlayTerrainPoints(source: Project): TerrainPointOverlayData[] {
  return (source.terrain.points ?? []).map((point) => ({
    position: [point.position[0], point.position[1]],
    height: point.height,
  }));
}

function kerbSpanIntervals(
  start: number,
  length: number,
  closed: boolean,
): Array<[number, number]> {
  const end = start + length;
  if (closed && end > 1) {
    return [
      [start, 1],
      [0, end - 1],
    ];
  }
  return [[start, end]];
}

function kerbSpanEnd(start: number, length: number): number {
  return (start + length) % 1;
}

function kerbSpansOverlap(
  aStart: number,
  aLength: number,
  bStart: number,
  bLength: number,
  closed: boolean,
): boolean {
  for (const a of kerbSpanIntervals(aStart, aLength, closed)) {
    for (const b of kerbSpanIntervals(bStart, bLength, closed)) {
      if (a[0] < b[1] - 1e-9 && a[1] > b[0] + 1e-9) {
        return true;
      }
    }
  }
  return false;
}

function kerbSpanContains(
  start: number,
  length: number,
  fraction: number,
  closed: boolean,
): boolean {
  return kerbSpanIntervals(start, length, closed).some(
    (interval) =>
      fraction >= interval[0] - 1e-9 && fraction <= interval[1] + 1e-9,
  );
}

function kerbRailPoints(
  source: Project,
  bounds: { min: Vec3; max: Vec3 },
  section: Project["centerlines"][number],
  side: "left" | "right",
  start: number,
  length: number,
): Vec3[][] {
  const heightAt = centerlineHeightSampler(source, bounds);
  const sampled = sampleCenterline(
    section.points as Vec2[],
    section.closed,
    section.spline,
  );
  const offset = source.road.halfWidth + KERB_WIDTH / 2;
  const sideSign = side === "left" ? 1 : -1;
  const pieces: Array<[number, number]> = [];
  if (!section.closed || start + length <= 1 + 1e-9) {
    pieces.push([start, Math.min(1, start + length)]);
  } else {
    pieces.push([start, 1], [0, start + length - 1]);
  }
  return pieces.map(([from, to]) => {
    const steps = Math.max(2, Math.ceil(160 * Math.max(0, to - from)));
    const points: Vec3[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const fraction = from + ((to - from) * index) / steps;
      const sample = samplePolyline(sampled, section.closed, fraction);
      const lateral = scale2(leftNormal(sample.tangent), sideSign * offset);
      const x = sample.position[0] + lateral[0];
      const z = sample.position[1] + lateral[1];
      points.push([x, heightAt([x, z]) + 0.25, z]);
    }
    return points;
  });
}

function overlayKerbs(
  source: Project,
  bounds: { min: Vec3; max: Vec3 },
): KerbOverlayData {
  if (editorMode !== "kerbs") {
    return { rails: [], spans: [] };
  }
  const rails: KerbRailOverlayData[] = [];
  for (const section of source.centerlines) {
    for (const side of ["left", "right"] as const) {
      const [points] = kerbRailPoints(source, bounds, section, side, 0, 1);
      if (points && points.length >= 2) {
        rails.push({ sectionId: section.id, side, points });
      }
    }
  }

  const spans: KerbOverlayData["spans"] = [];
  for (const section of source.centerlines) {
    const sectionSpans = section.kerbs ?? [];
    for (let spanIndex = 0; spanIndex < sectionSpans.length; spanIndex += 1) {
      const span = sectionSpans[spanIndex]!;
      const pieces = kerbRailPoints(
        source,
        bounds,
        section,
        span.side,
        span.start,
        span.length,
      );
      const first = pieces[0];
      const last = pieces[pieces.length - 1];
      if (!first || !last || first.length === 0 || last.length === 0) {
        continue;
      }
      spans.push({
        sectionId: section.id,
        spanIndex,
        side: span.side,
        selected:
          selectedKerbSpan?.sectionId === section.id &&
          selectedKerbSpan.index === spanIndex,
        pieces,
        entry: first[0]!,
        exit: last[last.length - 1]!,
      });
    }
  }

  let preview: KerbOverlayData["preview"] = null;
  if (drag?.kind === "kerb-paint" && project) {
    const activeDrag = drag;
    const section = project.centerlines.find(
      (candidate) => candidate.id === activeDrag.sectionId,
    );
    if (section) {
      const signed = activeDrag.signedLength;
      const start =
        signed >= 0 ? activeDrag.originFraction : activeDrag.previousFraction;
      const length = Math.abs(signed);
      if (length > 1e-5) {
        const pieces = kerbRailPoints(
          project,
          bounds,
          section,
          activeDrag.side,
          start,
          length,
        );
        const first = pieces[0];
        const last = pieces[pieces.length - 1];
        if (first && last && first.length > 0 && last.length > 0) {
          preview = {
            pieces,
            entry: first[0]!,
            exit: last[last.length - 1]!,
          };
        }
      }
    }
  }

  return { rails, spans, preview };
}

function serializeProject(source: Project): unknown {
  if (source.schema === "track-ed/project@1") {
    return {
      schema: "track-ed/project@1",
      name: source.name,
      generator: source.generator,
      road: source.road,
      terrain: source.terrain,
      spawn: source.spawn,
      cameras: source.cameras,
      centerlines: source.centerlines.map((centerline) => ({
        id: centerline.id,
        closed: centerline.closed,
        points: centerline.points,
        ...(centerline.attach && "to" in centerline.attach
          ? { attach: centerline.attach }
          : {}),
        ...(centerline.spline ? { spline: centerline.spline } : {}),
      })),
    };
  }

  if (source.schema === "track-ed/project@3") {
    return {
      schema: "track-ed/project@3",
      name: source.name,
      generator: source.generator,
      road: source.road,
      terrain: source.terrain,
      ...(source.kerbs ? { kerbs: source.kerbs } : {}),
      spawn: source.spawn,
      cameras: source.cameras,
      junctions: source.junctions.map((junction) => ({
        id: junction.id,
        members:
          junction.members ??
          [{ section: junction.centerline, point: junction.point }],
        anchor: { section: junction.centerline, point: junction.point },
      })),
      sections: source.centerlines.map((centerline) => ({
        id: centerline.id,
        closed: centerline.closed,
        points: centerline.points.map((position, index) => ({
          id: centerline.pointIds[index],
          position,
        })),
        ...(centerline.spline ? { spline: centerline.spline } : {}),
        ...(centerline.kerbs && centerline.kerbs.length > 0
          ? { kerbs: centerline.kerbs }
          : {}),
      })),
    };
  }

  return {
    schema: "track-ed/project@2",
    name: source.name,
    generator: source.generator,
    road: source.road,
    terrain: source.terrain,
    spawn: source.spawn,
    cameras: source.cameras,
    junctions: source.junctions,
    centerlines: source.centerlines.map((centerline) => ({
      id: centerline.id,
      closed: centerline.closed,
      points: centerline.points.map((position, index) => ({
        id: centerline.pointIds[index],
        position,
      })),
      ...(centerline.attach ? { attach: centerline.attach } : {}),
      ...(centerline.endAttach ? { endAttach: centerline.endAttach } : {}),
      ...(centerline.spline ? { spline: centerline.spline } : {}),
    })),
  };
}

function updateMeta(source: Project): void {
  projectMeta.innerHTML = `
    <span class="meta-label">project</span>
    <strong>${source.name}</strong>
    <span class="meta-separator">/</span>
    <span>${source.centerlines.length} ${
      source.schema === "track-ed/project@3" ? "section" : "centreline"
    }${source.centerlines.length === 1 ? "" : "s"}</span>
    <span class="meta-separator">/</span>
    <span>${source.road.halfWidth} m asphalt · ${source.road.shoulderHalfWidth} m shoulder</span>
  `;
}

function setSelection(point: ControlPointPick | null): void {
  selectedPoint = point;
  if (point) {
    selectedTerrainPoint = null;
    view?.setSelectedTerrainPoint(null);
  }
  view?.setSelectedPoint(point);
  updateAuthoringUI();
}

function setTerrainSelection(index: number | null): void {
  selectedTerrainPoint = index;
  if (index !== null) {
    selectedPoint = null;
    view?.setSelectedPoint(null);
  }
  view?.setSelectedTerrainPoint(index);
  updateAuthoringUI();
}

function isInternalProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const centerlines = (value as { centerlines?: unknown }).centerlines;
  return (
    Array.isArray(centerlines) &&
    centerlines.every(
      (centerline) =>
        typeof centerline === "object" &&
        centerline !== null &&
        Array.isArray((centerline as { pointIds?: unknown }).pointIds),
    )
  );
}

function renderProject(
  input: unknown,
  options: { frame?: boolean } = {},
): boolean {
  cancelPendingRender();
  cancelOverlayUpdate();
  const parsed = parseProject(
    isInternalProject(input) ? serializeProject(input) : input,
  );
  if (!parsed.project) {
    bakeValid = false;
    setEditStatus(
      `Edit invalid: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
      "error",
    );
    exportButton.disabled = true;
    exportStatus.textContent = "Export blocked: current edit is invalid.";
    updateAuthoringUI();
    return false;
  }

  let baked: BakedTrack;
  try {
    baked = bakeProject(parsed.project);
  } catch (error) {
    bakeValid = false;
    const issues = error instanceof BakeError ? error.issues.join("; ") : String(error);
    setEditStatus(`Bake failed: ${issues}`, "error");
    exportButton.disabled = true;
    exportStatus.textContent = "Export blocked: current edit does not bake.";
    updateAuthoringUI();
    return false;
  }

  project = parsed.project;
  bakeValid = true;
  const report = validateBakedTrack(baked);
  currentTrack = baked;
  currentReport = report;

  if (!view) {
    view = createTrackView(
      viewport,
      baked,
      report.topology,
      overlayCenterlines(project, baked.bounds),
      overlayTerrainPoints(project),
      report.kerbTopology,
      overlayKerbs(project, baked.bounds),
    );
    const canvas = viewport.querySelector<HTMLCanvasElement>("canvas");
    if (canvas) {
      attachEditing(view, canvas);
    }
  } else {
    view.update(
      baked,
      report.topology,
      overlayCenterlines(project, baked.bounds),
      overlayTerrainPoints(project),
      report.kerbTopology,
      overlayKerbs(project, baked.bounds),
    );
  }
  view.setSelectedPoint(selectedPoint);
  view.setSelectedTerrainPoint(selectedTerrainPoint);
  if (options.frame) {
    view.frame();
  }

  updateMeta(project);
  renderStatus(baked, report);
  renderLegend(baked, report);
  renderViolations(report);
  exportStatus.textContent = report.ok
    ? ""
    : "Export is blocked while MUST-level validation fails.";
  setEditStatus("");
  updateAuthoringUI();
  return true;
}

function loadProject(input: unknown, frame: boolean): void {
  cancelPendingRender();
  cancelOverlayUpdate();
  const parsed = parseProject(input);
  if (!parsed.project) {
    showFatal(
      "Project validation failed",
      parsed.issues.map((issue) => `${issue.path}: ${issue.message}`),
    );
    return;
  }
  const converted = convertProjectToV3(parsed.project);
  project = converted.ok ? converted.project : parsed.project;
  undoStack = [];
  redoStack = [];
  selectedPoint = null;
  selectedTerrainPoint = null;
  selectedKerbSpan = null;
  kerbEditStart = null;
  addTerrainPointMode = false;
  drag = null;
  sliderStart = null;
  renderProject(project, { frame });
  updateAuthoringUI();
}

function undo(): void {
  if (!project || undoStack.length === 0) {
    return;
  }
  cancelPendingRender();
  cancelOverlayUpdate();
  const previous = undoStack.pop()!;
  redoStack.push(cloneProject(project));
  project = previous;
  selectedPoint = null;
  selectedTerrainPoint = null;
  selectedKerbSpan = null;
  kerbEditStart = null;
  addTerrainPointMode = false;
  drag = null;
  sliderStart = null;
  syncBranchStart(project);
  renderProject(project, { frame: false });
  updateAuthoringUI();
}

function redo(): void {
  if (!project || redoStack.length === 0) {
    return;
  }
  cancelPendingRender();
  cancelOverlayUpdate();
  const next = redoStack.pop()!;
  undoStack.push(cloneProject(project));
  project = next;
  selectedPoint = null;
  selectedTerrainPoint = null;
  selectedKerbSpan = null;
  kerbEditStart = null;
  addTerrainPointMode = false;
  drag = null;
  sliderStart = null;
  syncBranchStart(project);
  renderProject(project, { frame: false });
  updateAuthoringUI();
}

function nearestPolylineFraction(
  centerline: Project["centerlines"][number],
  point: Vec2,
): number | null {
  const points = sampleCenterline(
    centerline.points as Vec2[],
    centerline.closed,
    centerline.spline,
  );
  const lengths = segmentLengths(points, centerline.closed);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) {
    return null;
  }

  let bestDistance = Infinity;
  let bestFraction = 0;
  let travelled = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const distance = distancePointToSegmentSq(point, a, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      const t = Math.max(0, Math.min(1, pointOnSegmentParameter(point, a, b)));
      bestFraction = (travelled + t * lengths[i]!) / total;
    }
    travelled += lengths[i]!;
  }
  return Math.max(0, Math.min(0.999, bestFraction));
}

function deleteSelectedPoint(): void {
  if (!project || !selectedPoint) {
    return;
  }
  const centerline = project.centerlines[selectedPoint.centerlineIndex];
  if (!centerline) {
    return;
  }
  if (centerline.closed && centerline.points.length <= 3) {
    setEditStatus("A closed loop needs at least 3 control points.", "error");
    return;
  }
  if (!centerline.closed && selectedPoint.pointIndex === 0) {
    setEditStatus("Remove the branch instead of deleting its attach point.", "error");
    return;
  }
  if (!centerline.closed && centerline.points.length <= 2) {
    setEditStatus("An open branch needs at least 2 control points.", "error");
    return;
  }

  const pointId = centerline.pointIds[selectedPoint.pointIndex];
  if (
    pointId &&
    project.junctions.some(
      (junction) => junction.centerline === centerline.id && junction.point === pointId,
    )
  ) {
    setEditStatus("Remove the junction before deleting its host point.", "error");
    return;
  }

  const before = cloneProject(project);
  centerline.points.splice(selectedPoint.pointIndex, 1);
  centerline.pointIds.splice(selectedPoint.pointIndex, 1);
  selectedPoint = null;
  syncBranchStart(project);
  pushUndo(before);
  renderProject(project, { frame: false });
  updateAuthoringUI();
}

function updateSectionList(source: Project): void {
  sectionList.innerHTML = "";
  for (let sectionIndex = 0; sectionIndex < source.centerlines.length; sectionIndex += 1) {
    const section = source.centerlines[sectionIndex]!;
    const row = document.createElement("div");
    const rowSelected = selectedPoint?.centerlineIndex === sectionIndex;
    row.className = rowSelected ? "section-row selected" : "section-row";

    const label = document.createElement("div");
    label.className = "section-label";
    const title = document.createElement("strong");
    title.textContent = section.id;
    const detail = document.createElement("span");
    const junctionIds = new Set<string>();
    for (const junction of source.junctions) {
      if (
        junction.centerline === section.id ||
        (junction.members ?? []).some((member) => member.section === section.id)
      ) {
        junctionIds.add(junction.id);
      }
    }
    if (section.attach && "junction" in section.attach) {
      junctionIds.add(section.attach.junction);
    }
    if (section.endAttach && "junction" in section.endAttach) {
      junctionIds.add(section.endAttach.junction);
    }
    const junctionCount = junctionIds.size;
    const lastPointIndex = section.points.length - 1;
    const looseEnds = section.closed
      ? 0
      : [0, lastPointIndex].filter((pointIndex) => {
          if (pointIndex === 0 && section.attach) {
            return false;
          }
          if (pointIndex === lastPointIndex && section.endAttach) {
            return false;
          }
          return isLooseSectionEnd(source, section.id, pointIndex);
        }).length;
    const parts = [
      section.closed ? "closed" : "open",
      `${section.points.length} pts`,
      `${junctionCount} junction${junctionCount === 1 ? "" : "s"}`,
    ];
    if (!section.closed) {
      parts.push(`${looseEnds} loose end${looseEnds === 1 ? "" : "s"}`);
    }
    detail.textContent = parts.join(" · ");
    label.append(title, detail);

    row.append(label);
    sectionList.appendChild(row);
  }
}

function findKerbSpan(
  source: Project,
  sectionId: string,
  spanIndex: number,
): { section: Project["centerlines"][number]; span: ProjectKerbSpan } | null {
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  const span = section?.kerbs?.[spanIndex];
  return section && span ? { section, span } : null;
}

function findKerbSpanAt(
  source: Project,
  sectionId: string,
  side: "left" | "right",
  fraction: number,
): number | null {
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return null;
  }
  const spans = section.kerbs ?? [];
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (
      span.side === side &&
      kerbSpanContains(span.start, span.length, fraction, section.closed)
    ) {
      return index;
    }
  }
  return null;
}

function kerbPaintSpan(
  drag: Extract<NonNullable<DragState>, { kind: "kerb-paint" }>,
): { start: number; length: number } | null {
  const length = Math.abs(drag.signedLength);
  if (length <= 1e-5) {
    return null;
  }
  const start =
    drag.signedLength >= 0 ? drag.originFraction : drag.previousFraction;
  return {
    start: ((start % 1) + 1) % 1,
    length: Math.min(1 - 1e-9, length),
  };
}

function updateKerbsUI(source: Project): void {
  const editable = source.schema === "track-ed/project@3";
  if (
    selectedKerbSpan &&
    !findKerbSpan(source, selectedKerbSpan.sectionId, selectedKerbSpan.index)
  ) {
    selectedKerbSpan = null;
  }

  kerbList.innerHTML = "";
  let spanCount = 0;
  for (const section of source.centerlines) {
    const spans = section.kerbs ?? [];
    for (let index = 0; index < spans.length; index += 1) {
      spanCount += 1;
      const span = spans[index]!;
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        selectedKerbSpan?.sectionId === section.id && selectedKerbSpan.index === index
          ? "section-row selected"
          : "section-row";
      const label = document.createElement("div");
      label.className = "section-label";
      const title = document.createElement("strong");
      title.textContent = `${section.id} · ${span.side}`;
      const detail = document.createElement("span");
      const rawEnd = span.start + span.length;
      const end = section.closed ? rawEnd % 1 : rawEnd;
      const wraps = section.closed && rawEnd > 1 + 1e-9;
      detail.textContent = `${span.start.toFixed(3)} – ${end.toFixed(3)}${
        wraps ? " (wraps)" : ""
      }`;
      label.append(title, detail);
      row.append(label);
      row.addEventListener("click", () => {
        selectedKerbSpan = { sectionId: section.id, index };
        scheduleOverlayUpdate();
        updateKerbsUI(source);
      });
      kerbList.appendChild(row);
    }
  }
  if (spanCount === 0) {
    const empty = document.createElement("div");
    empty.className = "junction-empty";
    empty.textContent =
      source.schema === "track-ed/project@3"
        ? "No kerb spans. Switch to Kerbs mode and drag a dotted guide rail."
        : "Kerb authoring requires track-ed/project@3.";
    kerbList.appendChild(empty);
  }

  const selected = selectedKerbSpan
    ? findKerbSpan(source, selectedKerbSpan.sectionId, selectedKerbSpan.index)
    : null;

  const globalFlat = source.kerbs?.flatHeight ?? DEFAULT_KERB_FLAT_HEIGHT;
  const globalCorner = source.kerbs?.cornerHeight ?? DEFAULT_KERB_CORNER_HEIGHT;
  if (document.activeElement !== kerbGlobalFlat) {
    kerbGlobalFlat.value = String(globalFlat);
  }
  if (document.activeElement !== kerbGlobalCorner) {
    kerbGlobalCorner.value = String(globalCorner);
  }
  kerbGlobalFlat.disabled = !editable;
  kerbGlobalCorner.disabled = !editable;

  kerbRemoveButton.disabled = !editable || selected === null;
  kerbSpanHeights.hidden = selected === null;
  if (selected) {
    const overridden =
      selected.span.flatHeight !== undefined ||
      selected.span.cornerHeight !== undefined;
    kerbSpanOverride.checked = overridden;
    kerbSpanOverride.disabled = !editable;
    kerbSpanFlatField.hidden = !overridden;
    kerbSpanCornerField.hidden = !overridden;
    const flat = selected.span.flatHeight ?? globalFlat;
    const corner = selected.span.cornerHeight ?? globalCorner;
    if (document.activeElement !== kerbSpanFlat) {
      kerbSpanFlat.value = String(flat);
    }
    if (document.activeElement !== kerbSpanCorner) {
      kerbSpanCorner.value = String(corner);
    }
    kerbSpanFlat.disabled = !editable || !overridden;
    kerbSpanCorner.disabled = !editable || !overridden;
  }

  kerbStatus.textContent = selected
    ? `Editing ${selected.section.id} · ${selected.span.side} kerb span.`
    : spanCount > 0
      ? `${spanCount} kerb span${spanCount === 1 ? "" : "s"}.`
      : "No kerb spans.";
}

function removeKerbSpan(): void {
  if (!project || !selectedKerbSpan) {
    return;
  }
  const located = findKerbSpan(project, selectedKerbSpan.sectionId, selectedKerbSpan.index);
  if (!located) {
    return;
  }
  const before = cloneProject(project);
  located.section.kerbs!.splice(selectedKerbSpan.index, 1);
  if (located.section.kerbs!.length === 0) {
    delete located.section.kerbs;
  }
  selectedKerbSpan = null;
  if (!renderProject(project, { frame: false })) {
    project = before;
    renderProject(project, { frame: false });
    setKerbStatus("The kerb change does not bake.", "error");
    return;
  }
  pushUndo(before);
  setKerbStatus("Removed kerb span.", "ok");
  scheduleOverlayUpdate();
}

function setKerbStatus(message: string, tone: "ok" | "error" | "" = ""): void {
  kerbStatus.textContent = message;
  kerbStatus.className = `edit-status ${tone}`.trim();
}

function editSelectedKerbSpan(
  mutate: (span: NonNullable<Project["centerlines"][number]["kerbs"]>[number]) => void,
): void {
  if (!project || !selectedKerbSpan) {
    return;
  }
  const located = findKerbSpan(project, selectedKerbSpan.sectionId, selectedKerbSpan.index);
  if (!located) {
    return;
  }
  if (!kerbEditStart) {
    kerbEditStart = cloneProject(project);
  }
  mutate(located.span);
  scheduleRender();
  scheduleOverlayUpdate();
  updateKerbsUI(project);
  updateMeta(project);
}

function updateJunctionList(source: Project): void {
  junctionList.innerHTML = "";
  if (source.junctions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "junction-empty";
    empty.textContent = "No junctions.";
    junctionList.appendChild(empty);
    return;
  }

  for (const junction of source.junctions) {
    const row = document.createElement("div");
    row.className = "junction-row";
    const label = document.createElement("span");
    const branchCount = branchesOf(source).filter(
      (branch) =>
        (branch.attach &&
          "junction" in branch.attach &&
          branch.attach.junction === junction.id) ||
        (branch.endAttach &&
          "junction" in branch.endAttach &&
          branch.endAttach.junction === junction.id),
    ).length;
    if (source.schema === "track-ed/project@3") {
      const memberCount = junction.members?.length ?? 1;
      label.textContent = `${junction.id} · ${memberCount} section${
        memberCount === 1 ? "" : "s"
      }`;
    } else {
      label.textContent = `${junction.id} · ${junction.centerline}/${junction.point} · ${branchCount} branch${
        branchCount === 1 ? "" : "es"
      }`;
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "edit-button";
    remove.textContent = "Remove";
    remove.disabled = false;
    remove.title = "";
    remove.addEventListener("click", () => removeJunction(junction.id));
    row.append(label, remove);
    junctionList.appendChild(row);
  }
}

function addSectionJunctionAtSelected(): void {
  if (!project || !selectedPoint) {
    setEditStatus("Select a section control point first.", "error");
    return;
  }
  const section = project.centerlines[selectedPoint.centerlineIndex];
  if (!section) {
    return;
  }
  const before = cloneProject(project);
  let added = false;
  let failure = "";
  for (const flip of [false, true]) {
    const result = addSectionAtPoint(
      before,
      section.id,
      selectedPoint.pointIndex,
      flip,
    );
    if (!result.ok) {
      failure = result.message;
      continue;
    }
    if (renderProject(result.project, { frame: false }) && currentReport?.ok) {
      added = true;
      break;
    }
  }
  if (!added) {
    project = before;
    renderProject(project, { frame: false });
    setEditStatus(failure || "The new section would be invalid.", "error");
    return;
  }
  pushUndo(before);
  setEditStatus("Added a section and junction at the selected point.", "ok");
  updateAuthoringUI();
}

function addLooseSectionAtSelected(): void {
  if (!project || !selectedPoint) {
    setEditStatus("Select a section control point first.", "error");
    return;
  }
  const section = project.centerlines[selectedPoint.centerlineIndex];
  if (!section) {
    return;
  }
  const before = cloneProject(project);
  const previousSelection = selectedPoint;
  let added = false;
  let failure = "";
  for (const flip of [false, true]) {
    const result = addLooseSectionAtPoint(
      before,
      section.id,
      selectedPoint.pointIndex,
      flip,
    );
    if (!result.ok) {
      failure = result.message;
      continue;
    }
    const newSectionIndex = result.project.centerlines.length - 1;
    selectedPoint = { centerlineIndex: newSectionIndex, pointIndex: 0 };
    if (renderProject(result.project, { frame: false }) && currentReport?.ok) {
      added = true;
      break;
    }
    selectedPoint = previousSelection;
  }
  if (!added) {
    project = before;
    selectedPoint = previousSelection;
    renderProject(project, { frame: false });
    setEditStatus(failure || "The new section would be invalid.", "error");
    return;
  }
  pushUndo(before);
  setEditStatus("Added an independent section.", "ok");
  updateAuthoringUI();
}

function splitLoopAtSelection(): void {
  if (!project || !selectedPoint) {
    setEditStatus("Select a closed section control point first.", "error");
    return;
  }
  const section = project.centerlines[selectedPoint.centerlineIndex];
  if (!section) {
    setEditStatus("Select a section control point first.", "error");
    return;
  }
  const before = cloneProject(project);
  const result = section.closed
    ? splitClosedSection(project, section.id, selectedPoint.pointIndex)
    : splitOpenSection(project, section.id, selectedPoint.pointIndex);
  if (!result.ok) {
    setEditStatus(result.message, "error");
    return;
  }
  if (
    !renderProject(result.project, { frame: false }) ||
    !currentReport?.ok
  ) {
    project = before;
    renderProject(project, { frame: false });
    setEditStatus("The split would be invalid.", "error");
    return;
  }
  selectedPoint = null;
  pushUndo(before);
  setEditStatus(
    section.closed
      ? "Split the closed loop into one open section."
      : "Split the section into two capped sections.",
    "ok",
  );
  updateAuthoringUI();
}

function addJunction(): void {
  if (!project) {
    return;
  }
  if (project.schema === "track-ed/project@3") {
    addSectionJunctionAtSelected();
    return;
  }
  const main = mainOf(project);
  if (!main) {
    setEditStatus("A junction requires a closed main loop.", "error");
    return;
  }
  if (branchesOf(project).some((branch) => branch.attach && "to" in branch.attach)) {
    setEditStatus(
      "This project has a legacy fraction branch. Open a project@2 project to add junctions.",
      "error",
    );
    return;
  }
  if (!selectedPoint) {
    setEditStatus("Select a main-loop control point to place the junction.", "error");
    return;
  }
  const selectedCenterline = project.centerlines[selectedPoint.centerlineIndex];
  if (!selectedCenterline || !selectedCenterline.closed || selectedCenterline.id !== main.id) {
    setEditStatus("Select a main-loop control point to place the junction.", "error");
    return;
  }
  const hostPointId = selectedCenterline.pointIds[selectedPoint.pointIndex];
  if (!hostPointId) {
    return;
  }

  const before = cloneProject(project);
  project.schema = "track-ed/project@2";

  let junction = project.junctions.find(
    (candidate) => candidate.centerline === main.id && candidate.point === hostPointId,
  );
  if (!junction) {
    const usedJunctions = new Set(project.junctions.map((candidate) => candidate.id));
    junction = {
      id: nextId("junction", usedJunctions),
      centerline: main.id,
      point: hostPointId,
    };
    project.junctions.push(junction);
  }

  const usedBranches = new Set(project.centerlines.map((centerline) => centerline.id));
  const branchId = nextId("branch", usedBranches);
  const hostPosition = selectedCenterline.points[selectedPoint.pointIndex]!;
  const hostFraction =
    fractionAtControlPoint(
      selectedCenterline.points as Vec2[],
      true,
      selectedCenterline.spline,
      selectedPoint.pointIndex,
    ) ?? 0.25;
  const sampledMain = sampleCenterline(
    selectedCenterline.points as Vec2[],
    true,
    selectedCenterline.spline,
  );
  const hostSample = samplePolyline(sampledMain, true, hostFraction);
  const side = signedArea2(sampledMain) > 0 ? -1 : 1;
  const outward = scale2(leftNormal(hostSample.tangent), side * 30);

  project.centerlines.push({
    id: branchId,
    closed: false,
    spline: { type: "catmull-rom", samplesPerSegment: 12 },
    attach: { junction: junction.id },
    points: [
      [hostPosition[0], hostPosition[1]],
      [hostPosition[0] + outward[0], hostPosition[1] + outward[1]],
      [hostPosition[0] + outward[0] * 2, hostPosition[1] + outward[1] * 2],
    ],
    pointIds: [
      junction.point,
      `${branchId}-p1`,
      `${branchId}-p2`,
    ],
  });

  syncBranchStart(project);
  const ok = renderProject(project, { frame: false });
  if (ok) {
    pushUndo(before);
  } else {
    project = before;
    renderProject(project, { frame: false });
    setEditStatus("Junction could not be added.", "error");
  }
  updateAuthoringUI();
}

function removeJunction(junctionId: string): void {
  if (!project) {
    return;
  }
  const junction = project.junctions.find((candidate) => candidate.id === junctionId);
  if (!junction) {
    return;
  }
  if (project.schema === "track-ed/project@3") {
    const before = cloneProject(project);
    const result = removeJunctionWithGap(project, junctionId);
    if (!result.ok) {
      setEditStatus(result.message, "error");
      return;
    }
    const rendered = renderProject(result.project, { frame: false });
    if (!rendered || !currentReport?.ok) {
      project = before;
      renderProject(project, { frame: false });
      setEditStatus("The junction could not be removed cleanly.", "error");
      return;
    }
    selectedPoint = null;
    pushUndo(before);
    setEditStatus("Junction removed; sections detached.", "ok");
    updateAuthoringUI();
    return;
  }
  const before = cloneProject(project);
  const removedBranchIds = new Set(
    branchesOf(project)
      .filter(
        (branch) =>
          branch.attach && "junction" in branch.attach && branch.attach.junction === junctionId,
      )
      .map((branch) => branch.id),
  );
  project.centerlines = project.centerlines.filter(
    (centerline) => centerline.closed || !removedBranchIds.has(centerline.id),
  );
  for (const branch of branchesOf(project)) {
    if (
      branch.endAttach &&
      "junction" in branch.endAttach &&
      branch.endAttach.junction === junctionId
    ) {
      delete branch.endAttach;
    }
  }
  project.junctions = project.junctions.filter((candidate) => candidate.id !== junctionId);
  const main = mainOf(project);
  if (main && project.spawn.centerline !== main.id) {
    project.spawn.centerline = main.id;
  }
  selectedPoint = null;
  selectedTerrainPoint = null;
  const ok = renderProject(project, { frame: false });
  if (ok) {
    pushUndo(before);
  }
  updateAuthoringUI();
}

function isJunctionReferenced(source: Project, junctionId: string): boolean {
  return branchesOf(source).some(
    (branch) =>
      (branch.attach && "junction" in branch.attach && branch.attach.junction === junctionId) ||
      (branch.endAttach &&
        "junction" in branch.endAttach &&
        branch.endAttach.junction === junctionId),
  );
}

function findJoinTarget(
  source: Project,
  branchIndex: number,
  pointIndex: number,
  position: Vec2,
): ControlPointPick | null {
  if (source.schema === "track-ed/project@3") {
    const dragged = source.centerlines[branchIndex];
    if (!dragged || dragged.closed || !isLooseSectionEnd(source, dragged.id, pointIndex)) {
      return null;
    }
    let best: ControlPointPick | null = null;
    let bestDistance = Infinity;
    for (let sectionIndex = 0; sectionIndex < source.centerlines.length; sectionIndex += 1) {
      const section = source.centerlines[sectionIndex];
      if (!section) {
        continue;
      }
      const lastIndex = section.points.length - 1;
      const limit = sectionIndex === branchIndex ? 20 : 4;
      for (let targetIndex = 0; targetIndex < section.points.length; targetIndex += 1) {
        if (sectionIndex === branchIndex) {
          if (targetIndex === pointIndex || (targetIndex !== 0 && targetIndex !== lastIndex)) {
            continue;
          }
          if (!isLooseSectionEnd(source, section.id, targetIndex)) {
            continue;
          }
        }
        const point = section.points[targetIndex]!;
        const distance = Math.hypot(point[0] - position[0], point[1] - position[1]);
        if (distance < limit && distance < bestDistance) {
          bestDistance = distance;
          best = { centerlineIndex: sectionIndex, pointIndex: targetIndex };
        }
      }
    }
    return best;
  }
  const branch = source.centerlines[branchIndex];
  if (!branch || branch.closed || branch.points.length < 2) {
    return null;
  }
  const main = mainOf(source);
  if (!main) {
    return null;
  }
  const mainIndex = source.centerlines.indexOf(main);
  const startAttach = branch.attach;
  const startJunctionId =
    startAttach && "junction" in startAttach ? startAttach.junction : null;
  const startHostPoint = startJunctionId
    ? source.junctions.find((junction) => junction.id === startJunctionId)?.point
    : undefined;

  let best: ControlPointPick | null = null;
  let bestDistance = 4;
  for (let index = 0; index < main.points.length; index += 1) {
    const pointId = main.pointIds[index];
    if (pointId && pointId === startHostPoint) {
      continue;
    }
    const point = main.points[index]!;
    const distance = Math.hypot(point[0] - position[0], point[1] - position[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { centerlineIndex: mainIndex, pointIndex: index };
    }
  }

  for (let index = 0; index < source.centerlines.length; index += 1) {
    if (index === branchIndex) {
      continue;
    }
    const candidate = source.centerlines[index];
    if (!candidate || candidate.closed || candidate.points.length < 2 || candidate.endAttach) {
      continue;
    }
    if (
      candidate.attach &&
      "junction" in candidate.attach &&
      startJunctionId === candidate.attach.junction
    ) {
      continue;
    }
    const pointIndex = candidate.points.length - 1;
    const point = candidate.points[pointIndex]!;
    const distance = Math.hypot(point[0] - position[0], point[1] - position[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { centerlineIndex: index, pointIndex };
    }
  }

  return best;
}

function applyBranchEndJoin(
  source: Project,
  branch: Project["centerlines"][number],
  target: ControlPointPick,
): boolean {
  const main = source.centerlines[target.centerlineIndex];
  if (!main) {
    return false;
  }
  const pointId = main.pointIds[target.pointIndex];
  const hostPoint = main.points[target.pointIndex];
  if (!pointId || !hostPoint) {
    return false;
  }

  const startAttach = branch.attach;
  if (startAttach && "junction" in startAttach) {
    const startJunction = source.junctions.find(
      (junction) => junction.id === startAttach.junction,
    );
    if (
      startJunction &&
      startJunction.centerline === main.id &&
      startJunction.point === pointId
    ) {
      setEditStatus("A branch cannot start and end at the same junction.", "error");
      return false;
    }
  }

  let junction = source.junctions.find(
    (candidate) => candidate.centerline === main.id && candidate.point === pointId,
  );
  if (!junction) {
    const used = new Set(source.junctions.map((candidate) => candidate.id));
    junction = { id: nextId("junction", used), centerline: main.id, point: pointId };
    source.junctions.push(junction);
  }

  const oldEndJunctionId =
    branch.endAttach && "junction" in branch.endAttach
      ? branch.endAttach.junction
      : null;
  branch.endAttach = { junction: junction.id };
  branch.pointIds[branch.pointIds.length - 1] = pointId;
  branch.points[branch.points.length - 1] = [hostPoint[0], hostPoint[1]];
  if (
    oldEndJunctionId &&
    oldEndJunctionId !== junction.id &&
    !isJunctionReferenced(source, oldEndJunctionId)
  ) {
    source.junctions = source.junctions.filter(
      (candidate) => candidate.id !== oldEndJunctionId,
    );
  }

  syncBranchStart(source);
  if (!renderProject(source, { frame: false })) {
    return false;
  }
  updateAuthoringUI();
  return true;
}

function applySectionJunction(
  source: Project,
  branch: Project["centerlines"][number],
  target: ControlPointPick,
  draggedPointIndex: number,
): string | null {
  const targetSection = source.centerlines[target.centerlineIndex];
  const targetPointId = targetSection?.pointIds[target.pointIndex];
  const draggedPointId = branch.pointIds[draggedPointIndex];
  if (!targetSection || !targetPointId || !draggedPointId) {
    return "The junction target no longer exists.";
  }
  const result = addJunctionMember(
    source,
    targetSection.id,
    targetPointId,
    branch.id,
    draggedPointId,
  );
  if (!result.ok) {
    return result.message;
  }
  if (!renderProject(result.project, { frame: false })) {
    return "The junction would be invalid.";
  }
  setEditStatus(`Joined ${branch.id} to ${targetSection.id}/${targetPointId}.`, "ok");
  updateAuthoringUI();
  return null;
}

function applySectionLoopClose(
  source: Project,
  branch: Project["centerlines"][number],
  target: ControlPointPick,
  draggedPointIndex: number,
): string | null {
  const result = closeSectionLoop(
    source,
    branch.id,
    draggedPointIndex,
    target.pointIndex,
  );
  if (!result.ok) {
    return result.message;
  }
  selectedPoint = null;
  if (!renderProject(result.project, { frame: false })) {
    return "The closed loop would be invalid.";
  }
  setEditStatus("Closed the section into a loop.", "ok");
  updateAuthoringUI();
  return null;
}

function applySectionEndMerge(
  source: Project,
  branch: Project["centerlines"][number],
  target: ControlPointPick,
  draggedPointIndex: number,
): string | null {
  const targetSection = source.centerlines[target.centerlineIndex];
  if (!targetSection) {
    return "The merge target no longer exists.";
  }
  const result = mergeLooseSectionEnds(
    source,
    branch.id,
    draggedPointIndex,
    targetSection.id,
    target.pointIndex,
  );
  if (!result.ok) {
    return result.message;
  }
  selectedPoint = null;
  if (!renderProject(result.project, { frame: false })) {
    return "The merged section would be invalid.";
  }
  setEditStatus(`Merged ${branch.id} and ${targetSection.id}.`, "ok");
  updateAuthoringUI();
  return null;
}

function applyBranchEndMerge(
  source: Project,
  branch: Project["centerlines"][number],
  target: ControlPointPick,
): string | null {
  const targetBranch = source.centerlines[target.centerlineIndex];
  if (!targetBranch || targetBranch.closed) {
    return "The merge target is not an open branch.";
  }
  const result = mergeLooseBranchEnds(source, branch.id, targetBranch.id);
  if (!result.ok) {
    return result.message;
  }
  selectedPoint = null;
  if (!renderProject(result.project, { frame: false })) {
    return "The merged branch would be invalid.";
  }
  setEditStatus(`Merged ${branch.id} and ${targetBranch.id}.`, "ok");
  updateAuthoringUI();
  return null;
}

function addTerrainPointAt(position: Vec3): void {
  if (!project) {
    return;
  }
  const points = project.terrain.points ?? [];
  for (const point of points) {
    if (
      Math.hypot(point.position[0] - position[0], point.position[1] - position[2]) < 0.25
    ) {
      setEditStatus("Terrain points must be at least 0.25 m apart.", "error");
      return;
    }
  }

  const before = cloneProject(project);
  if (!project.terrain.points) {
    project.terrain.points = [];
  }
  project.terrain.points.push({
    position: [position[0], position[2]],
    height: position[1],
  });
  const index = project.terrain.points.length - 1;
  const ok = renderProject(project, { frame: false });
  if (!ok) {
    project = before;
    renderProject(project, { frame: false });
    setEditStatus("Terrain point could not be added.", "error");
    return;
  }
  pushUndo(before);
  addTerrainPointMode = false;
  const canvas = viewport.querySelector<HTMLCanvasElement>("canvas");
  if (canvas) {
    canvas.style.cursor = "default";
  }
  setTerrainSelection(index);
  updateAuthoringUI();
}

function deleteSelectedTerrainPoint(): void {
  if (!project || selectedTerrainPoint === null) {
    return;
  }
  const points = project.terrain.points;
  if (!points || !points[selectedTerrainPoint]) {
    return;
  }
  const before = cloneProject(project);
  points.splice(selectedTerrainPoint, 1);
  selectedTerrainPoint = null;
  const ok = renderProject(project, { frame: false });
  if (ok) {
    pushUndo(before);
  }
  updateAuthoringUI();
}

function clearTerrainPoints(): void {
  if (!project?.terrain.points) {
    return;
  }
  const before = cloneProject(project);
  delete project.terrain.points;
  selectedTerrainPoint = null;
  const ok = renderProject(project, { frame: false });
  if (ok) {
    pushUndo(before);
  }
  updateAuthoringUI();
}

function insertPoint(pick: CenterlineSegmentPick): void {
  if (!project) {
    return;
  }
  const centerline = project.centerlines[pick.centerlineIndex];
  if (!centerline) {
    return;
  }
  const before = cloneProject(project);
  const insertIndex = pick.segmentIndex + 1;
  const pointId = nextPointId(centerline);
  centerline.points.splice(insertIndex, 0, [pick.position[0], pick.position[1]]);
  centerline.pointIds.splice(insertIndex, 0, pointId);
  syncBranchStart(project);
  pushUndo(before);
  const ok = renderProject(project, { frame: false });
  if (ok) {
    setSelection({ centerlineIndex: pick.centerlineIndex, pointIndex: insertIndex });
  }
  updateAuthoringUI();
}

function pointerNdc(
  event: PointerEvent | MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
  };
}

function attachEditing(trackView: TrackView, canvas: HTMLCanvasElement): void {
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || !project) {
        return;
      }
      const point = pointerNdc(event, canvas);
      if (editorMode === "kerbs") {
        const handle = trackView.pickKerbHandle(point.x, point.y);
        if (handle) {
          event.stopPropagation();
          event.preventDefault();
          selectedKerbSpan = { sectionId: handle.sectionId, index: handle.spanIndex };
          drag = {
            kind: handle.handle === "entry" ? "kerb-entry" : "kerb-exit",
            sectionId: handle.sectionId,
            spanIndex: handle.spanIndex,
            startProject: cloneProject(project),
          };
          trackView.setControlsEnabled(false);
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
          scheduleOverlayUpdate();
          updateKerbsUI(project);
          return;
        }
        const rail = trackView.pickKerbRail(point.x, point.y);
        if (rail) {
          const section = project.centerlines.find(
            (candidate) => candidate.id === rail.sectionId,
          );
          if (!section) {
            return;
          }
          const spanIndex = findKerbSpanAt(
            project,
            rail.sectionId,
            rail.side,
            rail.fraction,
          );
          if (spanIndex !== null) {
            event.stopPropagation();
            event.preventDefault();
            selectedKerbSpan = { sectionId: rail.sectionId, index: spanIndex };
            scheduleOverlayUpdate();
            updateKerbsUI(project);
            return;
          }
          event.stopPropagation();
          event.preventDefault();
          drag = {
            kind: "kerb-paint",
            sectionId: rail.sectionId,
            side: rail.side,
            closed: section.closed,
            originFraction: rail.fraction,
            previousFraction: rail.fraction,
            signedLength: 0,
            startProject: cloneProject(project),
          };
          trackView.setControlsEnabled(false);
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "crosshair";
          scheduleOverlayUpdate();
          return;
        }
        return;
      }
      const terrainPointIndex = trackView.pickTerrainPoint(point.x, point.y);
      if (terrainPointIndex !== null) {
        event.stopPropagation();
        event.preventDefault();
        setTerrainSelection(terrainPointIndex);
        const terrainPoint = project.terrain.points?.[terrainPointIndex];
        if (!terrainPoint) {
          return;
        }
        drag = {
          kind: "terrain-point",
          index: terrainPointIndex,
          startProject: cloneProject(project),
          startHeight: terrainPoint.height,
          startClientY: event.clientY,
          unitsPerPixel: trackView.screenUnitsPerPixel(),
        };
        trackView.setControlsEnabled(false);
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }

      const hit = trackView.pickControlPoint(point.x, point.y);
      if (hit) {
        let resolved = hit;
        const hitCenterline = project.centerlines[hit.centerlineIndex];
        const hitAttach = hitCenterline?.attach;
        const resolveJunctionAnchor = (junctionId: string): void => {
          const junction = project?.junctions.find(
            (candidate) => candidate.id === junctionId,
          );
          if (!junction) {
            return;
          }
          const hostIndex = project!.centerlines.findIndex(
            (candidate) => candidate.id === junction.centerline,
          );
          const host = hostIndex >= 0 ? project!.centerlines[hostIndex] : undefined;
          const pointIndex = host ? host.pointIds.indexOf(junction.point) : -1;
          if (pointIndex >= 0) {
            resolved = { centerlineIndex: hostIndex, pointIndex };
          }
        };

        if (
          hitCenterline &&
          !hitCenterline.closed &&
          hit.pointIndex === 0 &&
          hitAttach &&
          "junction" in hitAttach
        ) {
          resolveJunctionAnchor(hitAttach.junction);
        } else if (hitCenterline && project.schema === "track-ed/project@3") {
          const hitPointId = hitCenterline.pointIds[hit.pointIndex];
          const junction = project.junctions.find((candidate) =>
            (candidate.members ?? []).some(
              (member) =>
                member.section === hitCenterline.id && member.point === hitPointId,
            ),
          );
          if (junction) {
            resolveJunctionAnchor(junction.id);
          }
        }

        event.stopPropagation();
        event.preventDefault();
        setSelection(resolved);
        const centerline = project.centerlines[resolved.centerlineIndex];
        if (!centerline) {
          return;
        }
        const startProject = cloneProject(project);
        const pendingDetach =
          !centerline.closed &&
          resolved.pointIndex === centerline.points.length - 1 &&
          Boolean(centerline.endAttach);
        trackView.setJoinTarget(null);
        if (
          !centerline.closed &&
          resolved.pointIndex === 0 &&
          centerline.attach &&
          "to" in centerline.attach
        ) {
          drag = { kind: "attach", startProject };
        } else {
          drag = {
            kind: "point",
            centerlineIndex: resolved.centerlineIndex,
            pointIndex: resolved.pointIndex,
            startProject,
            ...(pendingDetach ? { pendingDetach: true } : {}),
          };
        }
        trackView.setControlsEnabled(false);
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }

      if (trackView.pickSpawn(point.x, point.y)) {
        event.stopPropagation();
        event.preventDefault();
        setSelection(null);
        drag = { kind: "spawn", startProject: cloneProject(project) };
        trackView.setControlsEnabled(false);
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }

      if (addTerrainPointMode) {
        const surface = trackView.pick(point.x, point.y);
        if (surface && surface.surfaceId === 2) {
          event.stopPropagation();
          event.preventDefault();
          addTerrainPointAt(surface.point);
        }
      }
    },
    { capture: true },
  );

  canvas.addEventListener("pointermove", (event) => {
    const point = pointerNdc(event, canvas);
    if (drag) {
      if (!project) {
        return;
      }
      const ground = trackView.pickGround(point.x, point.y);
      if (!ground) {
        return;
      }
      if (drag.kind === "kerb-paint") {
        const activeDrag = drag;
        const section = project.centerlines.find(
          (candidate) => candidate.id === activeDrag.sectionId,
        );
        if (!section) {
          return;
        }
        const fraction = nearestPolylineFraction(section, ground);
        if (fraction === null) {
          return;
        }
        if (activeDrag.closed) {
          let delta = fraction - activeDrag.previousFraction;
          if (delta > 0.5) {
            delta -= 1;
          } else if (delta < -0.5) {
            delta += 1;
          }
          activeDrag.signedLength += delta;
          activeDrag.previousFraction = fraction;
        } else {
          activeDrag.signedLength = fraction - activeDrag.originFraction;
          activeDrag.previousFraction = fraction;
        }
        scheduleOverlayUpdate();
        return;
      }

      if (drag.kind === "kerb-entry" || drag.kind === "kerb-exit") {
        const activeDrag = drag;
        const section = project.centerlines.find(
          (candidate) => candidate.id === activeDrag.sectionId,
        );
        const span = section?.kerbs?.[activeDrag.spanIndex];
        if (!section || !span) {
          return;
        }
        const fraction = nearestPolylineFraction(section, ground);
        if (fraction === null) {
          return;
        }
        const minimum = 0.002;
        let start = span.start;
        let length = span.length;
        if (activeDrag.kind === "kerb-entry") {
          const exit = kerbSpanEnd(span.start, span.length);
          const forward = section.closed
            ? (exit - fraction + 1) % 1
            : exit - fraction;
          if (forward <= minimum || forward >= 1) {
            return;
          }
          start = fraction;
          length = forward;
        } else {
          const forward = section.closed
            ? (fraction - span.start + 1) % 1
            : fraction - span.start;
          if (forward <= minimum || forward >= 1) {
            return;
          }
          length = forward;
        }
        if (!section.closed && start + length > 1 + 1e-9) {
          return;
        }
        const overlaps = (section.kerbs ?? []).some(
          (candidate, index) =>
            index !== activeDrag.spanIndex &&
            candidate.side === span.side &&
            kerbSpansOverlap(
              start,
              length,
              candidate.start,
              candidate.length,
              section.closed,
            ),
        );
        if (overlaps) {
          return;
        }
        span.start = start;
        span.length = length;
        scheduleOverlayUpdate();
        scheduleDragRender();
        updateKerbsUI(project);
        return;
      }

      if (drag.kind === "terrain-point") {
        const terrainPoint = project.terrain.points?.[drag.index];
        if (!terrainPoint) {
          return;
        }
        const delta = (drag.startClientY - event.clientY) * drag.unitsPerPixel;
        terrainPoint.height = Math.max(-100, Math.min(100, drag.startHeight + delta));
        scheduleOverlayUpdate();
        scheduleDragRender();
        return;
      }

      if (drag.kind === "point") {
        let branch = project.centerlines[drag.centerlineIndex];
        if (!branch || !branch.points[drag.pointIndex]) {
          return;
        }

        if (drag.pendingDetach) {
          const candidate = cloneProject(project);
          const candidateBranch = candidate.centerlines[drag.centerlineIndex];
          if (!candidateBranch) {
            return;
          }
          const junctionId =
            candidateBranch.endAttach && "junction" in candidateBranch.endAttach
              ? candidateBranch.endAttach.junction
              : null;
          delete candidateBranch.endAttach;
          candidateBranch.pointIds[drag.pointIndex] = nextPointId(candidateBranch);
          if (junctionId && !isJunctionReferenced(candidate, junctionId)) {
            candidate.junctions = candidate.junctions.filter(
              (candidateJunction) => candidateJunction.id !== junctionId,
            );
          }
          candidateBranch.points[drag.pointIndex] = [ground[0], ground[1]];
          syncBranchStart(candidate);
          if (!renderProject(candidate, { frame: false })) {
            renderProject(project, { frame: false });
            setEditStatus(
              "Move the end farther from the main loop to detach it.",
              "error",
            );
            return;
          }
          drag.pendingDetach = false;
          branch = project.centerlines[drag.centerlineIndex];
          if (!branch) {
            return;
          }
        } else {
          branch.points[drag.pointIndex] = [ground[0], ground[1]];
          syncBranchStart(project);
          scheduleOverlayUpdate();
          scheduleDragRender();
        }

        const isEndpoint =
          !branch.closed &&
          (drag.pointIndex === 0 || drag.pointIndex === branch.points.length - 1);
        const canJoin =
          project.schema === "track-ed/project@3"
            ? isEndpoint && isLooseSectionEnd(project, branch.id, drag.pointIndex)
            : drag.pointIndex === branch.points.length - 1;
        if (canJoin) {
          const position = branch.points[drag.pointIndex]!;
          const target = findJoinTarget(
            project,
            drag.centerlineIndex,
            drag.pointIndex,
            position,
          );
          trackView.setJoinTarget(target);
          if (target) {
            const targetCenterline = project.centerlines[target.centerlineIndex];
            const isLoopClose =
              project.schema === "track-ed/project@3" &&
              targetCenterline?.id === branch.id;
            const isMergeTarget =
              project.schema === "track-ed/project@3" &&
              targetCenterline !== undefined &&
              !isLoopClose &&
              isLooseSectionEnd(project, targetCenterline.id, target.pointIndex);
            if (isLoopClose) {
              setEditStatus("Release to close this section into a loop", "ok");
            } else if (isMergeTarget) {
              setEditStatus(
                `Release to merge ${branch.id} and ${targetCenterline.id}`,
                "ok",
              );
            } else if (targetCenterline?.closed) {
              setEditStatus(
                `Release to join ${branch.id} to ${targetCenterline.id}/${
                  targetCenterline.pointIds[target.pointIndex] ?? ""
                }`,
                "ok",
              );
            } else {
              setEditStatus(
                `Release to join ${branch.id} to ${targetCenterline?.id ?? "section"}/${
                  targetCenterline?.pointIds[target.pointIndex] ?? ""
                }`,
                "ok",
              );
            }
          }
        } else {
          trackView.setJoinTarget(null);
        }
        return;
      }

      if (drag.kind === "spawn") {
        const centerline = project.centerlines.find(
          (candidate) => candidate.id === project!.spawn.centerline,
        );
        if (!centerline) {
          return;
        }
        const fraction = nearestPolylineFraction(centerline, ground);
        if (fraction === null) {
          return;
        }
        project.spawn.fraction = Math.max(0, Math.min(0.999, fraction));
        scheduleOverlayUpdate();
        scheduleDragRender();
        return;
      }

      const main = mainOf(project);
      const legacyBranch = branchesOf(project).find(
        (candidate) => candidate.attach && "to" in candidate.attach,
      );
      const fraction = main ? nearestPolylineFraction(main, ground) : null;
      if (!legacyBranch?.attach || !("fraction" in legacyBranch.attach) || fraction === null) {
        return;
      }
      const previous = cloneProject(project);
      moveBranchAttach(project, fraction);
      if (!renderProject(project, { frame: false })) {
        project = previous;
        renderProject(project, { frame: false });
        setEditStatus(
          "Attach move blocked: the branch would cross the main loop or become invalid.",
          "error",
        );
      }
      return;
    }

    if (editorMode === "kerbs") {
      const handle = trackView.pickKerbHandle(point.x, point.y);
      if (handle) {
        canvas.style.cursor = "grab";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>kerb handle</span><strong>${handle.handle}</strong></div>
          <div class="pick-row"><span>section</span><strong>${handle.sectionId}</strong></div>
        `;
        return;
      }
      const rail = trackView.pickKerbRail(point.x, point.y);
      if (rail) {
        const section = project?.centerlines.find(
          (candidate) => candidate.id === rail.sectionId,
        );
        const spanIndex = section
          ? findKerbSpanAt(project!, rail.sectionId, rail.side, rail.fraction)
          : null;
        canvas.style.cursor = spanIndex === null ? "crosshair" : "pointer";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>kerb rail</span><strong>${rail.sectionId} · ${rail.side}</strong></div>
          <div class="pick-row"><span>fraction</span><strong>${rail.fraction.toFixed(3)}</strong></div>
        `;
        return;
      }
      canvas.style.cursor = "default";
      pickInfo.textContent =
        "Drag a dotted kerb rail to paint a span. Select a span to show endpoint handles.";
      return;
    }

    const hoverTerrainPoint = trackView.pickTerrainPoint(point.x, point.y);
    if (hoverTerrainPoint !== null) {
      canvas.style.cursor = "grab";
      const terrainPoint = project?.terrain.points?.[hoverTerrainPoint];
      if (terrainPoint) {
        pickInfo.innerHTML = `
          <div class="pick-row"><span>terrain point</span><strong>${hoverTerrainPoint}</strong></div>
          <div class="pick-row"><span>x / z</span><strong>${formatNumber(
            terrainPoint.position[0],
          )} / ${formatNumber(terrainPoint.position[1])}</strong></div>
          <div class="pick-row"><span>height</span><strong>${formatNumber(
            terrainPoint.height,
          )} m</strong></div>
        `;
      }
      return;
    }

    const controlPoint = trackView.pickControlPoint(point.x, point.y);
    if (controlPoint) {
      canvas.style.cursor = "grab";
      const centerline = project?.centerlines[controlPoint.centerlineIndex];
      const position = centerline?.points[controlPoint.pointIndex];
      if (centerline && position) {
        pickInfo.innerHTML = `
          <div class="pick-row"><span>centreline</span><strong>${centerline.id}</strong></div>
          <div class="pick-row"><span>point</span><strong>${controlPoint.pointIndex}</strong></div>
          <div class="pick-row"><span>x / z</span><strong>${formatNumber(position[0])} / ${formatNumber(
            position[1],
          )}</strong></div>
        `;
      }
      return;
    }

    canvas.style.cursor = addTerrainPointMode ? "crosshair" : "default";
    const pick = trackView.pick(point.x, point.y);
    if (!pick) {
      pickInfo.textContent = "Hover a surface triangle.";
      return;
    }
    pickInfo.innerHTML = `
      <div class="pick-row"><span>triangle</span><strong>${pick.triangle}</strong></div>
      <div class="pick-row"><span>surface</span><strong>${pick.surfaceName} (${pick.surfaceId})</strong></div>
      <div class="pick-row"><span>area</span><strong>${formatNumber(pick.area)} m²</strong></div>
    `;
  });

  const finishDrag = (event: PointerEvent): void => {
    if (!drag) {
      return;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    trackView.setControlsEnabled(true);
    trackView.setJoinTarget(null);
    canvas.style.cursor = "default";
    const currentDrag = drag;
    drag = null;
    if (project) {
      flushPendingRender();
    }

    if (currentDrag.kind === "kerb-paint" && project) {
      const painted = kerbPaintSpan(currentDrag);
      if (!painted) {
        scheduleOverlayUpdate();
        updateAuthoringUI();
        return;
      }
      const section = project.centerlines.find(
        (candidate) => candidate.id === currentDrag.sectionId,
      );
      if (!section) {
        return;
      }
      if (
        !section.closed &&
        painted.start + painted.length > 1 + 1e-9
      ) {
        setKerbStatus("The kerb span must stay within this open section.", "error");
        scheduleOverlayUpdate();
        return;
      }
      const overlaps = (section.kerbs ?? []).some(
        (span) =>
          span.side === currentDrag.side &&
          kerbSpansOverlap(
            painted.start,
            painted.length,
            span.start,
            span.length,
            section.closed,
          ),
      );
      if (overlaps) {
        setKerbStatus("Kerbs on the same side cannot overlap.", "error");
        scheduleOverlayUpdate();
        return;
      }
      const before = currentDrag.startProject;
      section.kerbs = [
        ...(section.kerbs ?? []),
        { side: currentDrag.side, start: painted.start, length: painted.length },
      ].sort((a, b) => a.side.localeCompare(b.side) || a.start - b.start);
      selectedKerbSpan = {
        sectionId: section.id,
        index: section.kerbs.findIndex(
          (span) =>
            span.side === currentDrag.side &&
            span.start === painted.start &&
            span.length === painted.length,
        ),
      };
      if (!renderProject(project, { frame: false })) {
        project = before;
        selectedKerbSpan = null;
        renderProject(project, { frame: false });
        setKerbStatus("The painted kerb span does not bake.", "error");
        scheduleOverlayUpdate();
        return;
      }
      pushUndo(before);
      setKerbStatus("Painted kerb span.", "ok");
      scheduleOverlayUpdate();
      updateAuthoringUI();
      return;
    }

    if (currentDrag.kind === "kerb-entry" || currentDrag.kind === "kerb-exit") {
      if (project && !bakeValid) {
        project = currentDrag.startProject;
        renderProject(project, { frame: false });
        setKerbStatus("Kerb resize rejected: the track would become invalid.", "error");
      } else if (
        project &&
        JSON.stringify(currentDrag.startProject) !== JSON.stringify(project)
      ) {
        pushUndo(currentDrag.startProject);
      }
      scheduleOverlayUpdate();
      updateAuthoringUI();
      return;
    }

    if (currentDrag.kind === "point" && project) {
      const branch = project.centerlines[currentDrag.centerlineIndex];
      if (
        branch &&
        !branch.closed &&
        currentDrag.pointIndex === branch.points.length - 1
      ) {
        const position = branch.points[currentDrag.pointIndex]!;
        const target = findJoinTarget(
          project,
          currentDrag.centerlineIndex,
          currentDrag.pointIndex,
          position,
        );
        if (target) {
          const targetCenterline = project.centerlines[target.centerlineIndex];
          if (project.schema === "track-ed/project@3" && targetCenterline) {
            const isLoopClose = targetCenterline.id === branch.id;
            const isMergeTarget =
              !isLoopClose &&
              isLooseSectionEnd(project, targetCenterline.id, target.pointIndex);
            const error = isLoopClose
              ? applySectionLoopClose(project, branch, target, currentDrag.pointIndex)
              : isMergeTarget
                ? applySectionEndMerge(project, branch, target, currentDrag.pointIndex)
                : applySectionJunction(project, branch, target, currentDrag.pointIndex);
            if (error === null) {
              pushUndo(currentDrag.startProject);
            } else {
              project = currentDrag.startProject;
              renderProject(project, { frame: false });
              setEditStatus(error, "error");
            }
          } else if (targetCenterline?.closed) {
            if (applyBranchEndJoin(project, branch, target)) {
              pushUndo(currentDrag.startProject);
            } else {
              project = currentDrag.startProject;
              renderProject(project, { frame: false });
              setEditStatus("Could not join the loose end there; adjust the branch points so it does not cross the road.", "error");
            }
          } else {
            const error = applyBranchEndMerge(project, branch, target);
            if (error === null) {
              pushUndo(currentDrag.startProject);
            } else {
              project = currentDrag.startProject;
              renderProject(project, { frame: false });
              setEditStatus(error, "error");
            }
          }
          updateAuthoringUI();
          return;
        }
      }
    }

    if (currentDrag.kind === "point" && project && !bakeValid) {
      project = currentDrag.startProject;
      renderProject(project, { frame: false });
      setEditStatus(
        "Point move rejected: the track would become invalid.",
        "error",
      );
      updateAuthoringUI();
      return;
    }

    if (project && JSON.stringify(currentDrag.startProject) !== JSON.stringify(project)) {
      pushUndo(currentDrag.startProject);
    }
    updateAuthoringUI();
  };

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!drag) {
      pickInfo.textContent = "Hover a surface triangle.";
    }
  });

  canvas.addEventListener("dblclick", (event) => {
    if (!project) {
      return;
    }
    const point = pointerNdc(event, canvas);
    const hit = trackView.pickCenterlineSegment(point.x, point.y);
    if (!hit) {
      return;
    }
    event.preventDefault();
    insertPoint(hit);
  });
}

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
deleteButton.addEventListener("click", deleteSelectedPoint);
addSectionButton.addEventListener("click", addLooseSectionAtSelected);
splitLoopButton.addEventListener("click", splitLoopAtSelection);
terrainMode.addEventListener("change", () => {
  if (!project) {
    return;
  }
  const before = cloneProject(project);
  project.terrain.mode = terrainMode.value === "follow" ? "follow" : "conform";
  pushUndo(before);
  renderProject(project, { frame: false });
  updateAuthoringUI();
});

addTerrainPointButton.addEventListener("click", () => {
  addTerrainPointMode = !addTerrainPointMode;
  const canvas = viewport.querySelector<HTMLCanvasElement>("canvas");
  if (canvas) {
    canvas.style.cursor = addTerrainPointMode ? "crosshair" : "default";
  }
  updateAuthoringUI();
});
deleteTerrainPointButton.addEventListener("click", deleteSelectedTerrainPoint);
clearTerrainPointsButton.addEventListener("click", clearTerrainPoints);
terrainPointHeight.addEventListener("change", () => {
  if (!project || selectedTerrainPoint === null) {
    return;
  }
  const terrainPoint = project.terrain.points?.[selectedTerrainPoint];
  if (!terrainPoint) {
    return;
  }
  const value = Number(terrainPointHeight.value);
  if (!Number.isFinite(value)) {
    return;
  }
  const before = cloneProject(project);
  terrainPoint.height = value;
  const ok = renderProject(project, { frame: false });
  if (ok) {
    pushUndo(before);
  } else {
    project = before;
    renderProject(project, { frame: false });
    setEditStatus("Terrain point height is invalid.", "error");
  }
  updateAuthoringUI();
});
addJunctionButton.addEventListener("click", addJunction);
frameButton.addEventListener("click", () => {
  view?.frame();
});

newButton.addEventListener("click", () => {
  if (undoStack.length > 0 && !window.confirm("Discard edits and start a new loop?")) {
    return;
  }
  loadProject(loopSplineTerrainJunctionsFixture, true);
});

saveButton.addEventListener("click", () => {
  if (!project) {
    return;
  }
  downloadBytes(
    "project.json",
    new TextEncoder().encode(`${JSON.stringify(serializeProject(project), null, 2)}\n`),
    "application/json",
  );
});

openButton.addEventListener("click", () => {
  openFile.click();
});

openFile.addEventListener("change", async () => {
  const file = openFile.files?.[0];
  openFile.value = "";
  if (!file) {
    return;
  }
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(await file.text());
  } catch {
    setEditStatus("Open failed: invalid JSON.", "error");
    return;
  }
  loadProject(parsedValue, true);
});

attachFraction.addEventListener("input", () => {
  if (!project) {
    return;
  }
  const legacyBranch = branchesOf(project).find(
    (candidate) => candidate.attach && "to" in candidate.attach,
  );
  if (!legacyBranch?.attach || !("fraction" in legacyBranch.attach)) {
    return;
  }
  if (!sliderStart) {
    sliderStart = cloneProject(project);
  }
  const previous = cloneProject(project);
  moveBranchAttach(project, Number(attachFraction.value));
  if (!renderProject(project, { frame: false })) {
    project = previous;
    renderProject(project, { frame: false });
    setEditStatus(
      "Attach move blocked: the branch would cross the main loop or become invalid.",
      "error",
    );
  }
  updateAuthoringUI();
});

attachFraction.addEventListener("change", () => {
  if (!sliderStart) {
    return;
  }
  const start = sliderStart;
  sliderStart = null;
  if (project && JSON.stringify(start) !== JSON.stringify(project)) {
    pushUndo(start);
  }
  updateAuthoringUI();
});

spawnCenterline.addEventListener("change", () => {
  if (!project || spawnCenterline.value === project.spawn.centerline) {
    return;
  }
  const before = cloneProject(project);
  project.spawn.centerline = spawnCenterline.value;
  pushUndo(before);
  renderProject(project, { frame: false });
  updateAuthoringUI();
});

spawnFraction.addEventListener("input", () => {
  if (!project) {
    return;
  }
  if (!spawnFractionStart) {
    spawnFractionStart = cloneProject(project);
  }
  project.spawn.fraction = Number(spawnFraction.value);
  scheduleOverlayUpdate();
  scheduleRender();
  updateAuthoringUI();
});

spawnFraction.addEventListener("change", () => {
  if (!spawnFractionStart) {
    return;
  }
  flushPendingRender();
  const start = spawnFractionStart;
  spawnFractionStart = null;
  if (project && JSON.stringify(start) !== JSON.stringify(project)) {
    pushUndo(start);
  }
  updateAuthoringUI();
});

spawnLateral.addEventListener("input", () => {
  if (!project) {
    return;
  }
  if (!spawnLateralStart) {
    spawnLateralStart = cloneProject(project);
  }
  const lateral = Math.max(
    -project.road.halfWidth,
    Math.min(project.road.halfWidth, Number(spawnLateral.value)),
  );
  project.spawn.lateral = lateral;
  scheduleOverlayUpdate();
  scheduleRender();
  updateAuthoringUI();
});

spawnLateral.addEventListener("change", () => {
  if (!spawnLateralStart) {
    return;
  }
  flushPendingRender();
  const start = spawnLateralStart;
  spawnLateralStart = null;
  if (project && JSON.stringify(start) !== JSON.stringify(project)) {
    pushUndo(start);
  }
  updateAuthoringUI();
});

kerbGlobalFlat.addEventListener("input", () => {
  if (!project) {
    return;
  }
  if (!kerbEditStart) {
    kerbEditStart = cloneProject(project);
  }
  const corner = project.kerbs?.cornerHeight ?? DEFAULT_KERB_CORNER_HEIGHT;
  const requested = Math.max(0, Number(kerbGlobalFlat.value) || 0);
  const flat = Math.min(requested, corner - 0.005);
  kerbGlobalFlat.value = String(flat);
  project.kerbs = { ...project.kerbs, flatHeight: flat };
  scheduleRender();
  updateKerbsUI(project);
});

kerbGlobalCorner.addEventListener("input", () => {
  if (!project) {
    return;
  }
  if (!kerbEditStart) {
    kerbEditStart = cloneProject(project);
  }
  const flat = project.kerbs?.flatHeight ?? DEFAULT_KERB_FLAT_HEIGHT;
  const requested = Math.max(0.005, Number(kerbGlobalCorner.value) || 0.005);
  const corner = Math.max(requested, flat + 0.005);
  kerbGlobalCorner.value = String(corner);
  project.kerbs = { ...project.kerbs, cornerHeight: corner };
  scheduleRender();
  updateKerbsUI(project);
});

kerbGlobalFlat.addEventListener("change", finishKerbEdit);
kerbGlobalCorner.addEventListener("change", finishKerbEdit);

kerbSpanOverride.addEventListener("change", () => {
  if (!project || !selectedKerbSpan) {
    return;
  }
  const located = findKerbSpan(project, selectedKerbSpan.sectionId, selectedKerbSpan.index);
  if (!located) {
    return;
  }
  const span = located.span;
  const before = cloneProject(project);
  if (kerbSpanOverride.checked) {
    span.flatHeight = project.kerbs?.flatHeight ?? DEFAULT_KERB_FLAT_HEIGHT;
    span.cornerHeight = project.kerbs?.cornerHeight ?? DEFAULT_KERB_CORNER_HEIGHT;
  } else {
    delete span.flatHeight;
    delete span.cornerHeight;
  }
  if (!renderProject(project, { frame: false })) {
    project = before;
    renderProject(project, { frame: false });
    setKerbStatus("Those kerb heights do not bake.", "error");
    return;
  }
  pushUndo(before);
  updateKerbsUI(project);
});

kerbSpanFlat.addEventListener("input", () => {
  if (!project || !selectedKerbSpan) {
    return;
  }
  const located = findKerbSpan(project, selectedKerbSpan.sectionId, selectedKerbSpan.index);
  const span = located?.span;
  if (!span || (span.flatHeight === undefined && span.cornerHeight === undefined)) {
    return;
  }
  const corner =
    span.cornerHeight ?? project.kerbs?.cornerHeight ?? DEFAULT_KERB_CORNER_HEIGHT;
  const requested = Math.max(0, Number(kerbSpanFlat.value) || 0);
  const flat = Math.min(requested, corner - 0.005);
  kerbSpanFlat.value = String(flat);
  editSelectedKerbSpan((editableSpan) => {
    editableSpan.flatHeight = flat;
    editableSpan.cornerHeight ??= corner;
  });
});

kerbSpanCorner.addEventListener("input", () => {
  if (!project || !selectedKerbSpan) {
    return;
  }
  const located = findKerbSpan(project, selectedKerbSpan.sectionId, selectedKerbSpan.index);
  const span = located?.span;
  if (!span || (span.flatHeight === undefined && span.cornerHeight === undefined)) {
    return;
  }
  const flat = span.flatHeight ?? project.kerbs?.flatHeight ?? DEFAULT_KERB_FLAT_HEIGHT;
  const requested = Math.max(0.005, Number(kerbSpanCorner.value) || 0.005);
  const corner = Math.max(requested, flat + 0.005);
  kerbSpanCorner.value = String(corner);
  editSelectedKerbSpan((editableSpan) => {
    editableSpan.cornerHeight = corner;
    editableSpan.flatHeight ??= flat;
  });
});

kerbSpanFlat.addEventListener("change", finishKerbEdit);
kerbSpanCorner.addEventListener("change", finishKerbEdit);

function finishKerbEdit(): void {
  if (!kerbEditStart) {
    return;
  }
  const start = kerbEditStart;
  kerbEditStart = null;
  if (!flushPendingRender()) {
    project = start;
    renderProject(project, { frame: false });
    setKerbStatus("The kerb span does not bake. Adjust or remove it.", "error");
    updateAuthoringUI();
    return;
  }
  if (project && JSON.stringify(start) !== JSON.stringify(project)) {
    pushUndo(start);
  }
  updateAuthoringUI();
}

kerbRemoveButton.addEventListener("click", removeKerbSpan);

modePointsButton.addEventListener("click", () => setEditorMode("points"));
modeKerbsButton.addEventListener("click", () => setEditorMode("kerbs"));

centerlineToggle.addEventListener("change", () => {
  view?.setCenterlinesVisible(editorMode === "points" && centerlineToggle.checked);
});
wireframeToggle.addEventListener("change", () => {
  view?.setWireframeVisible(wireframeToggle.checked);
});
boundaryToggle.addEventListener("change", () => {
  view?.setBoundaryVisible(boundaryToggle.checked);
});
tJunctionToggle.addEventListener("change", () => {
  view?.setTJunctionsVisible(tJunctionToggle.checked);
});
collisionToggle.addEventListener("change", () => {
  view?.setCollisionVisible(collisionToggle.checked);
});

exportButton.addEventListener("click", () => {
  if (!bakeValid || !currentTrack || !currentReport?.ok) {
    return;
  }
  try {
    const bundle = exportLapsterGlbTrack(currentTrack);
    for (const file of bundle.files) {
      downloadBytes(file.name, file.bytes, file.mimeType);
    }
    exportStatus.innerHTML = bundle.files
      .map(
        (file) =>
          `<div class="export-file"><span>${file.name}</span><strong>${formatNumber(
            file.bytes.length,
          )} B · ${hashBytes(file.bytes)}</strong></div>`,
      )
      .join("");
  } catch (error) {
    exportStatus.textContent = `Export failed: ${String(error)}`;
  }
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }
  if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (editorMode === "kerbs" && selectedKerbSpan) {
      event.preventDefault();
      removeKerbSpan();
    } else if (selectedPoint) {
      event.preventDefault();
      deleteSelectedPoint();
    }
  }
  if (event.key === "Escape") {
    if (editorMode === "kerbs") {
      event.preventDefault();
      drag = null;
      view?.setControlsEnabled(true);
      selectedKerbSpan = null;
      scheduleOverlayUpdate();
      updateAuthoringUI();
    }
  }
});

const resizeObserver = new ResizeObserver(() => {
  view?.resize();
});
resizeObserver.observe(viewport);

loadProject(loopSplineTerrainJunctionsFixture, true);
