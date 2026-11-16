import type { BakedTrack, Surface, Vec3 } from "../../model/baked-track";

const SURFACE_COLORS: Record<string, [number, number, number]> = {
  asphalt: [0.28, 0.31, 0.35],
  dirt: [0.55, 0.37, 0.23],
  grass: [0.18, 0.4, 0.22],
  kerb_red: [0.7, 0.14, 0.14],
  kerb_white: [0.93, 0.93, 0.93],
};

const POSITION_COMPONENT_TYPE = 5126;
const INDEX_COMPONENT_TYPE = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

function padTo4(bytes: Uint8Array): Uint8Array {
  const remainder = bytes.length % 4;
  if (remainder === 0) {
    return bytes;
  }
  const padded = new Uint8Array(bytes.length + (4 - remainder));
  padded.set(bytes);
  return padded;
}

function computeNormals(positions: readonly Vec3[], indices: readonly number[]): Float32Array {
  const normals = new Float32Array(positions.length * 3);

  for (let i = 0; i < indices.length; i += 3) {
    const aIndex = indices[i]!;
    const bIndex = indices[i + 1]!;
    const cIndex = indices[i + 2]!;
    const a = positions[aIndex]!;
    const b = positions[bIndex]!;
    const c = positions[cIndex]!;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    for (const index of [aIndex, bIndex, cIndex]) {
      const base = index * 3;
      normals[base] = normals[base]! + nx;
      normals[base + 1] = normals[base + 1]! + ny;
      normals[base + 2] = normals[base + 2]! + nz;
    }
  }

  for (let i = 0; i < positions.length; i += 1) {
    const x = normals[i * 3]!;
    const y = normals[i * 3 + 1]!;
    const z = normals[i * 3 + 2]!;
    const length = Math.hypot(x, y, z);
    if (length > 1e-12) {
      normals[i * 3] = x / length;
      normals[i * 3 + 1] = y / length;
      normals[i * 3 + 2] = z / length;
    } else {
      normals[i * 3] = 0;
      normals[i * 3 + 1] = 1;
      normals[i * 3 + 2] = 0;
    }
  }

  return normals;
}

function surfaceColor(surface: Surface): [number, number, number] {
  return SURFACE_COLORS[surface.name] ?? [0.7, 0.7, 0.7];
}

