import { describe, expect, it } from "vitest";
import loopFixture from "../../fixtures/projects/loop-spline-terrain-junctions.json";
import legacyFixture from "../../fixtures/projects/loop.json";
import { bakeProject } from "../kernel/bake";
import { parseProject, type Project } from "../kernel/project";
import { validateBakedTrack } from "../kernel/validate-baked";
import { convertProjectToV3 } from "./convert-project";

function parsed(value: unknown): Project {
  const result = parseProject(value);
  if (!result.project) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.project;
}

describe("convertProjectToV3", () => {
  it("converts a project@2 loop to a venue section", () => {
    const result = convertProjectToV3(parsed(loopFixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.schema).toBe("track-ed/project@3");
    expect(result.project.centerlines).toHaveLength(1);
    expect(result.project.junctions).toEqual([]);
    expect(validateBakedTrack(bakeProject(result.project)).ok).toBe(true);
  });

  it("converts branch attachments into junction members", () => {
    const project = parsed(loopFixture);
    project.junctions.push(
      { id: "junction-1", centerline: "main", point: "p1" },
      { id: "junction-2", centerline: "main", point: "p4" },
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

    const result = convertProjectToV3(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const junction1 = result.project.junctions.find(
      (junction) => junction.id === "junction-1",
    )!;
    const junction2 = result.project.junctions.find(
      (junction) => junction.id === "junction-2",
    )!;
    expect(junction1.members).toEqual([
      { section: "main", point: "p1" },
      { section: "connector", point: "p1" },
    ]);
    expect(junction2.members).toEqual([
      { section: "main", point: "p4" },
      { section: "connector", point: "p4" },
    ]);
    expect(result.project.centerlines.find((section) => section.id === "connector")?.attach)
      .toBeUndefined();
  });

  it("leaves project@1 import-only", () => {
    const result = convertProjectToV3(parsed(legacyFixture));
    expect(result.ok).toBe(false);
  });
});
