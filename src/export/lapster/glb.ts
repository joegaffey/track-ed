import type { BakedTrack, Prop, Quat, Surface, Vec3 } from "../../model/baked-track";

const SURFACE_COLORS: Record<string, [number, number, number]> = {
  asphalt: [0.045, 0.045, 0.05],
  dirt: [0.48, 0.345, 0.208],
  grass: [0.18, 0.4, 0.22],
  kerb_red: [0.7, 0.14, 0.14],
  kerb_white: [0.93, 0.93, 0.93],
  wall: [0.46, 0.48, 0.5],
};

const RACING_LINE_ASPHALT_COLOR: [number, number, number] = [0.045, 0.045, 0.05];
const RACING_LINE_DARK_COLOR: [number, number, number] = [0.016, 0.016, 0.021];
const RACING_LINE_TEXTURE_GAIN = 2.2;

type TextureKind = "solid" | "tarmac" | "grass" | "racingline";

const SURFACE_TEXTURES: Record<string, TextureKind> = {
  asphalt: "tarmac",
  dirt: "tarmac",
  grass: "grass",
};

const TARMAC_TEXTURE_GAIN: Record<string, number> = {
  asphalt: 2.2,
  dirt: 0.9,
};

const OUTLINE_MATERIALS = new Set([
  "kerb_red",
  "kerb_white",
  "wall",
  "concrete",
  "tire_blue",
  "tire_white",
  "tree_trunk",
  "tree_foliage",
]);

// Ported from Lapster's procedural prop materials and dimensions
// (crates/sim-render/src/track_editor.rs, MIT OR Apache-2.0).
const PROP_COLORS: Record<string, [number, number, number]> = {
  prop_tree_trunk: [0.32, 0.23, 0.15],
  prop_tree_foliage: [0.2, 0.42, 0.18],
  prop_tire_blue: [0.133, 0.333, 0.667],
  prop_tire_white: [0.867, 0.867, 0.867],
  prop_block: [0.667, 0.667, 0.667],
};

const PROP_MATERIAL_NAME: Record<string, string> = {
  prop_tree_trunk: "tree_trunk",
  prop_tree_foliage: "tree_foliage",
  prop_tire_blue: "tire_blue",
  prop_tire_white: "tire_white",
  prop_block: "concrete",
};

const LAPSTER_BLOCK_HALF: Vec3 = [0.3, 0.4, 0.9];
const LAPSTER_TYRE_RADIUS = 0.4;
const LAPSTER_TYRE_LAYER_HEIGHT = 0.3;
const LAPSTER_TYRE_LAYERS = 3;
const LAPSTER_TREE_SIZE = 0.6;
const LAPSTER_TREE_TALL: ReadonlyArray<readonly [number, number, number]> = [
  [1, 2, 2.2],
  [2.1, 1.65, 2],
  [3.2, 1.3, 1.9],
  [4.3, 1, 1.8],
  [5.4, 0.7, 1.7],
  [6.5, 0.4, 1.5],
];
const LAPSTER_TREE_BROAD: ReadonlyArray<readonly [number, number, number]> = [
  [1.1, 2.4, 2.4],
  [2.3, 1.9, 2.2],
  [3.5, 1.45, 2],
  [4.7, 1.05, 1.8],
  [5.9, 0.65, 1.6],
];
const LAPSTER_TREE_YOUNG: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 1.25, 1.5],
  [1.4, 0.95, 1.4],
  [2.3, 0.65, 1.3],
  [3.2, 0.4, 1.2],
];

function propHash(id: string, salt: number): number {
  let hash = 0x811c9dc5 ^ salt;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

function rotateByQuat(value: Vec3, quaternion: Quat): Vec3 {
  const [x, y, z, w] = quaternion;
  const tx = 2 * (y * value[2] - z * value[1]);
  const ty = 2 * (z * value[0] - x * value[2]);
  const tz = 2 * (x * value[1] - y * value[0]);
  return [
    value[0] + w * tx + (y * tz - z * ty),
    value[1] + w * ty + (z * tx - x * tz),
    value[2] + w * tz + (x * ty - y * tx),
  ];
}

function createGroundSampler(track: BakedTrack): (x: number, z: number) => number | null {
  const graph = track.surfaceGraph;
  return (x, z) => {
    for (let triangle = 0; triangle < graph.indices.length / 3; triangle += 1) {
      const a = graph.positions[graph.indices[triangle * 3]!]!;
      const b = graph.positions[graph.indices[triangle * 3 + 1]!]!;
      const c = graph.positions[graph.indices[triangle * 3 + 2]!]!;
      const denominator =
        (b[2] - c[2]) * (a[0] - c[0]) +
        (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(denominator) < 1e-12) {
        continue;
      }
      const wa =
        ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) /
        denominator;
      const wb =
        ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) /
        denominator;
      const wc = 1 - wa - wb;
      if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) {
        continue;
      }
      return wa * a[1] + wb * b[1] + wc * c[1];
    }
    return null;
  };
}

