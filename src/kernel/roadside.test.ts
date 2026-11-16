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
      expect(run.offset.reference).toBe("asphalt-edge");
      expect(run.offset.distance).toBeCloseTo(KERB_WIDTH / 2, 9);
      expect(run.junctionPolicy).toBe("clip");
      expect(run.legs).toHaveLength(1);
      expect(run.profile.kind).toBe("kerb");
    }
  });
});
