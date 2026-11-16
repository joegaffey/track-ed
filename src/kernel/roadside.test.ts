import { describe, expect, it } from "vitest";
import venueFixture from "../../fixtures/projects/venue-loop-spur-junction.json";
import { parseProject } from "./project";
import { KERB_WIDTH, roadsideRunsFromProject } from "./roadside";

describe("roadside runs", () => {
  it("projects authored kerbs into surface runs", () => {
    const project = parseProject(structuredClone(venueFixture)).project!;
    const runs = roadsideRunsFromProject(project);
    expect(runs.length).toBe(4);
    for (const run of runs) {
      expect(run.kind).toBe("kerb");
      expect(run.mechanism).toBe("surface");
      expect(run.offset).toBeCloseTo(project.road.halfWidth, 9);
      expect(run.legs).toHaveLength(1);
      if (!("profile" in run)) {
        throw new Error("expected a surface run");
      }
      expect(run.profile.kind).toBe("kerb");
    }
  });
});