function addBox(
  positions: Vec3[],
  indices: number[],
  center: Vec3,
  size: Vec3,
  quaternion: Quat,
  groundAt?: (x: number, z: number) => number | null,
  baseY?: number,
): void {
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  const local: Vec3[] = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ];
  const base = positions.length;
  for (const point of local) {
    const rotated = rotateByQuat(point, quaternion);
    const x = rotated[0] + center[0];
    const z = rotated[2] + center[2];
    const ground = groundAt ? groundAt(x, z) : null;
    positions.push([
      x,
      ground !== null && baseY !== undefined
        ? ground + (center[1] - baseY) + rotated[1]
        : rotated[1] + center[1],
      z,
    ]);
  }
  const faces = [
    [4, 5, 6, 4, 6, 7],
    [1, 0, 3, 1, 3, 2],
    [0, 4, 7, 0, 7, 3],
    [5, 1, 2, 5, 2, 6],
    [3, 7, 6, 3, 6, 2],
    [0, 1, 5, 0, 5, 4],
  ];
  for (const face of faces) {
    for (const index of face) {
      indices.push(base + index);
    }
  }
}

function addCylinder(
  positions: Vec3[],
  indices: number[],
  center: Vec3,
  radius: number,
  height: number,
  sides: number,
  quaternion: Quat,
  groundAt?: (x: number, z: number) => number | null,
  baseY?: number,
): void {
  const base = positions.length;
  const bottomY = -height / 2;
  const topY = height / 2;
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    for (const y of [bottomY, topY]) {
      const rotated = rotateByQuat([x, y, z], quaternion);
      const worldX = rotated[0] + center[0];
      const worldZ = rotated[2] + center[2];
      const ground = groundAt ? groundAt(worldX, worldZ) : null;
      positions.push([
        worldX,
        ground !== null && baseY !== undefined
          ? ground + (center[1] - baseY) + rotated[1]
          : rotated[1] + center[1],
        worldZ,
      ]);
    }
  }
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    const bl = base + index * 2;
    const tl = bl + 1;
    const br = base + next * 2;
    const tr = br + 1;
    indices.push(bl, br, tr, bl, tr, tl);
  }
  const bottomCenter = positions.length;
  const bottom = rotateByQuat([0, bottomY, 0], quaternion);
  const bottomX = bottom[0] + center[0];
  const bottomZ = bottom[2] + center[2];
  const bottomGround = groundAt ? groundAt(bottomX, bottomZ) : null;
  positions.push([
    bottomX,
    bottomGround !== null && baseY !== undefined
      ? bottomGround + (center[1] - baseY) + bottom[1]
      : bottom[1] + center[1],
    bottomZ,
  ]);
  const topCenter = positions.length;
  const top = rotateByQuat([0, topY, 0], quaternion);
  const topX = top[0] + center[0];
  const topZ = top[2] + center[2];
  const topGround = groundAt ? groundAt(topX, topZ) : null;
  positions.push([
    topX,
    topGround !== null && baseY !== undefined
      ? topGround + (center[1] - baseY) + top[1]
      : top[1] + center[1],
    topZ,
  ]);
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    indices.push(bottomCenter, base + next * 2, base + index * 2);
    indices.push(topCenter, base + index * 2 + 1, base + next * 2 + 1);
  }
}

function addCone(
  positions: Vec3[],
  indices: number[],
  center: Vec3,
  radius: number,
  height: number,
  sides: number,
  quaternion: Quat,
): void {
  const base = positions.length;
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2;
    const rotated = rotateByQuat(
      [Math.cos(angle) * radius, -height / 2, Math.sin(angle) * radius],
      quaternion,
    );
    positions.push([
      rotated[0] + center[0],
      rotated[1] + center[1],
      rotated[2] + center[2],
    ]);
  }
  const apex = positions.length;
  const rotatedApex = rotateByQuat([0, height / 2, 0], quaternion);
  positions.push([
    rotatedApex[0] + center[0],
    rotatedApex[1] + center[1],
    rotatedApex[2] + center[2],
  ]);
  const centerIndex = positions.length;
  const rotatedBase = rotateByQuat([0, -height / 2, 0], quaternion);
  positions.push([
    rotatedBase[0] + center[0],
    rotatedBase[1] + center[1],
    rotatedBase[2] + center[2],
  ]);
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    indices.push(base + index, base + next, apex);
    indices.push(centerIndex, base + next, base + index);
  }
}

