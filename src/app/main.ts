import "./style.css";
import loopSplineTerrainJunctionsFixture from "../../fixtures/projects/loop-spline-terrain-junctions.json";
import { bakeProject, BakeError, spawnFor } from "../kernel/bake";
import {
  DEFAULT_KERB_FLAT_HEIGHT,
  DEFAULT_KERB_CORNER_HEIGHT,
  KERB_WIDTH,
  WALL_THICKNESS,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_OFFSET,
  DEFAULT_PROP_OFFSETS,
  DEFAULT_PROP_SPACING,
  DEFAULT_PROP_CENTERLINE_OFFSETS,
} from "../kernel/kerbs";
import {
  isVenueSchema,
  parseProject,
  type Project,
  type ProjectKerbSpan,
  type ProjectPropKind,
  type ProjectPropSpan,
  type ProjectRoadsideKind,
  type ProjectRoadsideRun,
  type ProjectRoadsideSpline,
  type ProjectWallSpan,
} from "../kernel/project";
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
  type PropOverlayData,
  type TerrainPointOverlayData,
  type TrackView,
} from "./scene";
import type { BakedTrack, Spawn, Vec3 } from "../model/baked-track";
import { mergeLooseBranchEnds } from "./branch-merge";
import { convertProjectToLatest } from "./convert-project";
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
      kind: "kerb-entry" | "kerb-exit" | "wall-entry" | "wall-exit";
      sectionId: string;
      spanIndex: number;
      startProject: Project;
    }
  | {
      kind: "wall-paint";
      sectionId: string;
      side: "left" | "right";
      closed: boolean;
      originFraction: number;
      previousFraction: number;
      signedLength: number;
      startProject: Project;
    }
  | {
      kind: "prop-paint";
      sectionId: string;
      side: "left" | "right";
      propKind: ProjectPropKind;
      paintOffset: number;
      closed: boolean;
      originFraction: number;
      previousFraction: number;
      signedLength: number;
      startProject: Project;
    }
  | {
      kind: "prop-entry" | "prop-exit";
      sectionId: string;
      spanIndex: number;
      startProject: Project;
    }
  | {
      kind: "roadside-paint";
      sectionId: string;
      splineId: string;
      runKind: ProjectRoadsideKind;
      closed: boolean;
      originFraction: number;
      previousFraction: number;
      signedLength: number;
      startProject: Project;
    }
  | {
      kind: "roadside-entry" | "roadside-exit";
      sectionId: string;
      splineId: string;
      runIndex: number;
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
        <button class="mode-button" id="mode-terrain" type="button">Terrain</button>
        <button class="mode-button active" id="mode-points" type="button">Track</button>
        <button class="mode-button" id="mode-roadside" type="button">Roadside</button>
        <button class="mode-button" id="mode-kerbs" type="button" hidden>Kerbs</button>
        <button class="mode-button" id="mode-walls" type="button" hidden>Walls</button>
        <button class="mode-button" id="mode-props" type="button" hidden>Props</button>
      </div>
      <div class="project-meta" id="project-meta"></div>
    </div>
  </header>
  <div class="workspace">
    <div class="viewport" id="viewport"></div>
    <aside class="sidebar">
      <section class="panel status-panel" id="status-panel">
        <button class="status-toggle" id="status-toggle" type="button" aria-expanded="false">
          <span>Geometry validation</span>
          <span class="status-pill" id="status-summary">PENDING</span>
          <span class="status-chevron">▾</span>
        </button>
        <div class="status-body" id="status-body" hidden></div>
      </section>
      <section class="panel" data-modes="track">
        <h2>Sections</h2>
        <div class="section-list" id="section-list"></div>
      </section>
      <section class="panel" data-modes="roadside">
        <h2>Roadside</h2>
        <div class="edit-field">
          <label for="roadside-section">section</label>
          <select id="roadside-section"></select>
        </div>
        <div class="edit-field">
          <label for="roadside-new-offset">new spline offset (m)</label>
          <input type="number" id="roadside-new-offset" min="0" step="0.1" value="12" />
        </div>
        <div class="edit-field">
          <label for="roadside-new-side">new spline side</label>
          <select id="roadside-new-side">
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
        </div>
        <div class="edit-actions">
          <button class="edit-button" id="roadside-add-spline" type="button">Add spline</button>
          <button class="edit-button" id="roadside-remove-spline" type="button">Remove spline</button>
        </div>
        <div class="junction-list" id="roadside-spline-list"></div>
        <div class="edit-actions">
          <button class="edit-button" id="roadside-kind-kerb" type="button">Kerb</button>
          <button class="edit-button" id="roadside-kind-wall" type="button">Wall</button>
          <button class="edit-button active" id="roadside-kind-tree" type="button">Trees</button>
          <button class="edit-button" id="roadside-kind-tyre" type="button">Tyres</button>
          <button class="edit-button" id="roadside-kind-block" type="button">Blocks</button>
        </div>
        <div class="edit-field" id="roadside-run-property-field" hidden>
          <label for="roadside-run-property" id="roadside-run-property-label">run property</label>
          <input type="number" id="roadside-run-property" min="0.1" step="0.1" />
        </div>
        <div class="edit-actions">
          <button class="edit-button" id="roadside-run-remove" type="button">Remove run</button>
        </div>
        <p class="edit-hint">
          Choose a feature type, then drag a spline rail to add a run. Select a run in 3D
          to edit its spacing or height. Fixed kerb splines are edited directly on the track.
        </p>
        <div class="edit-status" id="roadside-status"></div>
      </section>
      <section class="panel" data-modes="track">
        <h2>Authoring</h2>
        <div class="edit-actions">
          <button class="edit-button" id="undo-button" type="button">Undo</button>
          <button class="edit-button" id="redo-button" type="button">Redo</button>
          <button class="edit-button" id="delete-button" type="button">Delete point</button>
          <button class="edit-button" id="add-section-button" type="button">Add section</button>
          <button class="edit-button" id="add-junction-button" type="button">Add junction</button>
          <button class="edit-button" id="split-loop-button" type="button">Split loop</button>
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
      <section class="panel" data-modes="track">
        <h2>Spawn</h2>
        <div class="edit-field">
          <label for="spawn-centerline">centreline</label>
          <select id="spawn-centerline"></select>
        </div>
        <p class="edit-hint">
          Drag the spawn arrow to set its position along the selected centreline.
          Lateral position stays at the authored project value until starting-grid support is added.
        </p>
      </section>
      <section class="panel" data-modes="terrain">
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
      <section class="panel" hidden>
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
      <section class="panel" hidden>
        <h2>Walls</h2>
        <div class="edit-field">
          <label for="wall-height">wall height (m)</label>
          <input type="number" id="wall-height" min="0.1" step="0.05" />
        </div>
        <div class="edit-field">
          <label for="wall-offset">offset from asphalt edge (m)</label>
          <input type="number" id="wall-offset" min="0" step="0.05" />
        </div>
        <div class="junction-list" id="wall-list"></div>
        <div class="edit-actions">
          <button class="edit-button" id="wall-remove" type="button">Remove wall</button>
        </div>
        <p class="edit-hint">
          Switch to Walls mode, then drag a dotted blue guide rail to paint a wall span.
          Select a wall to edit its height and offset, or drag its endpoint handles.
        </p>
        <div class="edit-status" id="wall-status"></div>
      </section>
      <section class="panel" hidden>
        <h2>Props</h2>
        <div class="edit-actions">
          <button class="edit-button active" id="prop-kind-tree" type="button">Trees</button>
          <button class="edit-button" id="prop-kind-tyre" type="button">Tyres</button>
          <button class="edit-button" id="prop-kind-block" type="button">Blocks</button>
        </div>
        <div class="edit-field">
          <label for="prop-paint-offset">paint offset from centreline (m)</label>
          <input type="number" id="prop-paint-offset" min="0" step="0.1" value="12" />
        </div>
        <div class="junction-list" id="prop-list"></div>
        <div class="edit-field" id="prop-offset-field" hidden>
          <label for="prop-offset">run offset from centreline (m)</label>
          <input type="number" id="prop-offset" min="0" step="0.1" />
        </div>
        <div class="edit-field" id="prop-spacing-field" hidden>
          <label for="prop-spacing">spacing (m)</label>
          <input type="number" id="prop-spacing" min="0.1" step="0.1" />
        </div>
        <div class="edit-actions">
          <button class="edit-button" id="prop-remove" type="button">Remove run</button>
        </div>
        <p class="edit-hint">
          Switch to Props mode, choose Trees, Tyres, or Blocks, then drag a dotted guide rail
          to paint a run along the spline. Runs follow the section and are spaced automatically.
        </p>
        <div class="edit-status" id="prop-status"></div>
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
const statusToggle = document.querySelector<HTMLButtonElement>("#status-toggle")!;
const statusSummary = document.querySelector<HTMLSpanElement>("#status-summary")!;
const statusBody = document.querySelector<HTMLDivElement>("#status-body")!;
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
const sectionList = document.querySelector<HTMLDivElement>("#section-list")!;
const junctionList = document.querySelector<HTMLDivElement>("#junction-list")!;
const editStatus = document.querySelector<HTMLDivElement>("#edit-status")!;
const spawnCenterline = document.querySelector<HTMLSelectElement>("#spawn-centerline")!;
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
const modeRoadsideButton =
  document.querySelector<HTMLButtonElement>("#mode-roadside")!;
const roadsideSectionSelect =
  document.querySelector<HTMLSelectElement>("#roadside-section")!;
const roadsideNewOffset =
  document.querySelector<HTMLInputElement>("#roadside-new-offset")!;
const roadsideNewSide =
  document.querySelector<HTMLSelectElement>("#roadside-new-side")!;
const roadsideAddSplineButton =
  document.querySelector<HTMLButtonElement>("#roadside-add-spline")!;
const roadsideRemoveSplineButton =
  document.querySelector<HTMLButtonElement>("#roadside-remove-spline")!;
const roadsideSplineList =
  document.querySelector<HTMLDivElement>("#roadside-spline-list")!;
const roadsideRunPropertyField =
  document.querySelector<HTMLDivElement>("#roadside-run-property-field")!;
const roadsideRunPropertyLabel =
  document.querySelector<HTMLLabelElement>("#roadside-run-property-label")!;
const roadsideRunProperty =
  document.querySelector<HTMLInputElement>("#roadside-run-property")!;
const roadsideRunRemoveButton =
  document.querySelector<HTMLButtonElement>("#roadside-run-remove")!;
const roadsideStatus = document.querySelector<HTMLDivElement>("#roadside-status")!;
const roadsideKindButtons: Array<
  [HTMLButtonElement, ProjectRoadsideKind]
> = [
  [document.querySelector<HTMLButtonElement>("#roadside-kind-kerb")!, "kerb"],
  [document.querySelector<HTMLButtonElement>("#roadside-kind-wall")!, "wall"],
  [document.querySelector<HTMLButtonElement>("#roadside-kind-tree")!, "tree"],
  [document.querySelector<HTMLButtonElement>("#roadside-kind-tyre")!, "tyre"],
  [document.querySelector<HTMLButtonElement>("#roadside-kind-block")!, "block"],
];
const modeTerrainButton =
  document.querySelector<HTMLButtonElement>("#mode-terrain")!;
const modePointsButton = document.querySelector<HTMLButtonElement>("#mode-points")!;
const modeKerbsButton = document.querySelector<HTMLButtonElement>("#mode-kerbs")!;
const modeWallsButton = document.querySelector<HTMLButtonElement>("#mode-walls")!;
const modePropsButton = document.querySelector<HTMLButtonElement>("#mode-props")!;
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
const wallHeight = document.querySelector<HTMLInputElement>("#wall-height")!;
const wallOffset = document.querySelector<HTMLInputElement>("#wall-offset")!;
const wallList = document.querySelector<HTMLDivElement>("#wall-list")!;
const wallRemoveButton = document.querySelector<HTMLButtonElement>("#wall-remove")!;
const wallStatus = document.querySelector<HTMLDivElement>("#wall-status")!;
const propKindTree = document.querySelector<HTMLButtonElement>("#prop-kind-tree")!;
const propKindTyre = document.querySelector<HTMLButtonElement>("#prop-kind-tyre")!;
const propKindBlock = document.querySelector<HTMLButtonElement>("#prop-kind-block")!;
const propPaintOffsetInput =
  document.querySelector<HTMLInputElement>("#prop-paint-offset")!;
const propRemoveButton = document.querySelector<HTMLButtonElement>("#prop-remove")!;
const propList = document.querySelector<HTMLDivElement>("#prop-list")!;
const propOffsetField = document.querySelector<HTMLDivElement>("#prop-offset-field")!;
const propOffset = document.querySelector<HTMLInputElement>("#prop-offset")!;
const propSpacingField = document.querySelector<HTMLDivElement>("#prop-spacing-field")!;
const propSpacing = document.querySelector<HTMLInputElement>("#prop-spacing")!;
const propStatus = document.querySelector<HTMLDivElement>("#prop-status")!;

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
let selectedTerrainPoint: number | null = null;
let addTerrainPointMode = false;
let selectedKerbSpan: { sectionId: string; index: number } | null = null;
let selectedWallSpan: { sectionId: string; index: number } | null = null;
let kerbEditStart: Project | null = null;
let wallEditStart: Project | null = null;
let selectedPropSpan: { sectionId: string; index: number } | null = null;
let propEditStart: Project | null = null;
let propPaintKind: ProjectPropKind = "tree";
let propPaintOffset = DEFAULT_PROP_CENTERLINE_OFFSETS.tree;
let editorMode:
  | "terrain"
  | "track"
  | "kerbs"
  | "walls"
  | "props"
  | "roadside" = "track";
let roadsideSectionId: string | null = null;
let selectedRoadsideSpline: { sectionId: string; splineId: string } | null = null;
let selectedRoadsideRun:
  | { sectionId: string; splineId: string; runIndex: number }
  | null = null;
let roadsidePaintKind: ProjectRoadsideKind = "tree";
let roadsideEditStart: Project | null = null;
let bakeValid = false;
let statusExpanded = false;

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
      overlayForMode(project, currentTrack.bounds),
      overlayProps(currentTrack),
    );
    let spawn: Spawn | null = null;
    try {
      spawn = spawnFor(project);
    } catch {
      spawn = null;
    }
    view.updateSpawn(editorMode === "track" ? spawn : null);
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
  if (isVenueSchema(source.schema)) {
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
  const sectionVenue = project ? isVenueSchema(project.schema) : false;
  addSectionButton.disabled = !sectionVenue || selectedPoint === null;
  addSectionButton.title = sectionVenue
    ? "Create an independent dead-ended section near the selected control point."
    : "Independent sections require track-ed/project@3.";
  addJunctionButton.disabled = project === null || selectedPoint === null;
  addJunctionButton.title = sectionVenue
    ? "Create a dead-ended section joined at the selected control point."
    : "Create a junction and spur at the selected main-loop control point.";
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
    !(project && isVenueSchema(project.schema)) ||
    !selectedSection ||
    selectedPointId === undefined ||
    selectedEndpoint ||
    (project !== null &&
      isSectionPointInJunction(project, selectedSection.id, selectedPointId));
  splitLoopButton.title =
    project && isVenueSchema(project.schema)
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
    updateWallsUI(project);
    updatePropsUI(project);
    updateRoadsideUI(project);
  } else {
    sectionList.innerHTML = "";
    kerbList.innerHTML = "";
    wallList.innerHTML = "";
    propList.innerHTML = "";
    roadsideSplineList.innerHTML = "";
  }
}

