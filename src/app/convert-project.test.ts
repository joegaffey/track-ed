import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop-spline-terrain-junctions.json";
import legacyFixture from "../../fixtures/projects/loop.json";
import { bakeProject } from "../kernel/bake";
import { parseProject, type Project } from "../kernel/project";
import { validateBakedTrack } from "../kernel/validate-baked";
import { convertProjectToLatest } from "./convert-project";

function parsed(value: unknown): Project {
  const result = parseProject(value);
  if (!result.project) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.project;
}

describe("convertProjectToLatest", () => {
  it("converts a project@2 loop to a venue section", () => {
    const result = convertProjectToLatest(parsed(loopFixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.schema).toBe("track-ed/project@5");
    expect(result.project.centerlines).toHaveLength(1);
    expect(result.project.junctions).toEqual([]);
    expect(
      (result.project.centerlines[0]?.roadside ?? []).map((spline) => spline.role),
    ).toEqual(["kerb-left", "kerb-right"]);
    expect(validateBakedTrack(bakeProject(result.project)).ok).toBe(true);
  });

  it("converts branch attachments into junction members", () => {
    const project = parsed(loopFixture);
    project.junctions.push(
      { id: "junction-1", centerline: "section-1", point: "p1" },
      { id: "junction-2", centerline: "section-1", point: "p4" },
    );
    project.centerlines.push({
      id: "connector",
      closed: false,
      attach: { junction: "junction-1" },
      endAttach: { junction: "junction-2" },
      points: [
        [80, 0],
        [55, 20],
        [0, 80],
      ],
      pointIds: ["p1", "connector-p1", "p4"],
    });

    const result = convertProjectToLatest(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const junction1 = result.project.junctions.find(
      (junction) => junction.id === "junction-1",
    )!;
    const junction2 = result.project.junctions.find(
      (junction) => junction.id === "junction-2",
    )!;
    expect(junction1.members).toEqual([
      { section: "section-1", point: "p1" },
      { section: "connector", point: "p1" },
    ]);
    expect(junction2.members).toEqual([
      { section: "section-1", point: "p4" },
      { section: "connector", point: "p4" },
    ]);
    expect(result.project.centerlines.find((section) => section.id === "connector")?.attach)
      .toBeUndefined();
  });

  it("migrates project@4 kerbs, walls, and props into roadside splines", () => {
    const project = parsed({
      schema: "track-ed/project@4",
      name: "Migrate roadside",
      generator: "track-ed test",
      road: { halfWidth: 5, shoulderHalfWidth: 8 },
      terrain: { margin: 20, mode: "conform" },
      spawn: { centerline: "road", fraction: 0.2, lateral: 0 },
      cameras: [],
      sections: [
        {
          id: "road",
          closed: false,
          points: [
            { id: "p0", position: [0, 0] },
            { id: "p1", position: [100, 0] },
          ],
          kerbs: [{ side: "left", start: 0.1, length: 0.1 }],
          walls: [{ side: "right", start: 0.2, length: 0.1, offset: 2 }],
          props: [
            { kind: "block", side: "left", start: 0.3, length: 0.1, offset: 4 },
          ],
        },
      ],
    });
    const result = convertProjectToLatest(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roadside = result.project.centerlines[0]!.roadside!;
    expect(result.project.schema).toBe("track-ed/project@5");
    expect(roadside.map((spline) => spline.offset)).toEqual([5, 5, 9, 7]);
    expect(roadside.flatMap((spline) => spline.runs.map((run) => run.kind))).toEqual([
      "kerb",
      "block",
      "wall",
    ]);
  });

  it("leaves project@1 import-only", () => {
    const result = convertProjectToLatest(parsed(legacyFixture));
    expect(result.ok).toBe(false);
  });
});