function addOrientedTriangle(
  positions: Vec3[],
  indices: number[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  hint: Vec3,
): void {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const dot =
    normal[0] * hint[0] + normal[1] * hint[1] + normal[2] * hint[2];
  const base = positions.length;
  positions.push(a, b, c);
  if (dot >= 0) {
    indices.push(base, base + 1, base + 2);
  } else {
    indices.push(base, base + 2, base + 1);
  }
}

function addOrientedQuad(
  positions: Vec3[],
  indices: number[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  hint: Vec3,
): void {
  addOrientedTriangle(positions, indices, a, b, c, hint);
  addOrientedTriangle(positions, indices, a, c, d, hint);
}

function addConiferTier(
  positions: Vec3[],
  indices: number[],
  base: Vec3,
  offset: number,
  radius: number,
  height: number,
  tierIndex: number,
  quaternion: Quat,
  id: string,
  treeScale: number,
): void {
  const center: Vec3 = [
    base[0],
    base[1] + offset * treeScale,
    base[2],
  ];
  const topCenter: Vec3 = [
    base[0],
    base[1] + (offset + height) * treeScale,
    base[2],
  ];
  const topRadius = radius * treeScale * 0.1;
  const phase =
    tierIndex * 0.37 + propHash(id, 0x20 + tierIndex) * 0.18;
  for (let side = 0; side < 6; side += 1) {
    const next = (side + 1) % 6;
    const jitter0 =
      0.88 + 0.24 * (propHash(id, 0x40 + tierIndex * 8 + side) * 0.5 + 0.5);
    const jitter1 =
      0.88 + 0.24 * (propHash(id, 0x40 + tierIndex * 8 + next) * 0.5 + 0.5);
    const droop0 =
      height * treeScale *
      (0.06 + 0.12 * (propHash(id, 0x80 + tierIndex * 8 + side) * 0.5 + 0.5));
    const droop1 =
      height * treeScale *
      (0.06 + 0.12 * (propHash(id, 0x80 + tierIndex * 8 + next) * 0.5 + 0.5));
    const angle0 = phase + (side / 6) * Math.PI * 2;
    const angle1 = phase + (next / 6) * Math.PI * 2;
    const direction0: Vec3 = [Math.cos(angle0), 0, Math.sin(angle0)];
    const direction1: Vec3 = [Math.cos(angle1), 0, Math.sin(angle1)];
    const bottom0: Vec3 = [
      center[0] + direction0[0] * radius * treeScale * jitter0,
      center[1] - droop0,
      center[2] + direction0[2] * radius * treeScale * jitter0,
    ];
    const bottom1: Vec3 = [
      center[0] + direction1[0] * radius * treeScale * jitter1,
      center[1] - droop1,
      center[2] + direction1[2] * radius * treeScale * jitter1,
    ];
    const top0: Vec3 = [
      topCenter[0] + direction0[0] * topRadius,
      topCenter[1],
      topCenter[2] + direction0[2] * topRadius,
    ];
    const top1: Vec3 = [
      topCenter[0] + direction1[0] * topRadius,
      topCenter[1],
      topCenter[2] + direction1[2] * topRadius,
    ];
    // Quaternion is a yaw rotation around world +Y; tiers are already radial,
    // so only the per-tier lean would need it. Track-ed props use identity lean.
    void quaternion;
    addOrientedQuad(positions, indices, bottom0, top0, top1, bottom1, [
      direction0[0] + direction1[0],
      0,
      direction0[2] + direction1[2],
    ]);
  }
}

interface PropBuffers {
  positions: Vec3[];
  indices: number[];
}

function propBuffers(): PropBuffers {
  return { positions: [], indices: [] };
}

function appendPropGeometry(
  prop: Prop,
  visual: Map<string, PropBuffers>,
  collision: PropBuffers,
  groundAt: (x: number, z: number) => number | null,
): void {
  const scale = prop.scale;
  const quaternion = prop.rotation;
  const position = prop.position;
  const at = (y: number): Vec3 => [position[0], position[1] + y, position[2]];
  const material = (name: string): PropBuffers => {
    let buffers = visual.get(name);
    if (!buffers) {
      buffers = propBuffers();
      visual.set(name, buffers);
    }
    return buffers;
  };

  if (prop.kind === "tree") {
    const variant = propHash(prop.id, 0x4);
    const tierSet =
      variant < 0.4
        ? LAPSTER_TREE_TALL
        : variant < 0.75
          ? LAPSTER_TREE_BROAD
          : LAPSTER_TREE_YOUNG;
    const treeScale = LAPSTER_TREE_SIZE * scale;
    const trunkHeight = (variant < 0.4 ? 1.6 : variant < 0.75 ? 1.8 : 1) * treeScale;
    const trunkRadius = (variant < 0.4 ? 0.18 : variant < 0.75 ? 0.24 : 0.13) * treeScale;
    const trunk = material("prop_tree_trunk");
    addCylinder(
      trunk.positions,
      trunk.indices,
      at(trunkHeight / 2),
      trunkRadius,
      trunkHeight,
      5,
      quaternion,
    );
    const foliage = material("prop_tree_foliage");
    for (let tier = 0; tier < tierSet.length; tier += 1) {
      const [offset, radius, height] = tierSet[tier]!;
      addConiferTier(
        foliage.positions,
        foliage.indices,
        position,
        offset,
        radius,
        height,
        tier,
        quaternion,
        prop.id,
        treeScale,
      );
    }
    const lastTier = tierSet[tierSet.length - 1]!;
    addCone(
      foliage.positions,
      foliage.indices,
      at((lastTier[0] + lastTier[2]) * treeScale),
      lastTier[1] * 0.1 * treeScale,
      lastTier[2] * 0.5 * treeScale,
      6,
      quaternion,
    );
  } else if (prop.kind === "tyre") {
    for (let layer = 0; layer < LAPSTER_TYRE_LAYERS; layer += 1) {
      const tyre = material(layer % 2 === 0 ? "prop_tire_blue" : "prop_tire_white");
      addCylinder(
        tyre.positions,
        tyre.indices,
        at(
          layer * LAPSTER_TYRE_LAYER_HEIGHT * scale +
            (LAPSTER_TYRE_LAYER_HEIGHT * scale) / 2,
        ),
        LAPSTER_TYRE_RADIUS * scale,
        LAPSTER_TYRE_LAYER_HEIGHT * scale,
        8,
        quaternion,
        groundAt,
        position[1],
      );
    }
  } else {
    const block = material("prop_block");
    addBox(
      block.positions,
      block.indices,
      at(LAPSTER_BLOCK_HALF[1] * scale),
      [
        LAPSTER_BLOCK_HALF[0] * 2 * scale,
        LAPSTER_BLOCK_HALF[1] * 2 * scale,
        LAPSTER_BLOCK_HALF[2] * 2 * scale,
      ],
      quaternion,
      groundAt,
      position[1],
    );
  }

  if (prop.collision) {
    if (prop.kind === "tree") {
      const variant = propHash(prop.id, 0x4);
      const treeScale = LAPSTER_TREE_SIZE * scale;
      const trunkHeight =
        (variant < 0.4 ? 1.6 : variant < 0.75 ? 1.8 : 1) * treeScale;
      const trunkRadius =
        (variant < 0.4 ? 0.18 : variant < 0.75 ? 0.24 : 0.13) * treeScale;
      addCylinder(
        collision.positions,
        collision.indices,
        at(trunkHeight / 2),
        trunkRadius,
        trunkHeight,
        5,
        quaternion,
        groundAt,
        position[1],
      );
    } else {
      const size: Vec3 =
        prop.kind === "tyre"
          ? [0.8 * scale, 0.9 * scale, 0.8 * scale]
          : [0.6 * scale, 0.8 * scale, 1.8 * scale];
      addBox(
        collision.positions,
        collision.indices,
        at(size[1] / 2),
        size,
        quaternion,
        groundAt,
        position[1],
      );
    }
  }
}

function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length, false);
  for (let index = 0; index < 4; index += 1) {
    result[4 + index] = type.charCodeAt(index);
  }
  result.set(data, 8);
  const crcInput = result.slice(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return result;
}

function zlibStored(bytes: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(bytes.length / 65535));
  const compressed = new Uint8Array(2 + bytes.length + blockCount * 5 + 4);
  compressed[0] = 0x78;
  compressed[1] = 0x01;
  let output = 2;
  let offset = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const length = Math.min(65535, bytes.length - offset);
    compressed[output++] = block === blockCount - 1 ? 0x01 : 0x00;
    compressed[output++] = length & 0xff;
    compressed[output++] = (length >>> 8) & 0xff;
    compressed[output++] = ~length & 0xff;
    compressed[output++] = (~length >>> 8) & 0xff;
    compressed.set(bytes.subarray(offset, offset + length), output);
    output += length;
    offset += length;
  }
  const adler = adler32(bytes);
  compressed[output++] = (adler >>> 24) & 0xff;
  compressed[output++] = (adler >>> 16) & 0xff;
  compressed[output++] = (adler >>> 8) & 0xff;
  compressed[output++] = adler & 0xff;
  return compressed.subarray(0, output);
}

function pngFromRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const scanline = 1 + width * 4;
  const raw = new Uint8Array(height * scanline);
  for (let y = 0; y < height; y += 1) {
    const source = y * width * 4;
    raw[y * scanline] = 0;
    raw.set(rgba.subarray(source, source + width * 4), y * scanline + 1);
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width, false);
  headerView.setUint32(4, height, false);
  header[8] = 8;
  header[9] = 6;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = pngChunk("IHDR", header);
  const idat = pngChunk("IDAT", zlibStored(raw));
  const iend = pngChunk("IEND", new Uint8Array(0));
  const png = new Uint8Array(
    signature.length + ihdr.length + idat.length + iend.length,
  );
  let offset = 0;
  for (const part of [signature, ihdr, idat, iend]) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

function solidColorPng(color: [number, number, number]): Uint8Array {
  return pngFromRgba(
    1,
    1,
    new Uint8Array([
      Math.round(linearToSrgb(color[0]) * 255),
      Math.round(linearToSrgb(color[1]) * 255),
      Math.round(linearToSrgb(color[2]) * 255),
      255,
    ]),
  );
}

// Ported from Lapster's procedural tarmac/grass textures
// (crates/sim-render/src/track_editor.rs, MIT OR Apache-2.0).
const TEXTURE_SIZE = 256;
const TARMAC_TILE_METERS = 7;
const texturePngs = new Map<string, Uint8Array>();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function srgbToLinear(value: number): number {
  const clamped = clamp01(value);
  return clamped <= 0.04045
    ? clamped / 12.92
    : Math.pow((clamped + 0.055) / 1.055, 2.4);
}