function updateModeUI(): void {
  modeTerrainButton.classList.toggle("active", editorMode === "terrain");
  modePointsButton.classList.toggle("active", editorMode === "track");
  modeRoadsideButton.classList.toggle("active", editorMode === "roadside");
  modeKerbsButton.classList.toggle("active", editorMode === "kerbs");
  modeWallsButton.classList.toggle("active", editorMode === "walls");
  modePropsButton.classList.toggle("active", editorMode === "props");
  view?.setCenterlinesVisible(
    editorMode === "track" && centerlineToggle.checked,
  );
  updateModePanels();
}

function updateModePanels(): void {
  for (const panel of document.querySelectorAll<HTMLElement>("[data-modes]")) {
    const modes = (panel.dataset.modes ?? "").split(/\s+/);
    panel.hidden = !modes.includes(editorMode);
  }
}

function setEditorMode(
  mode: "terrain" | "track" | "kerbs" | "walls" | "props" | "roadside",
): void {
  if (editorMode === mode) {
    return;
  }
  editorMode = mode;
  drag = null;
  setSelection(null);
  setTerrainSelection(null);
  addTerrainPointMode = false;
  selectedKerbSpan = null;
  selectedWallSpan = null;
  selectedPropSpan = null;
  selectedRoadsideSpline = null;
  selectedRoadsideRun = null;
  if (mode === "roadside" && project && !roadsideSectionId) {
    roadsideSectionId = project.centerlines[0]?.id ?? null;
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

}

function showFatal(title: string, details: string[]): void {
  currentTrack = null;
  currentReport = null;
  bakeValid = false;
  statusSummary.textContent = "BLOCKED";
  statusSummary.className = "status-pill bad";
  statusBody.innerHTML = "";
  const heading = document.createElement("h3");
  heading.textContent = title;
  statusBody.appendChild(heading);
  const list = document.createElement("div");
  list.className = "violations";
  for (const detail of details) {
    const item = document.createElement("div");
    item.className = "violation error";
    item.textContent = detail;
    list.appendChild(item);
  }
  statusBody.appendChild(list);
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

function updateStatusCollapsed(): void {
  statusBody.hidden = !statusExpanded;
  statusToggle.setAttribute("aria-expanded", String(statusExpanded));
  statusPanel.classList.toggle("expanded", statusExpanded);
}

function renderStatus(track: BakedTrack, report: ValidationReport): void {
  const topology = report.topology;
  statusSummary.textContent = report.ok ? "VALID" : "BLOCKED";
  statusSummary.className = `status-pill ${report.ok ? "ok" : "bad"}`;
  statusBody.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "metrics";
  const kerbVertices = track.kerbGraph?.positions.length ?? 0;
  const kerbTriangles = track.kerbGraph
    ? Math.floor(track.kerbGraph.indices.length / 3)
    : 0;
  const wallVertices = track.wallGraph?.positions.length ?? 0;
  const wallTriangles = track.wallGraph
    ? Math.floor(track.wallGraph.indices.length / 3)
    : 0;
  grid.append(
    metric("vertices", formatNumber(track.surfaceGraph.positions.length)),
    metric("triangles", formatNumber(topology.triangleCount)),
    metric("kerb vertices", formatNumber(kerbVertices)),
    metric("kerb triangles", formatNumber(kerbTriangles)),
    metric("wall vertices", formatNumber(wallVertices)),
    metric("wall triangles", formatNumber(wallTriangles)),
    metric("props", formatNumber(track.props?.length ?? 0)),
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
      "wall non-manifold",
      formatNumber(report.wallTopology?.nonManifoldEdges.length ?? 0),
      (report.wallTopology?.nonManifoldEdges.length ?? 0) > 0 ? "bad" : "good",
    ),
    metric(
      "wall T-junctions",
      formatNumber(report.wallTopology?.tJunctions.length ?? 0),
      (report.wallTopology?.tJunctions.length ?? 0) > 0 ? "bad" : "good",
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
  statusBody.appendChild(grid);

  const note = document.createElement("p");
  note.className = "status-note";
  note.textContent =
    topology.interiorBoundaryEdges.length === 0 &&
    topology.nonManifoldEdges.length === 0 &&
    topology.tJunctions.length === 0
      ? track.kerbGraph || track.wallGraph
        ? "One welded ground graph plus separate roadside graphs. Roadside base edges are expected; ground open edges lie on the scene perimeter."
        : "One welded surface graph. The only open edges lie on the scene perimeter."
      : "Topology errors detected. Export is blocked until the MUST checks pass.";
  statusBody.appendChild(note);
}

function renderLegend(track: BakedTrack, report: ValidationReport): void {
  surfaceLegend.innerHTML = "";
  const counts = new Map(report.topology.surfaceTriangleCounts);
  for (const [id, count] of report.kerbTopology?.surfaceTriangleCounts ?? []) {
    counts.set(id, (counts.get(id) ?? 0) + count);
  }
  for (const [id, count] of report.wallTopology?.surfaceTriangleCounts ?? []) {
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
  if (editorMode !== "terrain") {
    return [];
  }
  return (source.terrain.points ?? []).map((point) => ({
    position: [point.position[0], point.position[1]],
    height: point.height,
  }));
}

function overlayProps(track: BakedTrack): PropOverlayData[] {
  return (track.props ?? []).map((prop) => ({
    id: prop.id,
    kind: prop.kind,
    position: prop.position,
    rotation: prop.rotation,
    scale: prop.scale,
    selected: false,
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

function roadsideRailPoints(
  source: Project,
  bounds: { min: Vec3; max: Vec3 },
  section: Project["centerlines"][number],
  kind: "kerb" | "wall" | "prop" | "spline",
  side: "left" | "right",
  start: number,
  length: number,
  offsetFromEdge?: number,
): Vec3[][] {
  const heightAt = centerlineHeightSampler(source, bounds);
  const sampled = sampleCenterline(
    section.points as Vec2[],
    section.closed,
    section.spline,
  );
  const defaultOffset =
    kind === "kerb" ? KERB_WIDTH / 2 : DEFAULT_WALL_OFFSET + WALL_THICKNESS / 2;
  const offset = source.road.halfWidth + (offsetFromEdge ?? defaultOffset);
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
  const activeKind: "kerb" | "wall" | "prop" | null =
    editorMode === "kerbs"
      ? "kerb"
      : editorMode === "walls"
        ? "wall"
        : editorMode === "props"
          ? "prop"
          : null;
  if (!activeKind) {
    return { rails: [], spans: [] };
  }
  const rails: KerbRailOverlayData[] = [];
  for (const section of source.centerlines) {
    for (const side of ["left", "right"] as const) {
      const edgeOffset =
        activeKind === "prop"
          ? propPaintOffset - source.road.halfWidth
          : undefined;
      const [points] = roadsideRailPoints(
        source,
        bounds,
        section,
        activeKind,
        side,
        0,
        1,
        edgeOffset,
      );
      if (points && points.length >= 2) {
        rails.push({
          kind: activeKind,
          sectionId: section.id,
          side,
          ...(activeKind === "prop" ? { offset: propPaintOffset, active: true } : {}),
          points,
        });
      }
    }
  }

  if (activeKind === "prop") {
    const seen = new Set(
      rails.map(
        (rail) =>
          `${rail.sectionId}:${rail.side}:${(rail.offset ?? 0).toFixed(3)}`,
      ),
    );
    for (const section of source.centerlines) {
      for (const span of section.props ?? []) {
        const centerlineOffset =
          source.road.halfWidth +
          (span.offset ?? DEFAULT_PROP_OFFSETS[span.kind]);
        const key = `${section.id}:${span.side}:${centerlineOffset.toFixed(3)}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const [points] = roadsideRailPoints(
          source,
          bounds,
          section,
          "prop",
          span.side,
          0,
          1,
          centerlineOffset - source.road.halfWidth,
        );
        if (points && points.length >= 2) {
          rails.push({
            kind: "prop",
            sectionId: section.id,
            side: span.side,
            offset: centerlineOffset,
            active: false,
            points,
          });
        }
      }
    }
  }

  if (activeKind === "prop") {
    const seenWalls = new Set<string>();
    for (const section of source.centerlines) {
      for (const wall of section.walls ?? []) {
        const centerlineOffset =
          source.road.halfWidth +
          (wall.offset ?? DEFAULT_WALL_OFFSET) +
          WALL_THICKNESS / 2;
        const key = `${section.id}:${wall.side}:${centerlineOffset.toFixed(3)}`;
        if (seenWalls.has(key)) {
          continue;
        }
        seenWalls.add(key);
        const [points] = roadsideRailPoints(
          source,
          bounds,
          section,
          "wall",
          wall.side,
          0,
          1,
          centerlineOffset - source.road.halfWidth,
        );
        if (points && points.length >= 2) {
          rails.push({
            kind: "wall",
            sectionId: section.id,
            side: wall.side,
            offset: centerlineOffset,
            active: false,
            points,
          });
        }
      }
    }
  }

  const spans: KerbOverlayData["spans"] = [];
  for (const section of source.centerlines) {
    const sectionSpans =
      activeKind === "kerb"
        ? section.kerbs ?? []
        : activeKind === "wall"
          ? section.walls ?? []
          : section.props ?? [];
    for (let spanIndex = 0; spanIndex < sectionSpans.length; spanIndex += 1) {
      const span = sectionSpans[spanIndex]!;
      const selectable =
        activeKind === "kerb"
          ? selectedKerbSpan?.sectionId === section.id &&
            selectedKerbSpan.index === spanIndex
          : activeKind === "wall"
            ? selectedWallSpan?.sectionId === section.id &&
              selectedWallSpan.index === spanIndex
            : selectedPropSpan?.sectionId === section.id &&
              selectedPropSpan.index === spanIndex;
      const offset =
        activeKind === "wall" && "offset" in span && span.offset !== undefined
          ? span.offset + WALL_THICKNESS / 2
          : activeKind === "prop" && "kind" in span
            ? span.offset ?? DEFAULT_PROP_OFFSETS[span.kind]
            : undefined;
      const pieces = roadsideRailPoints(
        source,
        bounds,
        section,
        activeKind,
        span.side,
        span.start,
        span.length,
        offset,
      );
      const first = pieces[0];
      const last = pieces[pieces.length - 1];
      if (!first || !last || first.length === 0 || last.length === 0) {
        continue;
      }
      spans.push({
        kind: activeKind,
        sectionId: section.id,
        spanIndex,
        side: span.side,
        selected: selectable,
        pieces,
        entry: first[0]!,
        exit: last[last.length - 1]!,
      });
    }
  }

  let preview: KerbOverlayData["preview"] = null;
  if (
    (drag?.kind === "kerb-paint" ||
      drag?.kind === "wall-paint" ||
      drag?.kind === "prop-paint") &&
    project
  ) {
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
        const kind =
          activeDrag.kind === "kerb-paint"
            ? "kerb"
            : activeDrag.kind === "wall-paint"
              ? "wall"
              : "prop";
        const offset =
          activeDrag.kind === "prop-paint"
            ? activeDrag.paintOffset - project.road.halfWidth
            : undefined;
        const pieces = roadsideRailPoints(
          project,
          bounds,
          section,
          kind,
          activeDrag.side,
          start,
          length,
          offset,
        );
        const first = pieces[0];
        const last = pieces[pieces.length - 1];
        if (first && last && first.length > 0 && last.length > 0) {
          preview = {
            kind,
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

  if (source.schema === "track-ed/project@5") {
    return {
      schema: "track-ed/project@5",
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
        ...(centerline.roadside && centerline.roadside.length > 0
          ? { roadside: centerline.roadside }
          : {}),
      })),
    };
  }

  if (isVenueSchema(source.schema)) {
    return {
      schema: source.schema,
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
        ...(centerline.walls && centerline.walls.length > 0
          ? { walls: centerline.walls }
          : {}),
        ...(centerline.props && centerline.props.length > 0
          ? { props: centerline.props }
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
      isVenueSchema(source.schema) ? "section" : "centreline"
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
      overlayForMode(project, baked.bounds),
      overlayProps(baked),
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
      overlayForMode(project, baked.bounds),
      overlayProps(baked),
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
  const converted = convertProjectToLatest(parsed.project);
  project = converted.ok ? converted.project : parsed.project;
  roadsideSectionId = project.centerlines[0]?.id ?? null;
  undoStack = [];
  redoStack = [];
  selectedPoint = null;
  selectedTerrainPoint = null;
  selectedKerbSpan = null;
  selectedWallSpan = null;
  selectedPropSpan = null;
  selectedRoadsideSpline = null;
  selectedRoadsideRun = null;
  kerbEditStart = null;
  wallEditStart = null;
  propEditStart = null;
  addTerrainPointMode = false;
  drag = null;
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
  selectedWallSpan = null;
  selectedPropSpan = null;
  selectedRoadsideSpline = null;
  selectedRoadsideRun = null;
  kerbEditStart = null;
  wallEditStart = null;
  propEditStart = null;
  addTerrainPointMode = false;
  drag = null;
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
  selectedWallSpan = null;
  selectedPropSpan = null;
  selectedRoadsideSpline = null;
  selectedRoadsideRun = null;
  kerbEditStart = null;
  wallEditStart = null;
  propEditStart = null;
  addTerrainPointMode = false;
  drag = null;
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
  const editable = isVenueSchema(source.schema);
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
      isVenueSchema(source.schema)
        ? "No kerb spans. Switch to Kerbs mode and drag a dotted guide rail."
        : "Kerb authoring requires track-ed/project@3 or project@4.";
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

function findWallSpan(
  source: Project,
  sectionId: string,
  spanIndex: number,
): { section: Project["centerlines"][number]; span: ProjectWallSpan } | null {
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  const span = section?.walls?.[spanIndex];
  return section && span ? { section, span } : null;
}

function findWallSpanAt(
  source: Project,
  sectionId: string,
  side: "left" | "right",
  fraction: number,
): number | null {
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return null;
  }
  const spans = section.walls ?? [];
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

function wallPaintSpan(
  drag: Extract<NonNullable<DragState>, { kind: "wall-paint" }>,
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

function updateWallsUI(source: Project): void {
  const editable = isVenueSchema(source.schema);
  if (
    selectedWallSpan &&
    !findWallSpan(source, selectedWallSpan.sectionId, selectedWallSpan.index)
  ) {
    selectedWallSpan = null;
  }

  wallList.innerHTML = "";
  let spanCount = 0;
  for (const section of source.centerlines) {
    const spans = section.walls ?? [];
    for (let index = 0; index < spans.length; index += 1) {
      spanCount += 1;
      const span = spans[index]!;
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        selectedWallSpan?.sectionId === section.id && selectedWallSpan.index === index
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
      } · ${(span.height ?? DEFAULT_WALL_HEIGHT).toFixed(2)} m`;
      label.append(title, detail);
      row.append(label);
      row.addEventListener("click", () => {
        selectedWallSpan = { sectionId: section.id, index };
        scheduleOverlayUpdate();
        updateWallsUI(source);
      });
      wallList.appendChild(row);
    }
  }
  if (spanCount === 0) {
    const empty = document.createElement("div");
    empty.className = "junction-empty";
    empty.textContent = isVenueSchema(source.schema)
      ? "No wall spans. Switch to Walls mode and drag a dotted blue guide rail."
      : "Wall authoring requires track-ed/project@3 or project@4.";
    wallList.appendChild(empty);
  }

  const selected = selectedWallSpan
    ? findWallSpan(source, selectedWallSpan.sectionId, selectedWallSpan.index)
    : null;
  const height = selected?.span.height ?? DEFAULT_WALL_HEIGHT;
  const offset = selected?.span.offset ?? DEFAULT_WALL_OFFSET;
  if (document.activeElement !== wallHeight) {
    wallHeight.value = String(height);
  }
  if (document.activeElement !== wallOffset) {
    wallOffset.value = String(offset);
  }
  wallHeight.disabled = !editable || selected === null;
  wallOffset.disabled = !editable || selected === null;
  wallRemoveButton.disabled = !editable || selected === null;
  wallStatus.textContent = selected
    ? `Editing ${selected.section.id} · ${selected.span.side} wall span.`
    : spanCount > 0
      ? `${spanCount} wall span${spanCount === 1 ? "" : "s"}.`
      : "No wall spans.";
}

function removeWallSpan(): void {
  if (!project || !selectedWallSpan) {
    return;
  }
  const located = findWallSpan(project, selectedWallSpan.sectionId, selectedWallSpan.index);
  if (!located) {
    return;
  }
  const before = cloneProject(project);
  located.section.walls!.splice(selectedWallSpan.index, 1);
  if (located.section.walls!.length === 0) {
    delete located.section.walls;
  }
  selectedWallSpan = null;
  if (!renderProject(project, { frame: false })) {
    project = before;
    renderProject(project, { frame: false });
    setWallStatus("The wall change does not bake.", "error");
    return;
  }
  pushUndo(before);
  setWallStatus("Removed wall span.", "ok");
  scheduleOverlayUpdate();
}

function setWallStatus(message: string, tone: "ok" | "error" | "" = ""): void {
  wallStatus.textContent = message;
  wallStatus.className = `edit-status ${tone}`.trim();
}

function editSelectedWallSpan(
  mutate: (span: ProjectWallSpan) => void,
): void {
  if (!project || !selectedWallSpan) {
    return;
  }
  const located = findWallSpan(project, selectedWallSpan.sectionId, selectedWallSpan.index);
  if (!located) {
    return;
  }
  if (!wallEditStart) {
    wallEditStart = cloneProject(project);
  }
  mutate(located.span);
  scheduleRender();
  scheduleOverlayUpdate();
  updateWallsUI(project);
  updateMeta(project);
}

function findPropSpan(
  source: Project,
  sectionId: string,
  spanIndex: number,
): { section: Project["centerlines"][number]; span: ProjectPropSpan } | null {
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  const span = section?.props?.[spanIndex];
  return section && span ? { section, span } : null;
}

function findPropSpanAt(
  source: Project,
  sectionId: string,
  side: "left" | "right",
  kind: ProjectPropKind,
  fraction: number,
  centerlineOffset?: number,
): number | null {
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  if (!section) {
    return null;
  }
  const spans = section.props ?? [];
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    const spanOffset =
      source.road.halfWidth +
      (span.offset ?? DEFAULT_PROP_OFFSETS[span.kind]);
    if (
      span.kind === kind &&
      span.side === side &&
      (centerlineOffset === undefined ||
        Math.abs(spanOffset - centerlineOffset) <= 0.05) &&
      kerbSpanContains(span.start, span.length, fraction, section.closed)
    ) {
      return index;
    }
  }
  return null;
}

function propPaintSpan(drag: {
  signedLength: number;
  originFraction: number;
  previousFraction: number;
}): { start: number; length: number } | null {
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

function updatePropsUI(source: Project): void {
  const editable = source.schema === "track-ed/project@4";
  if (
    selectedPropSpan &&
    !findPropSpan(source, selectedPropSpan.sectionId, selectedPropSpan.index)
  ) {
    selectedPropSpan = null;
  }

  propList.innerHTML = "";
  let spanCount = 0;
  for (const section of source.centerlines) {
    const spans = section.props ?? [];
    for (let index = 0; index < spans.length; index += 1) {
      spanCount += 1;
      const span = spans[index]!;
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        selectedPropSpan?.sectionId === section.id && selectedPropSpan.index === index
          ? "section-row selected"
          : "section-row";
      const label = document.createElement("div");
      label.className = "section-label";
      const title = document.createElement("strong");
      title.textContent = `${span.kind} · ${section.id} · ${span.side}`;
      const detail = document.createElement("span");
      const rawEnd = span.start + span.length;
      const end = section.closed ? rawEnd % 1 : rawEnd;
      const wraps = section.closed && rawEnd > 1 + 1e-9;
      const offset =
        source.road.halfWidth +
        (span.offset ?? DEFAULT_PROP_OFFSETS[span.kind]);
      const spacing = span.spacing ?? DEFAULT_PROP_SPACING[span.kind];
      detail.textContent = `${span.start.toFixed(3)} – ${end.toFixed(3)}${
        wraps ? " (wraps)" : ""
      } · ${offset.toFixed(1)} m from centre · ${spacing.toFixed(1)} m apart`;
      label.append(title, detail);
      row.append(label);
      row.addEventListener("click", () => {
        selectedPropSpan = { sectionId: section.id, index };
        propPaintKind = span.kind;
        scheduleOverlayUpdate();
        updatePropsUI(source);
      });
      propList.appendChild(row);
    }
  }
  if (spanCount === 0) {
    const empty = document.createElement("div");
    empty.className = "junction-empty";
    empty.textContent = editable
      ? "No prop runs. Switch to Props mode and drag a dotted guide rail."
      : "Prop runs require track-ed/project@4.";
    propList.appendChild(empty);
  }

  const selected = selectedPropSpan
    ? findPropSpan(source, selectedPropSpan.sectionId, selectedPropSpan.index)
    : null;
  if (document.activeElement !== propPaintOffsetInput) {
    propPaintOffsetInput.value = String(propPaintOffset);
  }
  propPaintOffsetInput.disabled = !editable;
  const offset =
    selected !== null
      ? source.road.halfWidth +
        (selected.span.offset ?? DEFAULT_PROP_OFFSETS[selected.span.kind])
      : propPaintOffset;
  const spacing = selected?.span.spacing ?? DEFAULT_PROP_SPACING[propPaintKind];
  propOffsetField.hidden = selected === null;
  propSpacingField.hidden = selected === null;
  if (document.activeElement !== propOffset) {
    propOffset.value = String(offset);
  }
  if (document.activeElement !== propSpacing) {
    propSpacing.value = String(spacing);
  }
  propOffset.disabled = !editable || selected === null;
  propSpacing.disabled = !editable || selected === null;
  propRemoveButton.disabled = !editable || selected === null;

  for (const [button, kind] of [
    [propKindTree, "tree"],
    [propKindTyre, "tyre"],
    [propKindBlock, "block"],
  ] as const) {
    button.classList.toggle("active", propPaintKind === kind);
    button.disabled = !editable;
  }

  propStatus.textContent = selected
    ? `Editing ${selected.span.kind} run on ${selected.section.id} · ${selected.span.side}.`
    : spanCount > 0
      ? `${spanCount} prop run${spanCount === 1 ? "" : "s"}. Painting ${propPaintKind} at ${propPaintOffset.toFixed(1)} m.`
      : `No prop runs. Painting ${propPaintKind} at ${propPaintOffset.toFixed(1)} m.`;
}

function removePropSpan(): void {
  if (!project || !selectedPropSpan) {
    return;
  }
  const located = findPropSpan(project, selectedPropSpan.sectionId, selectedPropSpan.index);
  if (!located) {
    return;
  }
  const before = cloneProject(project);
  located.section.props!.splice(selectedPropSpan.index, 1);
  if (located.section.props!.length === 0) {
    delete located.section.props;
  }
  selectedPropSpan = null;
  if (!renderProject(project, { frame: false })) {
    project = before;
    renderProject(project, { frame: false });
    setPropStatus("The prop run does not bake.", "error");
    return;
  }
  pushUndo(before);
  setPropStatus("Removed prop run.", "ok");
  scheduleOverlayUpdate();
}

function setPropStatus(message: string, tone: "ok" | "error" | "" = ""): void {
  propStatus.textContent = message;
  propStatus.className = `edit-status ${tone}`.trim();
}

function editSelectedPropSpan(mutate: (span: ProjectPropSpan) => void): void {
  if (!project || !selectedPropSpan) {
    return;
  }
  const located = findPropSpan(project, selectedPropSpan.sectionId, selectedPropSpan.index);
  if (!located) {
    return;
  }
  if (!propEditStart) {
    propEditStart = cloneProject(project);
  }
  mutate(located.span);
  scheduleRender();
  scheduleOverlayUpdate();
  updatePropsUI(project);
}

function finishPropSpanEdit(): void {
  if (!propEditStart) {
    return;
  }
  const start = propEditStart;
  propEditStart = null;
  if (!flushPendingRender()) {
    project = start;
    renderProject(project, { frame: false });
    setPropStatus("The prop run does not bake.", "error");
    updateAuthoringUI();
    return;
  }
  if (project && JSON.stringify(start) !== JSON.stringify(project)) {
    pushUndo(start);
  }
  updateAuthoringUI();
}

function roadsideSection(source: Project): Project["centerlines"][number] | null {
  if (!roadsideSectionId) {
    return source.centerlines[0] ?? null;
  }
  return (
    source.centerlines.find((section) => section.id === roadsideSectionId) ??
    source.centerlines[0] ??
    null
  );
}

function findRoadsideSpline(
  source: Project,
  sectionId: string,
  splineId: string,
): { section: Project["centerlines"][number]; spline: ProjectRoadsideSpline } | null {
  const section = source.centerlines.find((candidate) => candidate.id === sectionId);
  const spline = section?.roadside?.find((candidate) => candidate.id === splineId);
  return section && spline ? { section, spline } : null;
}

function findRoadsideRun(
  source: Project,
  sectionId: string,
  splineId: string,
  runIndex: number,
): { section: Project["centerlines"][number]; spline: ProjectRoadsideSpline; run: ProjectRoadsideRun } | null {
  const located = findRoadsideSpline(source, sectionId, splineId);
  const run = located?.spline.runs[runIndex];
  return located && run ? { ...located, run } : null;
}

function nextRoadsideSplineId(section: Project["centerlines"][number]): string {
  const used = new Set((section.roadside ?? []).map((spline) => spline.id));
  let index = (section.roadside?.length ?? 0) + 1;
  let id = `${section.id}:roadside:${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${section.id}:roadside:${index}`;
  }
  return id;
}

function roadsideDefaultOffset(
  source: Project,
  kind: ProjectRoadsideKind,
): number {
  if (kind === "kerb") {
    return source.road.halfWidth + KERB_WIDTH / 2;
  }
  if (kind === "wall") {
    return source.road.halfWidth + WALL_THICKNESS / 2;
  }
  return DEFAULT_PROP_CENTERLINE_OFFSETS[kind];
}

function findRoadsideRunAt(
  spline: ProjectRoadsideSpline,
  fraction: number,
  closed: boolean,
): number | null {
  let fallback: number | null = null;
  for (let index = 0; index < spline.runs.length; index += 1) {
    const run = spline.runs[index]!;
    if (!kerbSpanContains(run.start, run.length, fraction, closed)) {
      continue;
    }
    if (run.kind === "wall") {
      return index;
    }
    fallback ??= index;
  }
  return fallback;
}

function roadsideRunOverlaps(
  spline: ProjectRoadsideSpline,
  start: number,
  length: number,
  closed: boolean,
  kind: ProjectRoadsideKind,
  ignoreIndex = -1,
): boolean {
  return spline.runs.some((run, index) => {
    if (
      index === ignoreIndex ||
      !kerbSpansOverlap(start, length, run.start, run.length, closed)
    ) {
      return false;
    }
    const wallCoversKerb =
      spline.role !== undefined &&
      ((kind === "wall" && run.kind === "kerb") ||
        (kind === "kerb" && run.kind === "wall"));
    return !wallCoversKerb;
  });
}

function roadsideOverlayKind(
  kind: ProjectRoadsideKind,
): "kerb" | "wall" | "prop" {
  return kind === "kerb" ? "kerb" : kind === "wall" ? "wall" : "prop";
}

function roadsideRunKind(run: ProjectRoadsideRun): "kerb" | "wall" | "prop" {
  return roadsideOverlayKind(run.kind);
}

function updateRoadsideUI(source: Project): void {
  const editable = source.schema === "track-ed/project@5";
  const sectionIds = source.centerlines.map((section) => section.id);
  if (!roadsideSectionId || !sectionIds.includes(roadsideSectionId)) {
    roadsideSectionId = sectionIds[0] ?? null;
  }
  const optionIds = [...roadsideSectionSelect.options].map((option) => option.value);
  if (optionIds.join("\u0000") !== sectionIds.join("\u0000")) {
    roadsideSectionSelect.innerHTML = "";
    for (const id of sectionIds) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      roadsideSectionSelect.appendChild(option);
    }
  }
  if (roadsideSectionId) {
    roadsideSectionSelect.value = roadsideSectionId;
  }
  roadsideSectionSelect.disabled = !editable || sectionIds.length === 0;

  const section = roadsideSection(source);
  const splines = section?.roadside ?? [];
  const freeSplines = splines.filter((spline) => spline.role === undefined);
  if (
    selectedRoadsideSpline &&
    (!section ||
      selectedRoadsideSpline.sectionId !== section.id ||
      !splines.some((spline) => spline.id === selectedRoadsideSpline!.splineId))
  ) {
    selectedRoadsideSpline = null;
    selectedRoadsideRun = null;
  }

  roadsideSplineList.innerHTML = "";
  for (const spline of freeSplines) {
    const row = document.createElement("div");
    row.className =
      selectedRoadsideSpline?.splineId === spline.id
        ? "section-row roadside-spline-row selected"
        : "section-row roadside-spline-row";
    const label = document.createElement("div");
    label.className = "section-label";
    const title = document.createElement("strong");
    title.textContent = spline.id;
    const detail = document.createElement("span");
    detail.textContent = spline.side;
    label.append(title, detail);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "30";
    slider.step = "0.1";
    slider.value = String(spline.offset);
    slider.disabled = !editable;

    const number = document.createElement("input");
    number.type = "number";
    number.min = "0";
    number.step = "0.1";
    number.value = String(spline.offset);
    number.disabled = !editable;

    const select = (): void => {
      selectedRoadsideSpline = { sectionId: section!.id, splineId: spline.id };
      selectedRoadsideRun = null;
      scheduleOverlayUpdate();
      updateRoadsideUI(source);
    };
    const update = (value: number): void => {
      if (!Number.isFinite(value) || value < 0) {
        return;
      }
      selectedRoadsideSpline = { sectionId: section!.id, splineId: spline.id };
      selectedRoadsideRun = null;
      slider.value = String(value);
      number.value = String(value);
      editRoadsideSplineOffset(value);
    };
    row.addEventListener("click", select);
    slider.addEventListener("input", () => update(Number(slider.value)));
    number.addEventListener("input", () => update(Number(number.value)));
    slider.addEventListener("change", finishRoadsideEdit);
    number.addEventListener("change", finishRoadsideEdit);

    const controls = document.createElement("div");
    controls.className = "roadside-controls";
    controls.append(slider, number);
    row.append(label, controls);
    roadsideSplineList.appendChild(row);
  }
  if (freeSplines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "junction-empty";
    empty.textContent = editable
      ? "No free roadside splines on this section."
      : "Roadside splines require track-ed/project@5.";
    roadsideSplineList.appendChild(empty);
  }

  const activeSpline = selectedRoadsideSpline
    ? findRoadsideSpline(
        source,
        selectedRoadsideSpline.sectionId,
        selectedRoadsideSpline.splineId,
      )?.spline ?? null
    : null;
  if (
    selectedRoadsideRun &&
    (!activeSpline ||
      selectedRoadsideRun.splineId !== activeSpline.id ||
      !activeSpline.runs[selectedRoadsideRun.runIndex])
  ) {
    selectedRoadsideRun = null;
  }
  roadsideRemoveSplineButton.disabled =
    !editable || activeSpline === null || activeSpline.role !== undefined;

  const selectedRun = selectedRoadsideRun
    ? findRoadsideRun(
        source,
        selectedRoadsideRun.sectionId,
        selectedRoadsideRun.splineId,
        selectedRoadsideRun.runIndex,
      )?.run ?? null
    : null;
  const instanceRun =
    selectedRun && selectedRun.kind !== "kerb" && selectedRun.kind !== "wall"
      ? selectedRun
      : null;
  const wallRun = selectedRun?.kind === "wall" ? selectedRun : null;
  roadsideRunPropertyField.hidden = instanceRun === null && wallRun === null;
  if (instanceRun) {
    roadsideRunPropertyLabel.textContent = "spacing (m)";
    roadsideRunProperty.min = "0.1";
    roadsideRunProperty.step = "0.1";
    if (document.activeElement !== roadsideRunProperty) {
      roadsideRunProperty.value = String(
        instanceRun.spacing ?? DEFAULT_PROP_SPACING[instanceRun.kind],
      );
    }
  } else if (wallRun) {
    roadsideRunPropertyLabel.textContent = "height (m)";
    roadsideRunProperty.min = "0.1";
    roadsideRunProperty.step = "0.05";
    if (document.activeElement !== roadsideRunProperty) {
      roadsideRunProperty.value = String(wallRun.height ?? DEFAULT_WALL_HEIGHT);
    }
  }
  roadsideRunRemoveButton.disabled = !editable || selectedRun === null;

  for (const [button, kind] of roadsideKindButtons) {
    button.classList.toggle("active", roadsidePaintKind === kind);
    button.disabled = !editable;
  }

  roadsideStatus.textContent = activeSpline
    ? `${activeSpline.id} · ${activeSpline.side} · ${
        activeSpline.role !== undefined ? "fixed" : `${activeSpline.offset.toFixed(1)} m`
      } · painting ${roadsidePaintKind}.`
    : section
      ? `No spline selected on ${section.id}.`
      : "Add a section first.";
}

function setRoadsideStatus(message: string, tone: "ok" | "error" | "" = ""): void {
  roadsideStatus.textContent = message;
  roadsideStatus.className = `edit-status ${tone}`.trim();
}

function addRoadsideSpline(): void {
  if (!project || project.schema !== "track-ed/project@5") {
    return;
  }
  const section = roadsideSection(project);
  if (!section) {
    return;
  }
  const offset = Number(roadsideNewOffset.value);
  if (!Number.isFinite(offset) || offset < 0) {
    setRoadsideStatus("Spline offset must be non-negative.", "error");
    return;
  }
  const before = cloneProject(project);
  if (!section.roadside) {
    section.roadside = [];
  }
  const spline: ProjectRoadsideSpline = {
    id: nextRoadsideSplineId(section),
    side: roadsideNewSide.value === "right" ? "right" : "left",
    offset,
    runs: [],
  };
  section.roadside.push(spline);
  selectedRoadsideSpline = { sectionId: section.id, splineId: spline.id };
  selectedRoadsideRun = null;
  if (!renderProject(project, { frame: false })) {
    project = before;
    renderProject(project, { frame: false });
    setRoadsideStatus("The spline could not be added.", "error");
    return;
  }
  pushUndo(before);
  setRoadsideStatus("Added roadside spline.", "ok");
  scheduleOverlayUpdate();
  updateAuthoringUI();
}

function removeRoadsideSpline(): void {
  if (!project || !selectedRoadsideSpline) {
    return;
  }
  const located = findRoadsideSpline(
    project,
    selectedRoadsideSpline.sectionId,
    selectedRoadsideSpline.splineId,
  );
  if (!located) {
    return;
  }
  const before = cloneProject(project);
  located.section.roadside = (located.section.roadside ?? []).filter(
    (spline) => spline.id !== located.spline.id,
  );
  if (located.section.roadside.length === 0) {
    delete located.section.roadside;
  }
  selectedRoadsideSpline = null;
  selectedRoadsideRun = null;
  if (!renderProject(project, { frame: false })) {
    project = before;
    renderProject(project, { frame: false });
    setRoadsideStatus("The spline could not be removed.", "error");
    return;
  }
  pushUndo(before);
  setRoadsideStatus("Removed roadside spline.", "ok");
  scheduleOverlayUpdate();
  updateAuthoringUI();
}

function removeRoadsideRun(): void {
  if (!project || !selectedRoadsideRun) {
    return;
  }
  const located = findRoadsideRun(
    project,
    selectedRoadsideRun.sectionId,
    selectedRoadsideRun.splineId,
    selectedRoadsideRun.runIndex,
  );
  if (!located) {
    return;
  }
  const before = cloneProject(project);
  located.spline.runs.splice(selectedRoadsideRun.runIndex, 1);
  selectedRoadsideRun = null;
  if (!renderProject(project, { frame: false })) {
    project = before;
    renderProject(project, { frame: false });
    setRoadsideStatus("The run could not be removed.", "error");
    return;
  }
  pushUndo(before);
  setRoadsideStatus("Removed run.", "ok");
  scheduleOverlayUpdate();
  updateAuthoringUI();
}

function editRoadsideRun(
  mutate: (run: ProjectRoadsideRun) => void,
): void {
  if (!project || !selectedRoadsideRun) {
    return;
  }
  const located = findRoadsideRun(
    project,
    selectedRoadsideRun.sectionId,
    selectedRoadsideRun.splineId,
    selectedRoadsideRun.runIndex,
  );
  if (!located) {
    return;
  }
  if (!roadsideEditStart) {
    roadsideEditStart = cloneProject(project);
  }
  mutate(located.run);
  scheduleRender();
  scheduleOverlayUpdate();
  updateRoadsideUI(project);
}

function editRoadsideSplineOffset(value: number): void {
  if (!project || !selectedRoadsideSpline) {
    return;
  }
  const located = findRoadsideSpline(
    project,
    selectedRoadsideSpline.sectionId,
    selectedRoadsideSpline.splineId,
  );
  if (!located) {
    return;
  }
  if (!roadsideEditStart) {
    roadsideEditStart = cloneProject(project);
  }
  located.spline.offset = value;
  scheduleRender();
  scheduleOverlayUpdate();
}

function finishRoadsideEdit(): void {
  if (!roadsideEditStart) {
    return;
  }
  const start = roadsideEditStart;
  roadsideEditStart = null;
  if (!flushPendingRender()) {
    project = start;
    renderProject(project, { frame: false });
    setRoadsideStatus("The roadside change does not bake.", "error");
    updateAuthoringUI();
    return;
  }
  if (project && JSON.stringify(start) !== JSON.stringify(project)) {
    pushUndo(start);
  }
  updateAuthoringUI();
}

function overlayRoadsideSplines(
  source: Project,
  bounds: { min: Vec3; max: Vec3 },
): KerbOverlayData {
  if (editorMode !== "roadside") {
    return { rails: [], spans: [] };
  }
  const rails: KerbRailOverlayData[] = [];
  const spans: KerbOverlayData["spans"] = [];
  for (const section of source.centerlines) {
    for (const spline of section.roadside ?? []) {
      const edgeOffset = spline.offset - source.road.halfWidth;
      const [points] = roadsideRailPoints(
        source,
        bounds,
        section,
        "spline",
        spline.side,
        0,
        1,
        edgeOffset,
      );
      if (points && points.length >= 2) {
        rails.push({
          kind: "spline",
          sectionId: section.id,
          splineId: spline.id,
          side: spline.side,
          offset: spline.offset,
          active:
            selectedRoadsideSpline?.sectionId === section.id &&
            selectedRoadsideSpline.splineId === spline.id,
          points,
        });
      }
      for (let runIndex = 0; runIndex < spline.runs.length; runIndex += 1) {
        const run = spline.runs[runIndex]!;
        const pieces = roadsideRailPoints(
          source,
          bounds,
          section,
          "spline",
          spline.side,
          run.start,
          run.length,
          edgeOffset,
        );
        const first = pieces[0];
        const last = pieces[pieces.length - 1];
        if (!first || !last || first.length === 0 || last.length === 0) {
          continue;
        }
        spans.push({
          kind: roadsideRunKind(run),
          sectionId: section.id,
          splineId: spline.id,
          spanIndex: runIndex,
          side: spline.side,
          selected:
            selectedRoadsideRun?.sectionId === section.id &&
            selectedRoadsideRun.splineId === spline.id &&
            selectedRoadsideRun.runIndex === runIndex,
          pieces,
          entry: first[0]!,
          exit: last[last.length - 1]!,
        });
      }
    }
  }

  let preview: KerbOverlayData["preview"] = null;
  if (drag?.kind === "roadside-paint" && project) {
    const activeDrag = drag;
    const located = findRoadsideSpline(
      project,
      activeDrag.sectionId,
      activeDrag.splineId,
    );
    if (located) {
      const signed = activeDrag.signedLength;
      const start =
        signed >= 0 ? activeDrag.originFraction : activeDrag.previousFraction;
      const length = Math.abs(signed);
      if (length > 1e-5) {
        const pieces = roadsideRailPoints(
          project,
          bounds,
          located.section,
          "spline",
          located.spline.side,
          start,
          length,
          located.spline.offset - project.road.halfWidth,
        );
        const first = pieces[0];
        const last = pieces[pieces.length - 1];
        if (first && last && first.length > 0 && last.length > 0) {
          preview = {
            kind: roadsideOverlayKind(activeDrag.runKind),
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

function overlayForMode(
  source: Project,
  bounds: { min: Vec3; max: Vec3 },
): KerbOverlayData {
  return editorMode === "roadside"
    ? overlayRoadsideSplines(source, bounds)
    : overlayKerbs(source, bounds);
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
    if (isVenueSchema(source.schema)) {
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
  if (isVenueSchema(project.schema)) {
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
  if (isVenueSchema(project.schema)) {
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
  if (isVenueSchema(source.schema)) {
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
      if (editorMode === "walls") {
        const handle = trackView.pickKerbHandle(point.x, point.y);
        if (handle && handle.kind === "wall") {
          event.stopPropagation();
          event.preventDefault();
          selectedWallSpan = { sectionId: handle.sectionId, index: handle.spanIndex };
          drag = {
            kind: handle.handle === "entry" ? "wall-entry" : "wall-exit",
            sectionId: handle.sectionId,
            spanIndex: handle.spanIndex,
            startProject: cloneProject(project),
          };
          trackView.setControlsEnabled(false);
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
          scheduleOverlayUpdate();
          updateWallsUI(project);
          return;
        }
        const rail = trackView.pickKerbRail(point.x, point.y);
        if (rail && rail.kind === "wall") {
          const section = project.centerlines.find(
            (candidate) => candidate.id === rail.sectionId,
          );
          if (!section) {
            return;
          }
          const spanIndex = findWallSpanAt(
            project,
            rail.sectionId,
            rail.side,
            rail.fraction,
          );
          if (spanIndex !== null) {
            event.stopPropagation();
            event.preventDefault();
            selectedWallSpan = { sectionId: rail.sectionId, index: spanIndex };
            scheduleOverlayUpdate();
            updateWallsUI(project);
            return;
          }
          event.stopPropagation();
          event.preventDefault();
          drag = {
            kind: "wall-paint",
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

      if (editorMode === "roadside") {
        const handle = trackView.pickKerbHandle(point.x, point.y);
        if (handle && handle.splineId) {
          event.stopPropagation();
          event.preventDefault();
          selectedRoadsideSpline = {
            sectionId: handle.sectionId,
            splineId: handle.splineId,
          };
          selectedRoadsideRun = {
            sectionId: handle.sectionId,
            splineId: handle.splineId,
            runIndex: handle.spanIndex,
          };
          drag = {
            kind: handle.handle === "entry" ? "roadside-entry" : "roadside-exit",
            sectionId: handle.sectionId,
            splineId: handle.splineId,
            runIndex: handle.spanIndex,
            startProject: cloneProject(project),
          };
          trackView.setControlsEnabled(false);
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
          scheduleOverlayUpdate();
          updateRoadsideUI(project);
          return;
        }
        const rail = trackView.pickKerbRail(point.x, point.y);
        if (rail && rail.splineId) {
          const section = project.centerlines.find(
            (candidate) => candidate.id === rail.sectionId,
          );
          if (!section) {
            return;
          }
          event.stopPropagation();
          event.preventDefault();
          roadsideSectionId = rail.sectionId;
          const locatedSpline = section.roadside?.find(
            (candidate) => candidate.id === rail.splineId,
          );
          selectedRoadsideSpline = {
            sectionId: rail.sectionId,
            splineId: rail.splineId,
          };
          if (locatedSpline) {
            const runIndex = findRoadsideRunAt(
              locatedSpline,
              rail.fraction,
              section.closed,
            );
            if (runIndex !== null) {
              selectedRoadsideRun = {
                sectionId: rail.sectionId,
                splineId: rail.splineId,
                runIndex,
              };
              scheduleOverlayUpdate();
              updateRoadsideUI(project);
              return;
            }
          }
          selectedRoadsideRun = null;
          drag = {
            kind: "roadside-paint",
            sectionId: rail.sectionId,
            splineId: rail.splineId,
            runKind: roadsidePaintKind,
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
          updateRoadsideUI(project);
          return;
        }
        return;
      }

      if (editorMode === "props") {
        const handle = trackView.pickKerbHandle(point.x, point.y);
        if (handle && handle.kind === "prop") {
          event.stopPropagation();
          event.preventDefault();
          selectedPropSpan = { sectionId: handle.sectionId, index: handle.spanIndex };
          drag = {
            kind: handle.handle === "entry" ? "prop-entry" : "prop-exit",
            sectionId: handle.sectionId,
            spanIndex: handle.spanIndex,
            startProject: cloneProject(project),
          };
          trackView.setControlsEnabled(false);
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
          scheduleOverlayUpdate();
          updatePropsUI(project);
          return;
        }
        const rail = trackView.pickKerbRail(point.x, point.y);
        if (rail && rail.kind === "prop") {
          const section = project.centerlines.find(
            (candidate) => candidate.id === rail.sectionId,
          );
          if (!section) {
            return;
          }
          if (rail.offset !== undefined) {
            propPaintOffset = rail.offset;
          }
          const spanIndex = findPropSpanAt(
            project,
            rail.sectionId,
            rail.side,
            propPaintKind,
            rail.fraction,
            rail.offset,
          );
          if (spanIndex !== null) {
            event.stopPropagation();
            event.preventDefault();
            selectedPropSpan = { sectionId: rail.sectionId, index: spanIndex };
            scheduleOverlayUpdate();
            updatePropsUI(project);
            return;
          }
          event.stopPropagation();
          event.preventDefault();
          drag = {
            kind: "prop-paint",
            sectionId: rail.sectionId,
            side: rail.side,
            propKind: propPaintKind,
            paintOffset: propPaintOffset,
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

      const terrainPointIndex =
        editorMode === "terrain"
          ? trackView.pickTerrainPoint(point.x, point.y)
          : null;
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

      const hit =
        editorMode === "track"
          ? trackView.pickControlPoint(point.x, point.y)
          : null;
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
        } else if (hitCenterline && isVenueSchema(project.schema)) {
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

      if (editorMode === "track" && trackView.pickSpawn(point.x, point.y)) {
        event.stopPropagation();
        event.preventDefault();
        setSelection(null);
        drag = { kind: "spawn", startProject: cloneProject(project) };
        trackView.setControlsEnabled(false);
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }

      if (editorMode === "terrain" && addTerrainPointMode) {
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

      if (drag.kind === "wall-paint") {
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

      if (drag.kind === "wall-entry" || drag.kind === "wall-exit") {
        const activeDrag = drag;
        const section = project.centerlines.find(
          (candidate) => candidate.id === activeDrag.sectionId,
        );
        const span = section?.walls?.[activeDrag.spanIndex];
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
        if (activeDrag.kind === "wall-entry") {
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
        const overlaps = (section.walls ?? []).some(
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
        updateWallsUI(project);
        return;
      }

      if (drag.kind === "roadside-paint") {
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

      if (drag.kind === "roadside-entry" || drag.kind === "roadside-exit") {
        const activeDrag = drag;
        const located = findRoadsideRun(
          project,
          activeDrag.sectionId,
          activeDrag.splineId,
          activeDrag.runIndex,
        );
        if (!located) {
          return;
        }
        const section = located.section;
        const run = located.run;
        const fraction = nearestPolylineFraction(section, ground);
        if (fraction === null) {
          return;
        }
        const minimum = 0.002;
        let start = run.start;
        let length = run.length;
        if (activeDrag.kind === "roadside-entry") {
          const exit = kerbSpanEnd(run.start, run.length);
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
            ? (fraction - run.start + 1) % 1
            : fraction - run.start;
          if (forward <= minimum || forward >= 1) {
            return;
          }
          length = forward;
        }
        if (!section.closed && start + length > 1 + 1e-9) {
          return;
        }
        if (
          roadsideRunOverlaps(
            located.spline,
            start,
            length,
            section.closed,
            run.kind,
            activeDrag.runIndex,
          )
        ) {
          return;
        }
        run.start = start;
        run.length = length;
        scheduleOverlayUpdate();
        scheduleDragRender();
        updateRoadsideUI(project);
        return;
      }

      if (drag.kind === "prop-paint") {
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

      if (drag.kind === "prop-entry" || drag.kind === "prop-exit") {
        const activeDrag = drag;
        const section = project.centerlines.find(
          (candidate) => candidate.id === activeDrag.sectionId,
        );
        const span = section?.props?.[activeDrag.spanIndex];
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
        if (activeDrag.kind === "prop-entry") {
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
        span.start = start;
        span.length = length;
        scheduleOverlayUpdate();
        scheduleDragRender();
        updatePropsUI(project);
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
          isVenueSchema(project.schema)
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
              isVenueSchema(project.schema) &&
              targetCenterline?.id === branch.id;
            const isMergeTarget =
              isVenueSchema(project.schema) &&
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

    if (editorMode === "walls") {
      const handle = trackView.pickKerbHandle(point.x, point.y);
      if (handle && handle.kind === "wall") {
        canvas.style.cursor = "grab";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>wall handle</span><strong>${handle.handle}</strong></div>
          <div class="pick-row"><span>section</span><strong>${handle.sectionId}</strong></div>
        `;
        return;
      }
      const rail = trackView.pickKerbRail(point.x, point.y);
      if (rail && rail.kind === "wall") {
        const section = project?.centerlines.find(
          (candidate) => candidate.id === rail.sectionId,
        );
        const spanIndex = section
          ? findWallSpanAt(project!, rail.sectionId, rail.side, rail.fraction)
          : null;
        canvas.style.cursor = spanIndex === null ? "crosshair" : "pointer";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>wall rail</span><strong>${rail.sectionId} · ${rail.side}</strong></div>
          <div class="pick-row"><span>fraction</span><strong>${rail.fraction.toFixed(3)}</strong></div>
        `;
        return;
      }
      canvas.style.cursor = "default";
      pickInfo.textContent =
        "Drag a dotted wall rail to paint a span. Select a wall to edit height and offset.";
      return;
    }

    if (editorMode === "roadside") {
      const handle = trackView.pickKerbHandle(point.x, point.y);
      if (handle && handle.splineId) {
        canvas.style.cursor = "grab";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>roadside handle</span><strong>${handle.handle}</strong></div>
          <div class="pick-row"><span>spline</span><strong>${handle.splineId}</strong></div>
        `;
        return;
      }
      const rail = trackView.pickKerbRail(point.x, point.y);
      if (rail && rail.splineId) {
        canvas.style.cursor = "crosshair";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>roadside spline</span><strong>${rail.splineId}</strong></div>
          <div class="pick-row"><span>offset</span><strong>${(rail.offset ?? 0).toFixed(1)} m</strong></div>
        `;
        return;
      }
      canvas.style.cursor = "default";
      pickInfo.textContent =
        "Select a spline, choose a feature type, then drag a spline rail to paint.";
      return;
    }

    if (editorMode === "props") {
      const handle = trackView.pickKerbHandle(point.x, point.y);
      if (handle && handle.kind === "prop") {
        canvas.style.cursor = "grab";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>prop run handle</span><strong>${handle.handle}</strong></div>
          <div class="pick-row"><span>section</span><strong>${handle.sectionId}</strong></div>
        `;
        return;
      }
      const rail = trackView.pickKerbRail(point.x, point.y);
      if (rail && rail.kind === "prop") {
        const section = project?.centerlines.find(
          (candidate) => candidate.id === rail.sectionId,
        );
        const spanIndex = section
          ? findPropSpanAt(
              project!,
              rail.sectionId,
              rail.side,
              propPaintKind,
              rail.fraction,
              rail.offset,
            )
          : null;
        canvas.style.cursor = spanIndex === null ? "crosshair" : "pointer";
        pickInfo.innerHTML = `
          <div class="pick-row"><span>prop rail</span><strong>${rail.sectionId} · ${rail.side}</strong></div>
          <div class="pick-row"><span>kind</span><strong>${propPaintKind}</strong></div>
          <div class="pick-row"><span>offset</span><strong>${(rail.offset ?? propPaintOffset).toFixed(1)} m</strong></div>
        `;
        return;
      }
      canvas.style.cursor = "default";
      pickInfo.textContent =
        "Drag a dotted prop rail to paint a run. Select a run to edit offset and spacing.";
      return;
    }

    const hoverTerrainPoint =
      editorMode === "terrain"
        ? trackView.pickTerrainPoint(point.x, point.y)
        : null;
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

    const controlPoint =
      editorMode === "track"
        ? trackView.pickControlPoint(point.x, point.y)
        : null;
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

    if (currentDrag.kind === "wall-paint" && project) {
      const painted = wallPaintSpan(currentDrag);
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
      if (!section.closed && painted.start + painted.length > 1 + 1e-9) {
        setWallStatus("The wall span must stay within this open section.", "error");
        scheduleOverlayUpdate();
        return;
      }
      const overlaps = (section.walls ?? []).some(
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
        setWallStatus("Walls on the same side cannot overlap.", "error");
        scheduleOverlayUpdate();
        return;
      }
      const before = currentDrag.startProject;
      section.walls = [
        ...(section.walls ?? []),
        { side: currentDrag.side, start: painted.start, length: painted.length },
      ].sort((a, b) => a.side.localeCompare(b.side) || a.start - b.start);
      selectedWallSpan = {
        sectionId: section.id,
        index: section.walls.findIndex(
          (span) =>
            span.side === currentDrag.side &&
            span.start === painted.start &&
            span.length === painted.length,
        ),
      };
      if (!renderProject(project, { frame: false })) {
        project = before;
        selectedWallSpan = null;
        renderProject(project, { frame: false });
        setWallStatus("The painted wall span does not bake.", "error");
        scheduleOverlayUpdate();
        return;
      }
      pushUndo(before);
      setWallStatus("Painted wall span.", "ok");
      scheduleOverlayUpdate();
      updateAuthoringUI();
      return;
    }

    if (currentDrag.kind === "wall-entry" || currentDrag.kind === "wall-exit") {
      if (project && !bakeValid) {
        project = currentDrag.startProject;
        renderProject(project, { frame: false });
        setWallStatus("Wall resize rejected: the track would become invalid.", "error");
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

    if (currentDrag.kind === "roadside-paint" && project) {
      const painted = propPaintSpan(currentDrag);
      if (!painted) {
        scheduleOverlayUpdate();
        updateAuthoringUI();
        return;
      }
      const located = findRoadsideSpline(
        project,
        currentDrag.sectionId,
        currentDrag.splineId,
      );
      if (!located) {
        return;
      }
      if (
        !located.section.closed &&
        painted.start + painted.length > 1 + 1e-9
      ) {
        setRoadsideStatus("The run must stay within this open section.", "error");
        scheduleOverlayUpdate();
        return;
      }
      if (
        roadsideRunOverlaps(
          located.spline,
          painted.start,
          painted.length,
          located.section.closed,
          currentDrag.runKind,
        )
      ) {
        setRoadsideStatus(
          "Runs on one roadside spline cannot overlap.",
          "error",
        );
        scheduleOverlayUpdate();
        return;
      }
      const run: ProjectRoadsideRun =
        currentDrag.runKind === "kerb"
          ? { kind: "kerb", start: painted.start, length: painted.length }
          : currentDrag.runKind === "wall"
            ? { kind: "wall", start: painted.start, length: painted.length }
            : {
                kind: currentDrag.runKind,
                start: painted.start,
                length: painted.length,
              };
      const before = currentDrag.startProject;
      located.spline.runs.push(run);
      located.spline.runs.sort((a, b) => a.start - b.start);
      selectedRoadsideSpline = {
        sectionId: located.section.id,
        splineId: located.spline.id,
      };
      selectedRoadsideRun = {
        sectionId: located.section.id,
        splineId: located.spline.id,
        runIndex: located.spline.runs.indexOf(run),
      };
      if (!renderProject(project, { frame: false })) {
        project = before;
        selectedRoadsideRun = null;
        renderProject(project, { frame: false });
        setRoadsideStatus("The painted run does not bake.", "error");
        scheduleOverlayUpdate();
        return;
      }
      pushUndo(before);
      setRoadsideStatus("Painted roadside run.", "ok");
      scheduleOverlayUpdate();
      updateAuthoringUI();
      return;
    }

    if (
      currentDrag.kind === "roadside-entry" ||
      currentDrag.kind === "roadside-exit"
    ) {
      if (project && !bakeValid) {
        project = currentDrag.startProject;
        renderProject(project, { frame: false });
        setRoadsideStatus(
          "Run resize rejected: the track would become invalid.",
          "error",
        );
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

    if (currentDrag.kind === "prop-paint" && project) {
      const painted = propPaintSpan(currentDrag);
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
      if (!section.closed && painted.start + painted.length > 1 + 1e-9) {
        setPropStatus("The prop run must stay within this open section.", "error");
        scheduleOverlayUpdate();
        return;
      }
      const before = currentDrag.startProject;
      section.props = [
        ...(section.props ?? []),
        {
          kind: currentDrag.propKind,
          side: currentDrag.side,
          start: painted.start,
          length: painted.length,
          offset: Math.max(0, currentDrag.paintOffset - project.road.halfWidth),
        },
      ].sort(
        (a, b) =>
          a.side.localeCompare(b.side) ||
          a.kind.localeCompare(b.kind) ||
          a.start - b.start,
      );
      selectedPropSpan = {
        sectionId: section.id,
        index: section.props.findIndex(
          (span) =>
            span.kind === currentDrag.propKind &&
            span.side === currentDrag.side &&
            span.start === painted.start &&
            span.length === painted.length,
        ),
      };
      if (!renderProject(project, { frame: false })) {
        project = before;
        selectedPropSpan = null;
        renderProject(project, { frame: false });
        setPropStatus("The painted prop run does not bake.", "error");
        scheduleOverlayUpdate();
        return;
      }
      pushUndo(before);
      setPropStatus("Painted prop run.", "ok");
      scheduleOverlayUpdate();
      updateAuthoringUI();
      return;
    }

    if (currentDrag.kind === "prop-entry" || currentDrag.kind === "prop-exit") {
      if (project && !bakeValid) {
        project = currentDrag.startProject;
        renderProject(project, { frame: false });
        setPropStatus("Prop run resize rejected: the track would become invalid.", "error");
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
          if (isVenueSchema(project.schema) && targetCenterline) {
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
    if (!project || editorMode !== "track") {
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

statusToggle.addEventListener("click", () => {
  statusExpanded = !statusExpanded;
  updateStatusCollapsed();
});
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
  updateStatusCollapsed();
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

modeTerrainButton.addEventListener("click", () => setEditorMode("terrain"));
modePointsButton.addEventListener("click", () => setEditorMode("track"));
modeRoadsideButton.addEventListener("click", () => setEditorMode("roadside"));
roadsideSectionSelect.addEventListener("change", () => {
  roadsideSectionId = roadsideSectionSelect.value || null;
  selectedRoadsideSpline = null;
  selectedRoadsideRun = null;
  scheduleOverlayUpdate();
  if (project) {
    updateRoadsideUI(project);
  }
});
roadsideAddSplineButton.addEventListener("click", addRoadsideSpline);
roadsideRemoveSplineButton.addEventListener("click", removeRoadsideSpline);
for (const [button, kind] of roadsideKindButtons) {
  button.addEventListener("click", () => {
    roadsidePaintKind = kind;
    if (project) {
      roadsideNewOffset.value = String(roadsideDefaultOffset(project, kind));
    }
    scheduleOverlayUpdate();
    if (project) {
      updateRoadsideUI(project);
    }
  });
}
roadsideRunProperty.addEventListener("input", () => {
  if (!project || !selectedRoadsideRun) {
    return;
  }
  const value = Number(roadsideRunProperty.value);
  if (!Number.isFinite(value) || value <= 0) {
    return;
  }
  editRoadsideRun((run) => {
    if (run.kind === "wall") {
      run.height = value;
    } else if (run.kind !== "kerb") {
      run.spacing = value;
    }
  });
});
roadsideRunProperty.addEventListener("change", finishRoadsideEdit);
roadsideRunRemoveButton.addEventListener("click", removeRoadsideRun);
modeKerbsButton.addEventListener("click", () => setEditorMode("kerbs"));
modeWallsButton.addEventListener("click", () => setEditorMode("walls"));
modePropsButton.addEventListener("click", () => setEditorMode("props"));

wallHeight.addEventListener("input", () => {
  if (!project || !selectedWallSpan) {
    return;
  }
  const requested = Number(wallHeight.value);
  if (!Number.isFinite(requested) || requested <= 0) {
    return;
  }
  editSelectedWallSpan((span) => {
    span.height = requested;
  });
});
wallOffset.addEventListener("input", () => {
  if (!project || !selectedWallSpan) {
    return;
  }
  const requested = Number(wallOffset.value);
  if (!Number.isFinite(requested) || requested < 0) {
    return;
  }
  editSelectedWallSpan((span) => {
    span.offset = requested;
  });
});
wallHeight.addEventListener("change", finishWallEdit);
wallOffset.addEventListener("change", finishWallEdit);
wallRemoveButton.addEventListener("click", removeWallSpan);

function finishWallEdit(): void {
  if (!wallEditStart) {
    return;
  }
  const start = wallEditStart;
  wallEditStart = null;
  if (!flushPendingRender()) {
    project = start;
    renderProject(project, { frame: false });
    setWallStatus("The wall span does not bake. Adjust or remove it.", "error");
    updateAuthoringUI();
    return;
  }
  if (project && JSON.stringify(start) !== JSON.stringify(project)) {
    pushUndo(start);
  }
  updateAuthoringUI();
}

for (const [button, kind] of [
  [propKindTree, "tree"],
  [propKindTyre, "tyre"],
  [propKindBlock, "block"],
] as const) {
  button.addEventListener("click", () => {
    if (project && project.schema !== "track-ed/project@4") {
      setPropStatus("Props require track-ed/project@4.", "error");
      return;
    }
    if (editorMode !== "props") {
      setEditorMode("props");
    }
    propPaintKind = kind;
    propPaintOffset = DEFAULT_PROP_CENTERLINE_OFFSETS[kind];
    updateModeUI();
    scheduleOverlayUpdate();
    updateAuthoringUI();
  });
}
propPaintOffsetInput.addEventListener("input", () => {
  if (!project) {
    return;
  }
  const value = Number(propPaintOffsetInput.value);
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  propPaintOffset = value;
  scheduleOverlayUpdate();
  updatePropsUI(project);
});
propRemoveButton.addEventListener("click", removePropSpan);
propOffset.addEventListener("input", () => {
  if (!project || !selectedPropSpan) {
    return;
  }
  const value = Number(propOffset.value);
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  editSelectedPropSpan((span) => {
    span.offset = Math.max(0, value - (project?.road.halfWidth ?? 0));
  });
});
propSpacing.addEventListener("input", () => {
  if (!project || !selectedPropSpan) {
    return;
  }
  const value = Number(propSpacing.value);
  if (!Number.isFinite(value) || value <= 0) {
    return;
  }
  editSelectedPropSpan((span) => {
    span.spacing = value;
  });
});
propOffset.addEventListener("change", finishPropSpanEdit);
propSpacing.addEventListener("change", finishPropSpanEdit);

centerlineToggle.addEventListener("change", () => {
  view?.setCenterlinesVisible(
    editorMode === "track" && centerlineToggle.checked,
  );
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
    } else if (editorMode === "walls" && selectedWallSpan) {
      event.preventDefault();
      removeWallSpan();
    } else if (editorMode === "props" && selectedPropSpan) {
      event.preventDefault();
      removePropSpan();
    } else if (editorMode === "roadside" && selectedRoadsideRun) {
      event.preventDefault();
      removeRoadsideRun();
    } else if (selectedPoint) {
      event.preventDefault();
      deleteSelectedPoint();
    }
  }
  if (event.key === "Escape") {
    if (
      editorMode === "kerbs" ||
      editorMode === "walls" ||
      editorMode === "props" ||
      editorMode === "roadside"
    ) {
      event.preventDefault();
      drag = null;
      view?.setControlsEnabled(true);
      selectedKerbSpan = null;
      selectedWallSpan = null;
      selectedPropSpan = null;
      selectedRoadsideSpline = null;
      selectedRoadsideRun = null;
      scheduleOverlayUpdate();
      updateAuthoringUI();
    }
  }
});

const resizeObserver = new ResizeObserver(() => {
  view?.resize();
});
resizeObserver.observe(viewport);

updateStatusCollapsed();
loadProject(loopSplineTerrainJunctionsFixture, true);
