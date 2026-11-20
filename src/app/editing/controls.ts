import { exportLapsterGlbTrack } from "../../export/lapster";
import {
  compileAndStoreTrack,
  lapsterDriveUrl,
  trackPackInput,
} from "../lapster-host";
import type { EditingContext } from "./context";

export function attachControls(context: EditingContext): void {
  const elements = context.elements;

  elements.statusToggle.addEventListener("click", () => {
    context.setStatusExpanded(!context.isStatusExpanded());
    context.updateStatusCollapsed();
  });
  elements.undoButton.addEventListener("click", () => context.undo());
  elements.redoButton.addEventListener("click", () => context.redo());
  elements.deleteButton.addEventListener("click", () =>
    context.deleteSelectedPoint(),
  );
  elements.addSectionButton.addEventListener("click", () =>
    context.addLooseSectionAtSelected(),
  );
  elements.splitLoopButton.addEventListener("click", () =>
    context.splitLoopAtSelection(),
  );
  elements.terrainMode.addEventListener("change", () => {
    const project = context.getProject();
    if (!project) {
      return;
    }
    const before = context.cloneProject(project);
    project.terrain.mode =
      elements.terrainMode.value === "follow" ? "follow" : "conform";
    context.pushUndo(before);
    context.renderProject(project, { frame: false });
    context.updateAuthoringUI();
  });

  elements.addTerrainPointButton.addEventListener("click", () => {
    const next = !context.getAddTerrainPointMode();
    context.setAddTerrainPointMode(next);
    const canvas = elements.viewport.querySelector<HTMLCanvasElement>("canvas");
    if (canvas) {
      canvas.style.cursor = next ? "crosshair" : "default";
    }
    context.updateAuthoringUI();
  });
  elements.deleteTerrainPointButton.addEventListener("click", () =>
    context.deleteSelectedTerrainPoint(),
  );
  elements.clearTerrainPointsButton.addEventListener("click", () =>
    context.clearTerrainPoints(),
  );
  elements.terrainPointHeight.addEventListener("change", () => {
    const project = context.getProject();
    const selectedTerrainPoint = context.getSelectedTerrainPoint();
    if (!project || selectedTerrainPoint === null) {
      return;
    }
    const terrainPoint = project.terrain.points?.[selectedTerrainPoint];
    if (!terrainPoint) {
      return;
    }
    const value = Number(elements.terrainPointHeight.value);
    if (!Number.isFinite(value)) {
      return;
    }
    const before = context.cloneProject(project);
    terrainPoint.height = value;
    const ok = context.renderProject(project, { frame: false });
    if (ok) {
      context.pushUndo(before);
    } else {
      context.setProject(before);
      context.renderProject(before, { frame: false });
      context.setEditStatus("Terrain point height is invalid.", "error");
    }
    context.updateAuthoringUI();
  });
  elements.addJunctionButton.addEventListener("click", () =>
    context.addJunction(),
  );
  elements.frameButton.addEventListener("click", () => {
    context.getView()?.frame();
  });

  elements.newButton.addEventListener("click", () => {
    if (
      context.getUndoDepth() > 0 &&
      !window.confirm("Discard edits and start a new loop?")
    ) {
      return;
    }
    context.loadDefaultProject();
  });

  elements.saveButton.addEventListener("click", () => {
    const project = context.getProject();
    if (!project) {
      return;
    }
    context.downloadBytes(
      "project.json",
      new TextEncoder().encode(
        `${JSON.stringify(context.serializeProject(project), null, 2)}\n`,
      ),
      "application/json",
    );
  });

  elements.openButton.addEventListener("click", () => {
    elements.openFile.click();
  });

  elements.openFile.addEventListener("change", async () => {
    const file = elements.openFile.files?.[0];
    elements.openFile.value = "";
    if (!file) {
      return;
    }
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(await file.text());
    } catch {
      context.setEditStatus("Open failed: invalid JSON.", "error");
      return;
    }
    context.loadProject(parsedValue, true);
  });

  elements.spawnCenterline.addEventListener("change", () => {
    const project = context.getProject();
    if (
      !project ||
      elements.spawnCenterline.value === project.spawn.centerline
    ) {
      return;
    }
    const before = context.cloneProject(project);
    project.spawn.centerline = elements.spawnCenterline.value;
    context.pushUndo(before);
    context.renderProject(project, { frame: false });
    context.updateAuthoringUI();
  });

  elements.modeTerrainButton.addEventListener("click", () =>
    context.setEditorMode("terrain"),
  );
  elements.modePointsButton.addEventListener("click", () =>
    context.setEditorMode("track"),
  );
  elements.modeRoadsideButton.addEventListener("click", () =>
    context.setEditorMode("roadside"),
  );
  elements.roadsideSectionSelect.addEventListener("change", () => {
    context.setRoadsideSectionId(elements.roadsideSectionSelect.value || null);
    context.setSelectedRoadsideSpline(null);
    context.setSelectedRoadsideRun(null);
    context.scheduleOverlayUpdate();
    const project = context.getProject();
    if (project) {
      context.updateRoadsideUI(project);
    }
  });
  elements.roadsideAddSplineButton.addEventListener("click", () =>
    context.addRoadsideSpline(),
  );
  elements.roadsideRemoveSplineButton.addEventListener("click", () =>
    context.removeRoadsideSpline(),
  );
  for (const [button, kind] of elements.roadsideKindButtons) {
    button.addEventListener("click", () => {
      context.setRoadsidePaintKind(kind);
      const project = context.getProject();
      if (project) {
        elements.roadsideNewOffset.value = String(
          context.roadsideDefaultOffset(project, kind),
        );
      }
      context.scheduleOverlayUpdate();
      if (project) {
        context.updateRoadsideUI(project);
      }
    });
  }
  elements.roadsideRunProperty.addEventListener("input", () => {
    if (!context.getProject() || !context.getSelectedRoadsideRun()) {
      return;
    }
    const value = Number(elements.roadsideRunProperty.value);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    context.editRoadsideRun((run) => {
      if (run.kind === "wall") {
        run.height = value;
      } else if (run.kind !== "kerb") {
        run.spacing = value;
      }
    });
  });
  elements.roadsideRunProperty.addEventListener("change", () =>
    context.finishRoadsideEdit(),
  );
  elements.roadsideRunRemoveButton.addEventListener("click", () =>
    context.removeRoadsideRun(),
  );

  elements.centerlineToggle.addEventListener("change", () => {
    context.getView()?.setCenterlinesVisible(
      context.getEditorMode() === "track" && elements.centerlineToggle.checked,
    );
  });
  elements.racingLineToggle.addEventListener("change", () => {
    context.getView()?.setRacingLineVisible(elements.racingLineToggle.checked);
  });
  elements.wireframeToggle.addEventListener("change", () => {
    context.getView()?.setWireframeVisible(elements.wireframeToggle.checked);
  });
  elements.boundaryToggle.addEventListener("change", () => {
    context.getView()?.setBoundaryVisible(elements.boundaryToggle.checked);
  });
  elements.tJunctionToggle.addEventListener("change", () => {
    context.getView()?.setTJunctionsVisible(elements.tJunctionToggle.checked);
  });
  elements.collisionToggle.addEventListener("change", () => {
    context.getView()?.setCollisionVisible(elements.collisionToggle.checked);
  });

  elements.exportButton.addEventListener("click", () => {
    const currentTrack = context.getCurrentTrack();
    if (
      !context.isBakeValid() ||
      !currentTrack ||
      !context.getCurrentReport()?.ok
    ) {
      return;
    }
    try {
      const bundle = exportLapsterGlbTrack(currentTrack);
      for (const file of bundle.files) {
        context.downloadBytes(file.name, file.bytes, file.mimeType);
      }
      elements.exportStatus.innerHTML = bundle.files
        .map(
          (file) =>
            `<div class="export-file"><span>${file.name}</span><strong>${context.formatNumber(
              file.bytes.length,
            )} B · ${context.hashBytes(file.bytes)}</strong></div>`,
        )
        .join("");
    } catch (error) {
      elements.exportStatus.textContent = `Export failed: ${String(error)}`;
    }
  });

  elements.testDriveButton.addEventListener("click", () => {
    const currentTrack = context.getCurrentTrack();
    if (
      !context.isBakeValid() ||
      !currentTrack ||
      !context.getCurrentReport()?.ok
    ) {
      return;
    }
    elements.testDriveButton.disabled = true;
    void (async () => {
      try {
        elements.exportStatus.textContent = "Compiling Lapster track...";
        const bundle = exportLapsterGlbTrack(currentTrack);
        const pack = await compileAndStoreTrack(trackPackInput(bundle));
        elements.exportStatus.textContent = `Compiled ${context.formatNumber(
          pack.byteLength,
        )} B. Opening Test drive...`;
        window.location.href = lapsterDriveUrl(
          window.location.href,
          window.location.search,
        ).toString();
      } catch (error) {
        elements.testDriveButton.disabled = false;
        elements.exportStatus.textContent = `Test drive failed: ${String(error)}`;
      }
    })();
  });
}
