import * as THREE from "three";
import type { BakedTrack, Surface, Vec3 } from "../../model/baked-track";
import type { EdgeInfo, TopologyReport } from "../../kernel/topology";
import type { SceneState } from "./types";

export const SURFACE_COLORS: Record<string, number> = {
  kerb_red: 0xb32424,
  kerb_white: 0xededed,
  wall: 0x7b8087,
  asphalt: 0x4b5563,
  dirt: 0x8b5e3c,
  grass: 0x2f6b3a,
};

export function colorForSurface(surface: Surface): number {
  return SURFACE_COLORS[surface.name] ?? 0xb0b8c4;
}

export function edgePositions(
  edges: readonly EdgeInfo[],
  positions: readonly Vec3[],
): Float32Array {
  const data = new Float32Array(edges.length * 6);
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i]!;
    const a = positions[edge.a]!;
    const b = positions[edge.b]!;
    data[i * 6] = a[0];
    data[i * 6 + 1] = a[1] + 0.02;
    data[i * 6 + 2] = a[2];
    data[i * 6 + 3] = b[0];
    data[i * 6 + 4] = b[1] + 0.02;
    data[i * 6 + 5] = b[2];
  }
  return data;
}

export function buildEdgeLines(
  edges: readonly EdgeInfo[],
  positions: readonly Vec3[],
  color: number,
  opacity: number,
  depthTest: boolean,
): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(edgePositions(edges, positions), 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest,
    depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

export function buildSurfaceMeshes(state: SceneState): void {
  const { track, content } = state;
  const surfaces = [...track.surfaces].sort((a, b) => a.id - b.id);
  const materialIndexById = new Map(surfaces.map((surface, index) => [surface.id, index]));
  const materials = surfaces.map(
    (surface) =>
      new THREE.MeshStandardMaterial({
        color: colorForSurface(surface),
        roughness: surface.roughness,
        metalness: 0,
        side: THREE.FrontSide,
      }),
  );

  const buildGraphMesh = (
    graph: NonNullable<BakedTrack["surfaceGraph"]>,
    name: string,
  ): THREE.Mesh => {
    const geometry = new THREE.BufferGeometry();
    const positionData = new Float32Array(graph.positions.length * 3);
    for (let i = 0; i < graph.positions.length; i += 1) {
      const position = graph.positions[i]!;
      positionData[i * 3] = position[0];
      positionData[i * 3 + 1] = position[1];
      positionData[i * 3 + 2] = position[2];
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positionData, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(graph.indices), 1));
    geometry.computeVertexNormals();

    const triangleCount = graph.triangleSurfaces.length;
    let runStart = 0;
    while (runStart < triangleCount) {
      const surfaceId = graph.triangleSurfaces[runStart]!;
      let runEnd = runStart + 1;
      while (runEnd < triangleCount && graph.triangleSurfaces[runEnd] === surfaceId) {
        runEnd += 1;
      }
      const materialIndex = materialIndexById.get(surfaceId);
      if (materialIndex !== undefined) {
        geometry.addGroup(runStart * 3, (runEnd - runStart) * 3, materialIndex);
      }
      runStart = runEnd;
    }
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = name;
    content.add(mesh);
    return mesh;
  };

  state.surfaceMesh = buildGraphMesh(track.surfaceGraph, "track-surfaces");
  if (track.kerbGraph) {
    state.kerbMesh = buildGraphMesh(track.kerbGraph, "track-kerbs");
  }
  if (track.wallGraph) {
    state.wallMesh = buildGraphMesh(track.wallGraph, "track-walls");
  }

  state.racingLineMesh = null;
  if (track.racingLine) {
    const line = track.racingLine;
    const geometry = new THREE.BufferGeometry();
    const positionData = new Float32Array(line.positions.length * 3);
    const uvData = new Float32Array(line.uvs.length * 2);
    for (let index = 0; index < line.positions.length; index += 1) {
      const position = line.positions[index]!;
      positionData[index * 3] = position[0];
      positionData[index * 3 + 1] = position[1];
      positionData[index * 3 + 2] = position[2];
      const uv = line.uvs[index]!;
      uvData[index * 2] = uv[0];
      uvData[index * 2 + 1] = uv[1];
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positionData, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvData, 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(line.indices), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x121218,
        roughness: 0.92,
        metalness: 0,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    mesh.name = "racing-line";
    mesh.visible = state.racingLineVisible;
    content.add(mesh);
    state.racingLineMesh = mesh;
  }

  const wireframe = new THREE.Group();
  wireframe.name = "wireframe";
  wireframe.visible = state.wireframeVisible;
  const groundWireframe = buildEdgeLines(
    state.topology.edges,
    state.topology.weldedPositions,
    0x9fb0c8,
    0.35,
    true,
  );
  groundWireframe.name = "ground-wireframe";
  wireframe.add(groundWireframe);
  if (state.kerbTopology) {
    const kerbWireframe = buildEdgeLines(
      state.kerbTopology.edges,
      state.kerbTopology.weldedPositions,
      0x38bdf8,
      0.7,
      true,
    );
    kerbWireframe.name = "kerb-wireframe";
    wireframe.add(kerbWireframe);
  }
  content.add(wireframe);

  const interiorBoundary = buildEdgeLines(
    state.topology.interiorBoundaryEdges,
    state.topology.weldedPositions,
    0xff4d4d,
    1,
    false,
  );
  const outerBoundary = buildEdgeLines(
    state.topology.outerBoundaryEdges,
    state.topology.weldedPositions,
    0x4ade80,
    0.9,
    false,
  );
  const nonManifold = buildEdgeLines(
    state.topology.nonManifoldEdges,
    state.topology.weldedPositions,
    0xff3df2,
    1,
    false,
  );
  const boundaryGroup = new THREE.Group();
  boundaryGroup.name = "boundary-edges";
  boundaryGroup.visible = state.boundaryVisible;
  boundaryGroup.add(interiorBoundary, outerBoundary, nonManifold);
  if (state.kerbTopology && state.kerbTopology.nonManifoldEdges.length > 0) {
    const kerbNonManifold = buildEdgeLines(
      state.kerbTopology.nonManifoldEdges,
      state.kerbTopology.weldedPositions,
      0xff3df2,
      1,
      false,
    );
    kerbNonManifold.name = "kerb-non-manifold";
    boundaryGroup.add(kerbNonManifold);
  }
  content.add(boundaryGroup);

  const tJunctions = new THREE.Group();
  tJunctions.name = "t-junctions";
  tJunctions.visible = state.tJunctionsVisible;
  const addTJunctionPoints = (source: TopologyReport): void => {
    if (source.tJunctions.length === 0) {
      return;
    }
    const vertices = new Set<number>();
    for (const tJunction of source.tJunctions) {
      vertices.add(tJunction.vertex);
    }
    const data = new Float32Array(vertices.size * 3);
    let index = 0;
    for (const vertex of vertices) {
      const position = source.weldedPositions[vertex]!;
      data[index * 3] = position[0];
      data[index * 3 + 1] = position[1] + 0.08;
      data[index * 3 + 2] = position[2];
      index += 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xffd166,
        size: 9,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    tJunctions.add(points);
  };
  addTJunctionPoints(state.topology);
  if (state.kerbTopology) {
    addTJunctionPoints(state.kerbTopology);
  }
  content.add(tJunctions);

  const collisionMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const collision = new THREE.Group();
  collision.name = "collision-overlay";
  collision.visible = state.collisionVisible;
  for (const mesh of [state.surfaceMesh, state.kerbMesh, state.wallMesh]) {
    if (!mesh) {
      continue;
    }
    const overlay = new THREE.Mesh(mesh.geometry, collisionMaterial);
    overlay.position.y = 0.03;
    overlay.renderOrder = 2;
    collision.add(overlay);
  }
  content.add(collision);
}