function textureHash(x: number, y: number, seed: number): number {
  let hash =
    (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ seed) >>> 0;
  hash = (hash ^ (hash >>> 15)) >>> 0;
  hash = Math.imul(hash, 0x2c1b3c6d) >>> 0;
  hash = (hash ^ (hash >>> 12)) >>> 0;
  hash = Math.imul(hash, 0x297a2d39) >>> 0;
  hash = (hash ^ (hash >>> 15)) >>> 0;
  return hash / 0xffffffff;
}

function valueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const wrap = (value: number): number => ((value % cells) + cells) % cells;
  const a = textureHash(wrap(x0), wrap(y0), seed);
  const b = textureHash(wrap(x0 + 1), wrap(y0), seed);
  const c = textureHash(wrap(x0), wrap(y0 + 1), seed);
  const d = textureHash(wrap(x0 + 1), wrap(y0 + 1), seed);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return ab + (cd - ab) * sy;
}

function tarmacTexturePng(
  color: [number, number, number],
  gain: number,
): Uint8Array {
  const key = `tarmac:${color.join(",")}:${gain}`;
  const cached = texturePngs.get(key);
  if (cached) {
    return cached;
  }
  const rgba = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const u = x / TEXTURE_SIZE;
      const v = y / TEXTURE_SIZE;
      const coarse = valueNoise(u, v, 6, 0x1a2b3c4d);
      const medium = valueNoise(u, v, 18, 0x5e6f7a8b);
      const fine = valueNoise(u, v, 54, 0x9c0d1e2f);
      const grain = textureHash(x, y, 0x31415926);
      const patches = smoothstep(0.52, 0.82, coarse);
      const shade =
        (medium - 0.5) * 0.09 +
        (fine - 0.5) * 0.045 +
        (grain - 0.5) * 0.025 -
        patches * 0.03;
      const value = Math.max(0.62, Math.min(0.79, 0.71 + shade));
      const cool = (medium - 0.5) * 0.02;
      const offset = (y * TEXTURE_SIZE + x) * 4;
      rgba[offset] = Math.round(
        linearToSrgb(clamp01(color[0] * gain * srgbToLinear(value - cool))) * 255,
      );
      rgba[offset + 1] = Math.round(
        linearToSrgb(clamp01(color[1] * gain * srgbToLinear(value))) * 255,
      );
      rgba[offset + 2] = Math.round(
        linearToSrgb(clamp01(color[2] * gain * srgbToLinear(value + cool))) * 255,
      );
      rgba[offset + 3] = 255;
    }
  }
  const png = pngFromRgba(TEXTURE_SIZE, TEXTURE_SIZE, rgba);
  texturePngs.set(key, png);
  return png;
}

