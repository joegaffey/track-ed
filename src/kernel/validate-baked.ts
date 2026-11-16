import type { BakedTrack, Vec3 } from "../model/baked-track";
import { WELD_EPSILON } from "./constants";
import { analyzeSurfaceGraph, type TopologyReport } from "./topology";

export type ViolationSeverity = "error" | "warning";

export interface ValidationViolation {
  rule: string;
  severity: ViolationSeverity;
  message: string;
  triangle?: number;
  edge?: [number, number];
}

export interface ValidationReport {
  ok: boolean;
  violations: ValidationViolation[];
  topology: TopologyReport;
  kerbTopology?: TopologyReport;
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Number.isFinite(value[2])
  );
}

function isFiniteQuat(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Number.isFinite(value[2]) &&
    Number.isFinite(value[3])
  );
}

function addError(
  violations: ValidationViolation[],
  rule: string,
  message: string,
  geometry?: Pick<ValidationViolation, "triangle" | "edge">,
): void {
  violations.push({ rule, severity: "error", message, ...geometry });
}

function addWarning(
  violations: ValidationViolation[],
  rule: string,
  message: string,
  geometry?: Pick<ValidationViolation, "triangle" | "edge">,
): void {
  violations.push({ rule, severity: "warning", message, ...geometry });
}

