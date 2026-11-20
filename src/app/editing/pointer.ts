import { isVenueSchema } from "../../kernel/project";
import { isLooseSectionEnd } from "../section-edit";
import type { TrackView } from "../scene";
import type { EditingContext } from "./context";
import {
  advancePaint,
  clampSpawnFraction,
  isLooseEndpoint,
  paintSpan,
  previewResize,
  shouldDetach,
  type DragState,
} from "./drag";

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

export function attachPointerEditing(
  trackView: TrackView,
  canvas: HTMLCanvasElement,
  context: EditingContext,
): void {
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      const project = context.getProject();
      if (event.button !== 0 || !project) {
        return;
      }
      const point = pointerNdc(event, canvas);
      const editorMode = context.getEditorMode();
      if (editorMode === "roadside") {
        const handle = trackView.pickKerbHandle(point.x, point.y);
        if (handle && handle.splineId) {
          event.stopPropagation();
          event.preventDefault();
          context.setSelectedRoadsideSpline({
            sectionId: handle.sectionId,
            splineId: handle.splineId,
          });
          context.setSelectedRoadsideRun({
            sectionId: handle.sectionId,
            splineId: handle.splineId,
            runIndex: handle.spanIndex,
          });
          context.setDrag({
            kind: handle.handle === "entry" ? "roadside-entry" : "roadside-exit",
            sectionId: handle.sectionId,
            splineId: handle.splineId,
            runIndex: handle.spanIndex,
            startProject: context.cloneProject(project),
          });
          trackView.setControlsEnabled(false);
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
          context.scheduleOverlayUpdate();
          context.updateRoadsideUI(project);
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
          context.setRoadsideSectionId(rail.sectionId);
          const locatedSpline = section.roadside?.find(
            (candidate) => candidate.id === rail.splineId,
          );
          context.setSelectedRoadsideSpline({
            sectionId: rail.sectionId,
            splineId: rail.splineId,
          });
          if (locatedSpline) {
            const runIndex = context.findRoadsideRunAt(
              locatedSpline,
              rail.fraction,
              section.closed,
            );
            if (runIndex !== null) {
              context.setSelectedRoadsideRun({
                sectionId: rail.sectionId,
                splineId: rail.splineId,
                runIndex,
              });
              context.scheduleOverlayUpdate();
              context.updateRoadsideUI(project);
              return;
            }
          }
          context.setSelectedRoadsideRun(null);
          context.setDrag({
            kind: "roadside-paint",
            sectionId: rail.sectionId,
            splineId: rail.splineId,
            runKind: context.getRoadsidePaintKind(),
            closed: section.closed,
            originFraction: rail.fraction,
            previousFraction: rail.fraction,
            signedLength: 0,
            startProject: context.cloneProject(project),
          });
          trackView.setControlsEnabled(false);
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "crosshair";
          context.scheduleOverlayUpdate();
          context.updateRoadsideUI(project);
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
        context.setTerrainSelection(terrainPointIndex);
        const terrainPoint = project.terrain.points?.[terrainPointIndex];
        if (!terrainPoint) {
          return;
        }
        context.setDrag({
          kind: "terrain-point",
          index: terrainPointIndex,
          startProject: context.cloneProject(project),
          startHeight: terrainPoint.height,
          startClientY: event.clientY,
          unitsPerPixel: trackView.screenUnitsPerPixel(),
        });
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
          const junction = project.junctions.find(
            (candidate) => candidate.id === junctionId,
          );
          if (!junction) {
            return;
          }
          const hostIndex = project.centerlines.findIndex(
            (candidate) => candidate.id === junction.centerline,
          );
          const host = hostIndex >= 0 ? project.centerlines[hostIndex] : undefined;
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
        context.setSelection(resolved);
        const centerline = project.centerlines[resolved.centerlineIndex];
        if (!centerline) {
          return;
        }
        const startProject = context.cloneProject(project);
        const pendingDetach = shouldDetach(
          centerline.closed,
          resolved.pointIndex,
          centerline.points.length,
          Boolean(centerline.endAttach),
        );
        trackView.setJoinTarget(null);
        if (
          !centerline.closed &&
          resolved.pointIndex === 0 &&
          centerline.attach &&
          "to" in centerline.attach
        ) {
          context.setDrag({ kind: "attach", startProject });
        } else {
          context.setDrag({
            kind: "point",
            centerlineIndex: resolved.centerlineIndex,
            pointIndex: resolved.pointIndex,
            startProject,
            ...(pendingDetach ? { pendingDetach: true } : {}),
          });
        }
        trackView.setControlsEnabled(false);
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }

      if (editorMode === "track" && trackView.pickSpawn(point.x, point.y)) {
        event.stopPropagation();
        event.preventDefault();
        context.setSelection(null);
        context.setDrag({
          kind: "spawn",
          startProject: context.cloneProject(project),
        });
        trackView.setControlsEnabled(false);
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = "grabbing";
        return;
      }

      if (editorMode === "terrain" && context.getAddTerrainPointMode()) {
        const surface = trackView.pick(point.x, point.y);
        if (surface && surface.surfaceId === 2) {
          event.stopPropagation();
          event.preventDefault();
          context.addTerrainPointAt(surface.point);
        }
      }
    },
    { capture: true },
  );

  canvas.addEventListener("pointermove", (event) => {
    const point = pointerNdc(event, canvas);
    const drag = context.getDrag();
    if (drag) {
      const project = context.getProject();
      if (!project) {
        return;
      }
      const ground = trackView.pickGround(point.x, point.y);
      if (!ground) {
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
        const fraction = context.nearestPolylineFraction(section, ground);
        if (fraction === null) {
          return;
        }
        const progress = advancePaint(activeDrag, fraction, activeDrag.closed);
        activeDrag.signedLength = progress.signedLength;
        activeDrag.previousFraction = progress.previousFraction;
        context.scheduleOverlayUpdate();
        return;
      }

      if (drag.kind === "roadside-entry" || drag.kind === "roadside-exit") {
        const activeDrag = drag;
        const located = context.findRoadsideRun(
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
        const fraction = context.nearestPolylineFraction(section, ground);
        if (fraction === null) {
          return;
        }
        const resized = previewResize(
          { start: run.start, length: run.length },
          activeDrag.kind === "roadside-entry" ? "entry" : "exit",
          fraction,
          section.closed,
          0.002,
        );
        if (!resized) {
          return;
        }
        if (
          context.roadsideRunOverlaps(
            located.spline,
            resized.start,
            resized.length,
            section.closed,
            run.kind,
            activeDrag.runIndex,
          )
        ) {
          return;
        }
        run.start = resized.start;
        run.length = resized.length;
        context.scheduleOverlayUpdate();
        context.scheduleDragRender();
        context.updateRoadsideUI(project);
        return;
      }

      if (drag.kind === "terrain-point") {
        const terrainPoint = project.terrain.points?.[drag.index];
        if (!terrainPoint) {
          return;
        }
        const delta = (drag.startClientY - event.clientY) * drag.unitsPerPixel;
        terrainPoint.height = Math.max(-100, Math.min(100, drag.startHeight + delta));
        context.scheduleOverlayUpdate();
        context.scheduleDragRender();
        return;
      }

      if (drag.kind === "point") {
        let currentProject = context.getProject();
        if (!currentProject) {
          return;
        }
        let branch = currentProject.centerlines[drag.centerlineIndex];
        if (!branch || !branch.points[drag.pointIndex]) {
          return;
        }

        if (drag.pendingDetach) {
          const candidate = context.cloneProject(currentProject);
          const candidateBranch = candidate.centerlines[drag.centerlineIndex];
          if (!candidateBranch) {
            return;
          }
          const junctionId =
            candidateBranch.endAttach && "junction" in candidateBranch.endAttach
              ? candidateBranch.endAttach.junction
              : null;
          delete candidateBranch.endAttach;
          candidateBranch.pointIds[drag.pointIndex] = context.nextPointId(
            candidateBranch,
          );
          if (
            junctionId &&
            !context.isJunctionReferenced(candidate, junctionId)
          ) {
            candidate.junctions = candidate.junctions.filter(
              (candidateJunction) => candidateJunction.id !== junctionId,
            );
          }
          candidateBranch.points[drag.pointIndex] = [ground[0], ground[1]];
          context.syncBranchStart(candidate);
          if (!context.renderProject(candidate, { frame: false })) {
            context.renderProject(currentProject, { frame: false });
            context.setEditStatus(
              "Move the end farther from the main loop to detach it.",
              "error",
            );
            return;
          }
          drag.pendingDetach = false;
          currentProject = context.getProject()!;
          branch = currentProject.centerlines[drag.centerlineIndex];
          if (!branch) {
            return;
          }
        } else {
          branch.points[drag.pointIndex] = [ground[0], ground[1]];
          context.syncBranchStart(currentProject);
          context.scheduleOverlayUpdate();
          context.scheduleDragRender();
        }

        const isEndpoint = isLooseEndpoint(
          branch.closed,
          drag.pointIndex,
          branch.points.length,
        );
        const canJoin = isVenueSchema(currentProject.schema)
          ? isEndpoint &&
            isLooseSectionEnd(currentProject, branch.id, drag.pointIndex)
          : drag.pointIndex === branch.points.length - 1;
        if (canJoin) {
          const position = branch.points[drag.pointIndex]!;
          const target = context.findJoinTarget(
            currentProject,
            drag.centerlineIndex,
            drag.pointIndex,
            position,
          );
          trackView.setJoinTarget(target);
          if (target) {
            const targetCenterline =
              currentProject.centerlines[target.centerlineIndex];
            const isLoopClose =
              isVenueSchema(currentProject.schema) &&
              targetCenterline?.id === branch.id;
            const isMergeTarget =
              isVenueSchema(currentProject.schema) &&
              targetCenterline !== undefined &&
              !isLoopClose &&
              isLooseSectionEnd(
                currentProject,
                targetCenterline.id,
                target.pointIndex,
              );
            if (isLoopClose) {
              context.setEditStatus(
                "Release to close this section into a loop",
                "ok",
              );
            } else if (isMergeTarget) {
              context.setEditStatus(
                `Release to merge ${branch.id} and ${targetCenterline.id}`,
                "ok",
              );
            } else if (targetCenterline?.closed) {
              context.setEditStatus(
                `Release to join ${branch.id} to ${targetCenterline.id}/${
                  targetCenterline.pointIds[target.pointIndex] ?? ""
                }`,
                "ok",
              );
            } else {
              context.setEditStatus(
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
          (candidate) => candidate.id === project.spawn.centerline,
        );
        if (!centerline) {
          return;
        }
        const fraction = context.nearestPolylineFraction(centerline, ground);
        if (fraction === null) {
          return;
        }
        project.spawn.fraction = clampSpawnFraction(fraction);
        context.scheduleOverlayUpdate();
        context.scheduleDragRender();
        return;
      }

      const main = context.mainOf(project);
      const legacyBranch = context
        .branchesOf(project)
        .find((candidate) => candidate.attach && "to" in candidate.attach);
      const fraction = main ? context.nearestPolylineFraction(main, ground) : null;
      if (
        !legacyBranch?.attach ||
        !("fraction" in legacyBranch.attach) ||
        fraction === null
      ) {
        return;
      }
      const previous = context.cloneProject(project);
      context.moveBranchAttach(project, fraction);
      if (!context.renderProject(project, { frame: false })) {
        context.setProject(previous);
        context.renderProject(previous, { frame: false });
        context.setEditStatus(
          "Attach move blocked: the branch would cross the main loop or become invalid.",
          "error",
        );
      }
      return;
    }

    const editorMode = context.getEditorMode();
    const project = context.getProject();
    if (editorMode === "roadside") {
      const handle = trackView.pickKerbHandle(point.x, point.y);
      if (handle && handle.splineId) {
        canvas.style.cursor = "grab";
        context.elements.pickInfo.innerHTML = `
          <div class="pick-row"><span>roadside handle</span><strong>${handle.handle}</strong></div>
          <div class="pick-row"><span>spline</span><strong>${handle.splineId}</strong></div>
        `;
        return;
      }
      const rail = trackView.pickKerbRail(point.x, point.y);
      if (rail && rail.splineId) {
        canvas.style.cursor = "crosshair";
        context.elements.pickInfo.innerHTML = `
          <div class="pick-row"><span>roadside spline</span><strong>${rail.splineId}</strong></div>
          <div class="pick-row"><span>offset</span><strong>${(rail.offset ?? 0).toFixed(1)} m</strong></div>
        `;
        return;
      }
      canvas.style.cursor = "default";
      context.elements.pickInfo.textContent =
        "Select a spline, choose a feature type, then drag a spline rail to paint.";
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
        context.elements.pickInfo.innerHTML = `
          <div class="pick-row"><span>terrain point</span><strong>${hoverTerrainPoint}</strong></div>
          <div class="pick-row"><span>x / z</span><strong>${context.formatNumber(
            terrainPoint.position[0],
          )} / ${context.formatNumber(terrainPoint.position[1])}</strong></div>
          <div class="pick-row"><span>height</span><strong>${context.formatNumber(
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
        context.elements.pickInfo.innerHTML = `
          <div class="pick-row"><span>centreline</span><strong>${centerline.id}</strong></div>
          <div class="pick-row"><span>point</span><strong>${controlPoint.pointIndex}</strong></div>
          <div class="pick-row"><span>x / z</span><strong>${context.formatNumber(position[0])} / ${context.formatNumber(
            position[1],
          )}</strong></div>
        `;
      }
      return;
    }

    canvas.style.cursor = context.getAddTerrainPointMode() ? "crosshair" : "default";
    const pick = trackView.pick(point.x, point.y);
    if (!pick) {
      context.elements.pickInfo.textContent = "Hover a surface triangle.";
      return;
    }
    context.elements.pickInfo.innerHTML = `
      <div class="pick-row"><span>triangle</span><strong>${pick.triangle}</strong></div>
      <div class="pick-row"><span>surface</span><strong>${pick.surfaceName} (${pick.surfaceId})</strong></div>
      <div class="pick-row"><span>area</span><strong>${context.formatNumber(pick.area)} m²</strong></div>
    `;
  });

  const finishDrag = (event: PointerEvent): void => {
    const activeDrag: DragState = context.getDrag();
    if (!activeDrag) {
      return;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    trackView.setControlsEnabled(true);
    trackView.setJoinTarget(null);
    canvas.style.cursor = "default";
    const currentDrag = activeDrag;
    context.setDrag(null);
    if (context.getProject()) {
      context.flushPendingRender();
    }

    if (currentDrag.kind === "roadside-paint") {
      const project = context.getProject();
      if (project) {
        const painted = paintSpan(currentDrag);
        if (!painted) {
          context.scheduleOverlayUpdate();
          context.updateAuthoringUI();
          return;
        }
        const located = context.findRoadsideSpline(
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
          context.setRoadsideStatus(
            "The run must stay within this open section.",
            "error",
          );
          context.scheduleOverlayUpdate();
          return;
        }
        if (
          context.roadsideRunOverlaps(
            located.spline,
            painted.start,
            painted.length,
            located.section.closed,
            currentDrag.runKind,
          )
        ) {
          context.setRoadsideStatus(
            "Runs on one roadside spline cannot overlap.",
            "error",
          );
          context.scheduleOverlayUpdate();
          return;
        }
        const run =
          currentDrag.runKind === "kerb"
            ? { kind: "kerb" as const, start: painted.start, length: painted.length }
            : currentDrag.runKind === "wall"
              ? { kind: "wall" as const, start: painted.start, length: painted.length }
              : {
                  kind: currentDrag.runKind,
                  start: painted.start,
                  length: painted.length,
                };
        const before = currentDrag.startProject;
        located.spline.runs.push(run);
        located.spline.runs.sort((a, b) => a.start - b.start);
        context.setSelectedRoadsideSpline({
          sectionId: located.section.id,
          splineId: located.spline.id,
        });
        context.setSelectedRoadsideRun({
          sectionId: located.section.id,
          splineId: located.spline.id,
          runIndex: located.spline.runs.indexOf(run),
        });
        if (!context.renderProject(project, { frame: false })) {
          context.setProject(before);
          context.setSelectedRoadsideRun(null);
          context.renderProject(before, { frame: false });
          context.setRoadsideStatus("The painted run does not bake.", "error");
          context.scheduleOverlayUpdate();
          return;
        }
        context.pushUndo(before);
        context.setRoadsideStatus("Painted roadside run.", "ok");
        context.scheduleOverlayUpdate();
        context.updateAuthoringUI();
        return;
      }
    }

    if (
      currentDrag.kind === "roadside-entry" ||
      currentDrag.kind === "roadside-exit"
    ) {
      const project = context.getProject();
      if (project && !context.isBakeValid()) {
        context.setProject(currentDrag.startProject);
        context.renderProject(currentDrag.startProject, { frame: false });
        context.setRoadsideStatus(
          "Run resize rejected: the track would become invalid.",
          "error",
        );
      } else if (
        project &&
        JSON.stringify(currentDrag.startProject) !== JSON.stringify(project)
      ) {
        context.pushUndo(currentDrag.startProject);
      }
      context.scheduleOverlayUpdate();
      context.updateAuthoringUI();
      return;
    }

    if (currentDrag.kind === "point") {
      const project = context.getProject();
      if (project) {
        const branch = project.centerlines[currentDrag.centerlineIndex];
        if (
          branch &&
          !branch.closed &&
          currentDrag.pointIndex === branch.points.length - 1
        ) {
          const position = branch.points[currentDrag.pointIndex]!;
          const target = context.findJoinTarget(
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
                isLooseSectionEnd(
                  project,
                  targetCenterline.id,
                  target.pointIndex,
                );
              const error = isLoopClose
                ? context.applySectionLoopClose(
                    project,
                    branch,
                    target,
                    currentDrag.pointIndex,
                  )
                : isMergeTarget
                  ? context.applySectionEndMerge(
                      project,
                      branch,
                      target,
                      currentDrag.pointIndex,
                    )
                  : context.applySectionJunction(
                      project,
                      branch,
                      target,
                      currentDrag.pointIndex,
                    );
              if (error === null) {
                context.pushUndo(currentDrag.startProject);
              } else {
                context.setProject(currentDrag.startProject);
                context.renderProject(currentDrag.startProject, { frame: false });
                context.setEditStatus(error, "error");
              }
            } else if (targetCenterline?.closed) {
              if (context.applyBranchEndJoin(project, branch, target)) {
                context.pushUndo(currentDrag.startProject);
              } else {
                context.setProject(currentDrag.startProject);
                context.renderProject(currentDrag.startProject, { frame: false });
                context.setEditStatus(
                  "Could not join the loose end there; adjust the branch points so it does not cross the road.",
                  "error",
                );
              }
            } else {
              const error = context.applyBranchEndMerge(project, branch, target);
              if (error === null) {
                context.pushUndo(currentDrag.startProject);
              } else {
                context.setProject(currentDrag.startProject);
                context.renderProject(currentDrag.startProject, { frame: false });
                context.setEditStatus(error, "error");
              }
            }
            context.updateAuthoringUI();
            return;
          }
        }
      }
    }

    if (currentDrag.kind === "point") {
      const project = context.getProject();
      if (project && !context.isBakeValid()) {
        context.setProject(currentDrag.startProject);
        context.renderProject(currentDrag.startProject, { frame: false });
        context.setEditStatus(
          "Point move rejected: the track would become invalid.",
          "error",
        );
        context.updateAuthoringUI();
        return;
      }
    }

    const project = context.getProject();
    if (
      project &&
      JSON.stringify(currentDrag.startProject) !== JSON.stringify(project)
    ) {
      context.pushUndo(currentDrag.startProject);
    }
    context.updateAuthoringUI();
  };

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!context.getDrag()) {
      context.elements.pickInfo.textContent = "Hover a surface triangle.";
    }
  });

  canvas.addEventListener("dblclick", (event) => {
    const project = context.getProject();
    if (!project || context.getEditorMode() !== "track") {
      return;
    }
    const point = pointerNdc(event, canvas);
    const hit = trackView.pickCenterlineSegment(point.x, point.y);
    if (!hit) {
      if (trackView.focusAt(point.x, point.y)) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    context.insertPoint(hit);
  });
}
