import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/projects/loop-spline-terrain-junctions.json";
import { bakeProject } from "../kernel/bake";
import { parseProject, type Project } from "../kernel/project";
import { validateBakedTrack } from "../kernel/validate-baked";
import { mergeLooseBranchEnds } from "./branch-merge";

function projectFixture(): Project {
  const parsed = parseProject(fixture);
  if (!parsed.project) {
    throw new Error(parsed.issues.map((issue) => issue.message).join("; "));
  }
  return structuredClone(parsed.project);
}

function withTwoLooseBranches(): Project {
  const project = projectFixture();
  project.junctions.push(
    { id: "junction-a", centerline: "main", point: "p1" },
    { id: "junction-b", centerline: "main", point: "p4" },
  );
  project.centerlines.push(
    {
      id: "branch-a",
      closed: false,
      attach: { junction: "junction-a" },
      spline: { type: "catmull-rom", samplesPerSegment: 12 },
      points: [
        [80, 0],
        [55, 20],
        [35, 35],
      ],
      pointIds: ["p1", "a1", "a2"],
    },
    {
      id: "branch-b",
      closed: false,
      attach: { junction: "junction-b" },
      spline: { type: "catmull-rom", samplesPerSegment: 12 },
      points: [
        [0, 80],
        [20, 55],
        [40, 45],
      ],
      pointIds: ["p4", "b1", "b2"],
    },
  );
  return project;
}

describe("mergeLooseBranchEnds", () => {
  it("merges two loose branch ends into one road section", () => {
    const result = mergeLooseBranchEnds(
      withTwoLooseBranches(),
      "branch-a",
      "branch-b",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const branches = result.project.centerlines.filter((centerline) => !centerline.closed);
    expect(branches).toHaveLength(1);
    const merged = branches[0]!;
    expect(merged.id).toBe("branch-a");
    expect(merged.points).toEqual([
      [80, 0],
      [55, 20],
      [40, 45],
      [20, 55],
      [0, 80],
    ]);
    expect(merged.pointIds).toEqual(["p1", "a1", "a2", "b1", "p4"]);
    expect(merged.attach).toEqual({ junction: "junction-a" });
    expect(merged.endAttach).toEqual({ junction: "junction-b" });

    const report = validateBakedTrack(bakeProject(result.project));
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
  });

  it("rejects branches attached to the same junction", () => {
    const project = withTwoLooseBranches();
    const branchB = project.centerlines.find((centerline) => centerline.id === "branch-b")!;
    branchB.attach = { junction: "junction-a" };
    branchB.pointIds[0] = "p1";

    const result = mergeLooseBranchEnds(project, "branch-a", "branch-b");
    expect(result).toEqual({
      ok: false,
      message: "The merged branch would start and end at the same junction.",
    });
  });

  it("rejects an attached target end", () => {
    const project = withTwoLooseBranches();
    project.centerlines.find((centerline) => centerline.id === "branch-b")!.endAttach = {
      junction: "junction-b",
    };

    const result = mergeLooseBranchEnds(project, "branch-a", "branch-b");
    expect(result).toEqual({
      ok: false,
      message: "The target branch end is attached; detach it first.",
    });
  });

  it("renews colliding point ids from the merged branch", () => {
    const project = withTwoLooseBranches();
    project.centerlines.find((centerline) => centerline.id === "branch-b")!.pointIds[1] =
      "a1";

    const result = mergeLooseBranchEnds(project, "branch-a", "branch-b");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const merged = result.project.centerlines.find(
      (centerline) => centerline.id === "branch-a",
    )!;
    expect(new Set(merged.pointIds).size).toBe(merged.pointIds.length);
    expect(merged.pointIds).toEqual(["p1", "a1", "a2", "branch-a-p1", "p4"]);
  });

  it("moves a spawn on the removed branch back to the main loop", () => {
    const project = withTwoLooseBranches();
    project.spawn.centerline = "branch-b";

    const result = mergeLooseBranchEnds(project, "branch-a", "branch-b");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.project.spawn.centerline).toBe("main");
  });
});