export function validateBakedTrack(track: BakedTrack): ValidationReport {
  const violations: ValidationViolation[] = [];
  const graph = track.surfaceGraph;

  if (track.kind !== "track") {
    addError(violations, "BM1", 'track.kind must be "track"');
  }
  if (typeof track.name !== "string" || track.name.length === 0) {
    addError(violations, "BM1", "track.name must be a non-empty string");
  }
  if (!Number.isFinite(track.length) || track.length < 0) {
    addError(violations, "BM6", "track.length must be a finite, non-negative number");
  }

  const graphs: Array<{ name: string; graph: typeof graph }> = [
    { name: "surface", graph },
  ];
  if (track.kerbGraph) {
    graphs.push({ name: "kerb", graph: track.kerbGraph });
  }

  for (const entry of graphs) {
    const graphPositions = entry.graph.positions;
    const graphIndices = entry.graph.indices;
    for (let i = 0; i < graphPositions.length; i += 1) {
      const position = graphPositions[i];
      if (!isFiniteVec3(position)) {
        addError(violations, "BM2", `${entry.name} position ${i} must be a finite vec3`);
        continue;
      }
    }
    if (graphIndices.length % 3 !== 0) {
      addError(violations, "BM2", `${entry.name} indices must contain whole triangles`);
    }
    for (let i = 0; i < graphIndices.length; i += 1) {
      const index = graphIndices[i];
      if (
        !Number.isInteger(index) ||
        index === undefined ||
        index < 0 ||
        index >= graphPositions.length
      ) {
        addError(violations, "BM2", `${entry.name} index ${i} is outside the position range`);
        break;
      }
    }
    if (entry.graph.triangleSurfaces.length !== graphIndices.length / 3) {
      addError(
        violations,
        "BM3",
        `${entry.name} triangleSurfaces length must equal the number of triangles`,
      );
    }
  }

  const surfaceIds = new Set<number>();
  const surfaceNames = new Set<string>();
  for (const surface of track.surfaces) {
    if (!Number.isInteger(surface.id) || surface.id < 0) {
      addError(violations, "BM4", "surface ids must be non-negative integers");
    }
    if (surfaceIds.has(surface.id)) {
      addError(violations, "BM4", `duplicate surface id ${surface.id}`);
    }
    surfaceIds.add(surface.id);
    if (surface.name.length === 0) {
      addError(violations, "BM4", `surface ${surface.id} has an empty name`);
    }
    if (surfaceNames.has(surface.name)) {
      addError(violations, "BM4", `duplicate surface name "${surface.name}"`);
    }
    surfaceNames.add(surface.name);
    if (!Number.isFinite(surface.friction) || !Number.isFinite(surface.roughness)) {
      addError(violations, "BM4", `surface "${surface.name}" has non-finite properties`);
    }
  }

  for (const entry of graphs) {
    for (let triangle = 0; triangle < entry.graph.triangleSurfaces.length; triangle += 1) {
      const surfaceId = entry.graph.triangleSurfaces[triangle];
      if (surfaceId === undefined || !surfaceIds.has(surfaceId)) {
        addError(
          violations,
          "BM3",
          `${entry.name} triangle ${triangle} references an undeclared surface`,
          { triangle },
        );
        break;
      }
    }
  }

  if (
    !isFiniteVec3(track.bounds.min) ||
    !isFiniteVec3(track.bounds.max) ||
    track.bounds.min[0] > track.bounds.max[0] ||
    track.bounds.min[1] > track.bounds.max[1] ||
    track.bounds.min[2] > track.bounds.max[2]
  ) {
    addError(violations, "BM5", "bounds must be finite and ordered");
  } else {
    for (const entry of graphs) {
      for (let i = 0; i < entry.graph.positions.length; i += 1) {
        const position = entry.graph.positions[i];
        if (!isFiniteVec3(position)) {
          continue;
        }
        if (
          position[0] < track.bounds.min[0] - WELD_EPSILON ||
          position[0] > track.bounds.max[0] + WELD_EPSILON ||
          position[1] < track.bounds.min[1] - WELD_EPSILON ||
          position[1] > track.bounds.max[1] + WELD_EPSILON ||
          position[2] < track.bounds.min[2] - WELD_EPSILON ||
          position[2] > track.bounds.max[2] + WELD_EPSILON
        ) {
          addError(
            violations,
            "BM5",
            `bounds do not enclose ${entry.name} position ${i}`,
          );
          break;
        }
      }
    }
  }

  if (track.spawns.length === 0) {
    addError(violations, "BM7", "at least one spawn is required");
  }
  for (const spawn of track.spawns) {
    if (!isFiniteVec3(spawn.position)) {
      addError(violations, "BM7", `spawn "${spawn.name}" has an invalid position`);
    }
    if (!isFiniteQuat(spawn.rotation)) {
      addError(violations, "BM7", `spawn "${spawn.name}" has an invalid rotation`);
    } else {
      const [x, y, z, w] = spawn.rotation;
      const norm = Math.hypot(x, y, z, w);
      if (Math.abs(norm - 1) > 1e-6) {
        addError(violations, "BM7", `spawn "${spawn.name}" rotation is not normalized`);
      }
    }
  }

  for (const camera of track.cameras) {
    if (!isFiniteVec3(camera.position) || !isFiniteVec3(camera.target)) {
      addError(violations, "BM8", `camera "${camera.name}" has an invalid position or target`);
    }
    if (!Number.isFinite(camera.fovY) || camera.fovY <= 0) {
      addError(violations, "BM8", `camera "${camera.name}" has an invalid fovY`);
    }
  }

  const topology = analyzeSurfaceGraph(graph, track.bounds);

  if (topology.interiorBoundaryEdges.length > 0) {
    const edge = topology.interiorBoundaryEdges[0]!;
    addError(
      violations,
      "G6",
      `${topology.interiorBoundaryEdges.length} interior boundary edge(s); boundary edges are permitted only on the outer perimeter`,
      { edge: [edge.a, edge.b] },
    );
  }
  if (topology.nonManifoldEdges.length > 0) {
    const edge = topology.nonManifoldEdges[0]!;
    addError(
      violations,
      "G6",
      `${topology.nonManifoldEdges.length} non-manifold edge(s) with more than two adjacent triangles`,
      { edge: [edge.a, edge.b] },
    );
  }
  if (topology.tJunctions.length > 0) {
    addError(
      violations,
      "G7",
      `${topology.tJunctions.length} T-junction(s) detected`,
      { edge: [topology.tJunctions[0]!.edgeA, topology.tJunctions[0]!.edgeB] },
    );
  }
  if (topology.degenerateTriangles.length > 0) {
    addError(
      violations,
      "G9",
      `${topology.degenerateTriangles.length} degenerate triangle(s)`,
      { triangle: topology.degenerateTriangles[0]! },
    );
  }
  if (topology.badWindingTriangles.length > 0) {
    addError(
      violations,
      "G9",
      `${topology.badWindingTriangles.length} triangle(s) with winding that does not face +Y`,
      { triangle: topology.badWindingTriangles[0]! },
    );
  }
  if (topology.overlapPairs.length > 0) {
    addError(
      violations,
      "G3",
      `${topology.overlapPairs.length} overlapping triangle pair(s)`,
      { triangle: topology.overlapPairs[0]![0] },
    );
  }
  if (topology.duplicateTriangles.length > 0) {
    addError(
      violations,
      "G3",
      `${topology.duplicateTriangles.length} duplicate triangle pair(s)`,
      { triangle: topology.duplicateTriangles[0]![0] },
    );
  }

  const kerbTopology = track.kerbGraph
    ? analyzeSurfaceGraph(track.kerbGraph, track.bounds)
    : undefined;
  const validateKerbTopology = (
    source: TopologyReport | undefined,
    label: string,
  ): void => {
    if (!source) {
      return;
    }
    if (source.degenerateTriangles.length > 0) {
      addError(
        violations,
        "K1",
        `${source.degenerateTriangles.length} degenerate ${label} triangle(s)`,
        { triangle: source.degenerateTriangles[0]! },
      );
    }
    if (source.duplicateTriangles.length > 0) {
      addError(
        violations,
        "K1",
        `${source.duplicateTriangles.length} duplicate ${label} triangle pair(s)`,
        { triangle: source.duplicateTriangles[0]![0] },
      );
    }
    if (source.tJunctions.length > 0) {
      addError(
        violations,
        "K2",
        `${source.tJunctions.length} ${label} T-junction(s) detected`,
        { edge: [source.tJunctions[0]!.edgeA, source.tJunctions[0]!.edgeB] },
      );
    }
  };
  validateKerbTopology(kerbTopology, "kerb");

  const coveredSurfaces = new Set(topology.surfaceTriangleCounts.map(([id]) => id));
  for (const [id] of kerbTopology?.surfaceTriangleCounts ?? []) {
    coveredSurfaces.add(id);
  }
  for (const surface of track.surfaces) {
    if (!coveredSurfaces.has(surface.id)) {
      addWarning(violations, "G10", `declared surface "${surface.name}" has no triangles`);
    }
  }

  return {
    ok: violations.every((violation) => violation.severity !== "error"),
    violations,
    topology,
    ...(kerbTopology ? { kerbTopology } : {}),
  };
}