function grassTexturePng(): Uint8Array {
  const cached = texturePngs.get("grass");
  if (cached) {
    return cached;
  }
  const rgba = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const u = x / TEXTURE_SIZE;
      const v = y / TEXTURE_SIZE;
      const coarse = valueNoise(u, v, 5, 0x2b3c4d5e);
      const medium = valueNoise(u, v, 17, 0x6f7a8b9c);
      const fine = valueNoise(u, v, 48, 0xa1b2c3d4);
      const grain = textureHash(x, y, 0x0f1e2d3c);
      const shade =
        (coarse - 0.5) * 0.12 +
        (medium - 0.5) * 0.07 +
        (fine - 0.5) * 0.04 +
        (grain - 0.5) * 0.025;
      const offset = (y * TEXTURE_SIZE + x) * 4;
      rgba[offset] = Math.round(Math.max(0, Math.min(255, 72 * (1 + shade))));
      rgba[offset + 1] = Math.round(Math.max(0, Math.min(255, 107 * (1 + shade))));
      rgba[offset + 2] = Math.round(Math.max(0, Math.min(255, 22 * (1 + shade))));
      rgba[offset + 3] = 255;
    }
  }
  const png = pngFromRgba(TEXTURE_SIZE, TEXTURE_SIZE, rgba);
  texturePngs.set("grass", png);
  return png;
}

