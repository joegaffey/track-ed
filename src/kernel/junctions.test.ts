import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/projects/loop-spline-terrain-junctions.json";
import { parseProject, type Project } from "./project";
import { bakeProject } from "./bake";
import { validateBakedTrack } from "./validate-baked";
import { fractionAtControlPoint, sampleCenterline } from "./spline";
import { samplePolyline, type Vec2 } from "./geometry";
import { add2, leftNormal, normalize2, scale2, signedArea2 } from "./math2";

function addBranch(
  project: Project,
  hostPointIndex: number,
  branchId: string,
  angleOffset: number,
): void {
  const main = project.centerlines.find((centerline) => centerline.closed)!;
  const pointId = main.pointIds[hostPointIndex]!;
  let junction = project.junctions.find(
    (candidate) => candidate.centerline === main.id && candidate.point === pointId,
  );
  if (!junction) {
    junction = {
      id: `junction-${project.junctions.length + 1}`,
      centerline: main.id,
      point: pointId,
    };
    project.junctions.push(junction);
  }

  const fraction = fractionAtControlPoint(
    main.points as Vec2[],
    true,
    main.spline,
    hostPointIndex,
  )!;
  const sampled = sampleCenterline(main.points as Vec2[], true, main.spline);
  const host = samplePolyline(sampled, true, fraction);
  const side = signedArea2(sampled) > 0 ? -1 : 1;
  const outward = scale2(leftNormal(host.tangent), side);
  const cosine = Math.cos(angleOffset);
  const sine = Math.sin(angleOffset);
  const direction = normalize2(
    add2(scale2(host.tangent, sine), scale2(outward, cosine)),
  );
  const p1 = add2(host.position, scale2(direction, 30));
  const p2 = add2(host.position, scale2(direction, 60));

  project.centerlines.push({
    id: branchId,
    closed: false,
    spline: { type: "catmull-rom", samplesPerSegment: 12 },
    attach: { junction: junction.id },
    points: [
      [host.position[0], host.position[1]],
      [p1[0], p1[1]],
      [p2[0], p2[1]],
    ],
    pointIds: [junction.point, `${branchId}-p1`, `${branchId}-p2`],
  });
}

function projectFixture(): Project {
  const parsed = parseProject(fixture);
  expect(parsed.issues).toEqual([]);
  return structuredClone(parsed.project!);
}

describe("project@2 junctions", () => {
  it("bakes two junctions at different host points", () => {
    const project = projectFixture();
    addBranch(project, 1, "branch-a", 0);
    addBranch(project, 4, "branch-b", 0);

    expect(project.junctions).toHaveLength(2);
    const track = bakeProject(project);
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
  });

  it("bakes two branches at the same junction", () => {
    const project = projectFixture();
    addBranch(project, 1, "branch-a", Math.PI / 6);
    addBranch(project, 1, "branch-b", -Math.PI / 6);

    expect(project.junctions).toHaveLength(1);
    const track = bakeProject(project);
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
  });
});

describe("branch end joining", () => {
  it("connects a branch between two host junctions", () => {
    const project = projectFixture();
    const main = project.centerlines.find((centerline) => centerline.closed)!;
    project.junctions.push(
      { id: "junction-start", centerline: main.id, point: "p1" },
      { id: "junction-end", centerline: main.id, point: "p4" },
    );
    project.centerlines.push({
      id: "connector",
      closed: false,
      spline: { type: "catmull-rom", samplesPerSegment: 12 },
      attach: { junction: "junction-start" },
      endAttach: { junction: "junction-end" },
      points: [
        [80, 0],
        [55, 20],
        [0, 80],
      ],
      pointIds: ["p1", "connector-p1", "p4"],
    });

    const track = bakeProject(project);
    const report = validateBakedTrack(track);
    expect(report.ok).toBe(true);
    expect(report.topology.interiorBoundaryEdges).toHaveLength(0);
    expect(report.topology.nonManifoldEdges).toHaveLength(0);
    expect(report.topology.tJunctions).toHaveLength(0);
    expect(report.topology.overlapPairs).toHaveLength(0);
  });
});