export function buildTrackGlb(track: BakedTrack): Uint8Array {
  const surfaces = [...track.surfaces].sort((a, b) => a.id - b.id);
  const sourceGraphs = [
    track.surfaceGraph,
    ...(track.kerbGraph ? [track.kerbGraph] : []),
  ];
  const positions: Vec3[] = [];
  const indices: number[] = [];
  const triangleSurfaces: number[] = [];
  for (const graph of sourceGraphs) {
    const base = positions.length;
    positions.push(...graph.positions);
    for (const index of graph.indices) {
      indices.push(index + base);
    }
    triangleSurfaces.push(...graph.triangleSurfaces);
  }
  const graph = { positions, indices, triangleSurfaces };
  const triangleCount = Math.floor(graph.indices.length / 3);

  const trianglesBySurface = new Map<number, number[]>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const surfaceId = graph.triangleSurfaces[triangle];
    if (surfaceId === undefined) {
      continue;
    }
    const list = trianglesBySurface.get(surfaceId);
    if (list) {
      list.push(triangle);
    } else {
      trianglesBySurface.set(surfaceId, [triangle]);
    }
  }

  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  const addBufferView = (data: Uint8Array, target: number): number => {
    const padded = padTo4(data);
    const byteOffset = byteLength;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: data.byteLength,
      target,
    });
    chunks.push(padded);
    byteLength += padded.byteLength;
    return bufferViews.length - 1;
  };

  const positionData = new Float32Array(graph.positions.length * 3);
  const normalData = computeNormals(graph.positions, graph.indices);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < graph.positions.length; i += 1) {
    const position = graph.positions[i]!;
    positionData[i * 3] = position[0];
    positionData[i * 3 + 1] = position[1];
    positionData[i * 3 + 2] = position[2];
    min[0] = Math.min(min[0], position[0]);
    min[1] = Math.min(min[1], position[1]);
    min[2] = Math.min(min[2], position[2]);
    max[0] = Math.max(max[0], position[0]);
    max[1] = Math.max(max[1], position[1]);
    max[2] = Math.max(max[2], position[2]);
  }

  const positionView = addBufferView(
    new Uint8Array(positionData.buffer, positionData.byteOffset, positionData.byteLength),
    ARRAY_BUFFER,
  );
  const normalView = addBufferView(
    new Uint8Array(normalData.buffer, normalData.byteOffset, normalData.byteLength),
    ARRAY_BUFFER,
  );

  const positionAccessor = accessors.length;
  accessors.push({
    bufferView: positionView,
    componentType: POSITION_COMPONENT_TYPE,
    count: graph.positions.length,
    type: "VEC3",
    min,
    max,
  });
  const normalAccessor = accessors.length;
  accessors.push({
    bufferView: normalView,
    componentType: POSITION_COMPONENT_TYPE,
    count: graph.positions.length,
    type: "VEC3",
  });

  const indexAccessors = new Map<number, number>();
  for (const surface of surfaces) {
    const triangleIndices = trianglesBySurface.get(surface.id);
    if (!triangleIndices || triangleIndices.length === 0) {
      continue;
    }
    const indices = new Uint32Array(triangleIndices.length * 3);
    for (let i = 0; i < triangleIndices.length; i += 1) {
      const triangle = triangleIndices[i]!;
      indices[i * 3] = graph.indices[triangle * 3]!;
      indices[i * 3 + 1] = graph.indices[triangle * 3 + 1]!;
      indices[i * 3 + 2] = graph.indices[triangle * 3 + 2]!;
    }
    const view = addBufferView(
      new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength),
      ELEMENT_ARRAY_BUFFER,
    );
    const accessor = accessors.length;
    accessors.push({
      bufferView: view,
      componentType: INDEX_COMPONENT_TYPE,
      count: indices.length,
      type: "SCALAR",
    });
    indexAccessors.set(surface.id, accessor);
  }

  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];

  for (const surface of surfaces) {
    const indexAccessor = indexAccessors.get(surface.id);
    if (indexAccessor === undefined) {
      continue;
    }
    const color = surfaceColor(surface);
    const materialIndex = materials.length;
    materials.push({
      name: surface.name,
      doubleSided: false,
      pbrMetallicRoughness: {
        baseColorFactor: [color[0], color[1], color[2], 1],
        metallicFactor: 0,
        roughnessFactor: surface.roughness,
      },
    });

    const meshIndex = meshes.length;
    meshes.push({
      name: `surface_${surface.name}`,
      primitives: [
        {
          attributes: {
            POSITION: positionAccessor,
            NORMAL: normalAccessor,
          },
          indices: indexAccessor,
          material: materialIndex,
          mode: 4,
        },
      ],
    });
    nodes.push({
      name: `surface_${surface.name}`,
      mesh: meshIndex,
    });
  }

  if (nodes.length === 0) {
    throw new Error("cannot build a GLB with no surface geometry");
  }

  const gltf = {
    asset: {
      version: "2.0",
      generator: "track-ed 0.1.0",
    },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPaddedLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binaryPaddedLength = Math.ceil(byteLength / 4) * 4;
  const totalLength = 12 + 8 + jsonPaddedLength + 8 + binaryPaddedLength;

  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  let offset = 0;

  view.setUint32(offset, 0x46546c67, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, totalLength, true);
  offset += 4;

  view.setUint32(offset, jsonPaddedLength, true);
  offset += 4;
  view.setUint32(offset, 0x4e4f534a, true);
  offset += 4;
  output.set(jsonBytes, offset);
  offset += jsonBytes.length;
  for (let i = jsonBytes.length; i < jsonPaddedLength; i += 1) {
    output[offset] = 0x20;
    offset += 1;
  }

  view.setUint32(offset, binaryPaddedLength, true);
  offset += 4;
  view.setUint32(offset, 0x004e4942, true);
  offset += 4;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}