function racingLineTexturePng(): Uint8Array {
  const cached = texturePngs.get("racingline");
  if (cached) {
    return cached;
  }
  const rgba = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    const across = Math.abs((y / (TEXTURE_SIZE - 1)) * 2 - 1);
    const blend = smoothstep(0.6, 1, across);
    const color: [number, number, number] = [
      RACING_LINE_DARK_COLOR[0] +
        (RACING_LINE_ASPHALT_COLOR[0] - RACING_LINE_DARK_COLOR[0]) * blend,
      RACING_LINE_DARK_COLOR[1] +
        (RACING_LINE_ASPHALT_COLOR[1] - RACING_LINE_DARK_COLOR[1]) * blend,
      RACING_LINE_DARK_COLOR[2] +
        (RACING_LINE_ASPHALT_COLOR[2] - RACING_LINE_DARK_COLOR[2]) * blend,
    ];
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const u = x / TEXTURE_SIZE;
      const v = y / TEXTURE_SIZE;
      const coarse = valueNoise(u, v, 6, 0x1a2b3c4d);
      const medium = valueNoise(u, v, 18, 0x5e6f7a8b);
      const fine = valueNoise(u, v, 54, 0x9c0d1e2f);
      const grain = textureHash(x, y, 0x31415926);
      const patches = smoothstep(0.52, 0.82, coarse);
      const shade =
        (medium - 0.5) * 0.09 +
        (fine - 0.5) * 0.045 +
        (grain - 0.5) * 0.025 -
        patches * 0.03;
      const value = Math.max(0.62, Math.min(0.79, 0.71 + shade));
      const cool = (medium - 0.5) * 0.02;
      const offset = (y * TEXTURE_SIZE + x) * 4;
      rgba[offset] = Math.round(
        linearToSrgb(
          clamp01(color[0] * RACING_LINE_TEXTURE_GAIN * srgbToLinear(value - cool)),
        ) * 255,
      );
      rgba[offset + 1] = Math.round(
        linearToSrgb(
          clamp01(color[1] * RACING_LINE_TEXTURE_GAIN * srgbToLinear(value)),
        ) * 255,
      );
      rgba[offset + 2] = Math.round(
        linearToSrgb(
          clamp01(color[2] * RACING_LINE_TEXTURE_GAIN * srgbToLinear(value + cool)),
        ) * 255,
      );
      rgba[offset + 3] = 255;
    }
  }
  const png = pngFromRgba(TEXTURE_SIZE, TEXTURE_SIZE, rgba);
  texturePngs.set("racingline", png);
  return png;
}

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
    ...(track.wallGraph ? [track.wallGraph] : []),
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

  const addBufferView = (data: Uint8Array, target?: number): number => {
    const padded = padTo4(data);
    const byteOffset = byteLength;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: data.byteLength,
      ...(target !== undefined ? { target } : {}),
    });
    chunks.push(padded);
    byteLength += padded.byteLength;
    return bufferViews.length - 1;
  };

  const positionData = new Float32Array(graph.positions.length * 3);
  const normalData = computeNormals(graph.positions, graph.indices);
  const uvData = new Float32Array(graph.positions.length * 2);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < graph.positions.length; i += 1) {
    const position = graph.positions[i]!;
    positionData[i * 3] = position[0];
    positionData[i * 3 + 1] = position[1];
    positionData[i * 3 + 2] = position[2];
    uvData[i * 2] = position[0] / TARMAC_TILE_METERS;
    uvData[i * 2 + 1] = position[2] / TARMAC_TILE_METERS;
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
  const uvView = addBufferView(
    new Uint8Array(uvData.buffer, uvData.byteOffset, uvData.byteLength),
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
  const uvAccessor = accessors.length;
  accessors.push({
    bufferView: uvView,
    componentType: POSITION_COMPONENT_TYPE,
    count: graph.positions.length,
    type: "VEC2",
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
  const images: Record<string, unknown>[] = [];
  const textures: Record<string, unknown>[] = [];
  const materialIndexByName = new Map<string, number>();
  const textureIndexByKey = new Map<string, number>();

  const addMaterial = (
    name: string,
    color: [number, number, number],
    roughness: number,
    textureKind: TextureKind,
  ): number => {
    const existing = materialIndexByName.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const materialIndex = materials.length;
    const textureKey =
      textureKind === "solid"
        ? `solid:${color.join(",")}`
        : `${textureKind}:${color.join(",")}`;
    let textureIndex = textureIndexByKey.get(textureKey);
    if (textureIndex === undefined) {
      const png =
        textureKind === "tarmac"
          ? tarmacTexturePng(color, TARMAC_TEXTURE_GAIN[name] ?? 1)
          : textureKind === "grass"
            ? grassTexturePng()
            : textureKind === "racingline"
              ? racingLineTexturePng()
              : solidColorPng(color);
      const imageView = addBufferView(png);
      const imageIndex = images.length;
      images.push({ bufferView: imageView, mimeType: "image/png" });
      textureIndex = textures.length;
      textures.push({ sampler: 0, source: imageIndex });
      textureIndexByKey.set(textureKey, textureIndex);
    }
    materials.push({
      name,
      doubleSided: false,
      ...(OUTLINE_MATERIALS.has(name) ? { extras: { outline: true } } : {}),
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: roughness,
        baseColorTexture: { index: textureIndex },
      },
    });
    materialIndexByName.set(name, materialIndex);
    return materialIndex;
  };

  for (const surface of surfaces) {
    const indexAccessor = indexAccessors.get(surface.id);
    if (indexAccessor === undefined) {
      continue;
    }
    const materialIndex = addMaterial(
      surface.name,
      surfaceColor(surface),
      surface.roughness,
      SURFACE_TEXTURES[surface.name] ?? "solid",
    );
    const meshIndex = meshes.length;
    meshes.push({
      name: `surface_${surface.name}`,
      primitives: [
        {
          attributes: {
            POSITION: positionAccessor,
            NORMAL: normalAccessor,
            TEXCOORD_0: uvAccessor,
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

  const racingLine = track.racingLine;
  if (
    racingLine &&
    racingLine.positions.length > 0 &&
    racingLine.indices.length > 0
  ) {
    const linePositions = new Float32Array(racingLine.positions.length * 3);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let index = 0; index < racingLine.positions.length; index += 1) {
      const position = racingLine.positions[index]!;
      linePositions[index * 3] = position[0];
      linePositions[index * 3 + 1] = position[1];
      linePositions[index * 3 + 2] = position[2];
      min[0] = Math.min(min[0], position[0]);
      min[1] = Math.min(min[1], position[1]);
      min[2] = Math.min(min[2], position[2]);
      max[0] = Math.max(max[0], position[0]);
      max[1] = Math.max(max[1], position[1]);
      max[2] = Math.max(max[2], position[2]);
    }
    const linePositionView = addBufferView(
      new Uint8Array(
        linePositions.buffer,
        linePositions.byteOffset,
        linePositions.byteLength,
      ),
      ARRAY_BUFFER,
    );
    const lineNormals = computeNormals(racingLine.positions, racingLine.indices);
    const lineNormalView = addBufferView(
      new Uint8Array(
        lineNormals.buffer,
        lineNormals.byteOffset,
        lineNormals.byteLength,
      ),
      ARRAY_BUFFER,
    );
    const lineUvs = new Float32Array(racingLine.uvs.length * 2);
    for (let index = 0; index < racingLine.uvs.length; index += 1) {
      const uv = racingLine.uvs[index]!;
      lineUvs[index * 2] = uv[0];
      lineUvs[index * 2 + 1] = uv[1];
    }
    const lineUvView = addBufferView(
      new Uint8Array(lineUvs.buffer, lineUvs.byteOffset, lineUvs.byteLength),
      ARRAY_BUFFER,
    );
    const linePositionAccessor = accessors.length;
    accessors.push({
      bufferView: linePositionView,
      componentType: POSITION_COMPONENT_TYPE,
      count: racingLine.positions.length,
      type: "VEC3",
      min,
      max,
    });
    const lineNormalAccessor = accessors.length;
    accessors.push({
      bufferView: lineNormalView,
      componentType: POSITION_COMPONENT_TYPE,
      count: racingLine.positions.length,
      type: "VEC3",
    });
    const lineUvAccessor = accessors.length;
    accessors.push({
      bufferView: lineUvView,
      componentType: POSITION_COMPONENT_TYPE,
      count: racingLine.positions.length,
      type: "VEC2",
    });
    const lineIndexData = new Uint32Array(racingLine.indices);
    const lineIndexView = addBufferView(
      new Uint8Array(
        lineIndexData.buffer,
        lineIndexData.byteOffset,
        lineIndexData.byteLength,
      ),
      ELEMENT_ARRAY_BUFFER,
    );
    const lineIndexAccessor = accessors.length;
    accessors.push({
      bufferView: lineIndexView,
      componentType: INDEX_COMPONENT_TYPE,
      count: lineIndexData.length,
      type: "SCALAR",
    });
    const lineMaterial = addMaterial(
      "racing_line",
      RACING_LINE_ASPHALT_COLOR,
      0.9,
      "racingline",
    );
    const lineMeshIndex = meshes.length;
    meshes.push({
      name: "racing_line",
      primitives: [
        {
          attributes: {
            POSITION: linePositionAccessor,
            NORMAL: lineNormalAccessor,
            TEXCOORD_0: lineUvAccessor,
          },
          indices: lineIndexAccessor,
          material: lineMaterial,
          mode: 4,
        },
      ],
    });
    nodes.push({ name: "racing_line", mesh: lineMeshIndex });
  }

  const props = track.props ?? [];
  if (props.length > 0) {
    const propVisual = new Map<string, PropBuffers>();
    const propCollision = propBuffers();
    const groundAt = createGroundSampler(track);
    for (const prop of props) {
      appendPropGeometry(prop, propVisual, propCollision, groundAt);
    }

    const addPropNode = (
      name: string,
      buffers: PropBuffers,
      materialName: string,
      color: [number, number, number],
      roughness: number,
    ): void => {
      if (buffers.indices.length === 0) {
        return;
      }
      const positionData = new Float32Array(buffers.positions.length * 3);
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < buffers.positions.length; index += 1) {
        const position = buffers.positions[index]!;
        positionData[index * 3] = position[0];
        positionData[index * 3 + 1] = position[1];
        positionData[index * 3 + 2] = position[2];
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
      const normals = computeNormals(buffers.positions, buffers.indices);
      const normalView = addBufferView(
        new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength),
        ARRAY_BUFFER,
      );
      const uvData = new Float32Array(buffers.positions.length * 2);
      for (let index = 0; index < buffers.positions.length; index += 1) {
        const position = buffers.positions[index]!;
        uvData[index * 2] = position[0] / TARMAC_TILE_METERS;
        uvData[index * 2 + 1] = position[2] / TARMAC_TILE_METERS;
      }
      const uvView = addBufferView(
        new Uint8Array(uvData.buffer, uvData.byteOffset, uvData.byteLength),
        ARRAY_BUFFER,
      );
      const positionAccessor = accessors.length;
      accessors.push({
        bufferView: positionView,
        componentType: POSITION_COMPONENT_TYPE,
        count: buffers.positions.length,
        type: "VEC3",
        min,
        max,
      });
      const normalAccessor = accessors.length;
      accessors.push({
        bufferView: normalView,
        componentType: POSITION_COMPONENT_TYPE,
        count: buffers.positions.length,
        type: "VEC3",
      });
      const uvAccessor = accessors.length;
      accessors.push({
        bufferView: uvView,
        componentType: POSITION_COMPONENT_TYPE,
        count: buffers.positions.length,
        type: "VEC2",
      });
      const indexData = new Uint32Array(buffers.indices);
      const indexView = addBufferView(
        new Uint8Array(indexData.buffer, indexData.byteOffset, indexData.byteLength),
        ELEMENT_ARRAY_BUFFER,
      );
      const indexAccessor = accessors.length;
      accessors.push({
        bufferView: indexView,
        componentType: INDEX_COMPONENT_TYPE,
        count: indexData.length,
        type: "SCALAR",
      });
      const materialIndex = addMaterial(materialName, color, roughness, "solid");
      const meshIndex = meshes.length;
      meshes.push({
        name,
        primitives: [
          {
            attributes: {
              POSITION: positionAccessor,
              NORMAL: normalAccessor,
              TEXCOORD_0: uvAccessor,
            },
            indices: indexAccessor,
            material: materialIndex,
            mode: 4,
          },
        ],
      });
      nodes.push({ name, mesh: meshIndex });
    };

    for (const [nodeName, buffers] of [...propVisual.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const materialName = PROP_MATERIAL_NAME[nodeName] ?? nodeName;
      addPropNode(
        nodeName,
        buffers,
        materialName,
        PROP_COLORS[nodeName] ?? [0.6, 0.6, 0.6],
        0.75,
      );
    }
    addPropNode("col_prop", propCollision, "wall", SURFACE_COLORS.wall!, 0.65);
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
    ...(images.length > 0
      ? {
          images,
          textures,
          samplers: [
            {
              magFilter: 9729,
              minFilter: 9729,
              wrapS: 10497,
              wrapT: 10497,
            },
          ],
        }
      : {}),
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
