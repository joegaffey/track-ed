import type { Project } from "../kernel/project";

export type BranchMergeResult =
  | { ok: true; project: Project }
  | { ok: false; message: string };

function nextPointId(used: ReadonlySet<string>, branchId: string): string {
  let index = 1;
  let id = `${branchId}-p${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${branchId}-p${index}`;
  }
  return id;
}

export function mergeLooseBranchEnds(
  source: Project,
  branchAId: string,
  branchBId: string,
): BranchMergeResult {
  if (source.schema !== "track-ed/project@2") {
    return { ok: false, message: "Branch merging requires track-ed/project@2." };
  }
  if (branchAId === branchBId) {
    return { ok: false, message: "Select two different branches to merge." };
  }

  const project = structuredClone(source);
  const branchA = project.centerlines.find((centerline) => centerline.id === branchAId);
  const branchB = project.centerlines.find((centerline) => centerline.id === branchBId);
  if (!branchA || !branchB) {
    return { ok: false, message: "The branch to merge no longer exists." };
  }
  if (branchA.closed || branchB.closed) {
    return { ok: false, message: "Only open branches can be merged." };
  }
  if (branchA.points.length < 2 || branchB.points.length < 2) {
    return { ok: false, message: "Both branches need at least two control points." };
  }
  if (branchA.endAttach) {
    return { ok: false, message: "Detach the dragged branch end before merging." };
  }
  if (branchB.endAttach) {
    return { ok: false, message: "The target branch end is attached; detach it first." };
  }
  if (!branchA.attach || !("junction" in branchA.attach)) {
    return { ok: false, message: "The dragged branch must be attached to the main loop." };
  }
  if (!branchB.attach || !("junction" in branchB.attach)) {
    return { ok: false, message: "The target branch must be attached to the main loop." };
  }
  if (branchA.attach.junction === branchB.attach.junction) {
    return {
      ok: false,
      message: "The merged branch would start and end at the same junction.",
    };
  }

  const points = branchA.points.map((point) => [point[0], point[1]] as [number, number]);
  const pointIds = [...branchA.pointIds];
  const targetEnd = branchB.points[branchB.points.length - 1]!;
  points[points.length - 1] = [targetEnd[0], targetEnd[1]];

  const used = new Set(pointIds);
  for (let index = branchB.points.length - 2; index >= 0; index -= 1) {
    const point = branchB.points[index]!;
    let id = branchB.pointIds[index]!;
    if (index === 0) {
      if (used.has(id)) {
        return {
          ok: false,
          message: "The branch endpoint id collides with the merged branch.",
        };
      }
    } else if (used.has(id)) {
      id = nextPointId(used, branchA.id);
    }
    used.add(id);
    points.push([point[0], point[1]]);
    pointIds.push(id);
  }

  branchA.points = points;
  branchA.pointIds = pointIds;
  branchA.endAttach = { junction: branchB.attach.junction };
  if (!branchA.spline && branchB.spline) {
    branchA.spline = branchB.spline;
  }

  project.centerlines = project.centerlines.filter(
    (centerline) => centerline.id !== branchB.id,
  );

  if (project.spawn.centerline === branchB.id) {
    const main = project.centerlines.find((centerline) => centerline.closed);
    if (!main) {
      return { ok: false, message: "The project has no closed main loop." };
    }
    project.spawn.centerline = main.id;
  }

  return { ok: true, project };
}
