import type { Vec3 } from "../model/baked-track";

export const CONIFER_SIZE = 0.6;

const CONIFER_TIER_SIDES = 12;

const CONIFER_TALL: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 1.9, 2.1],
  [2.0, 1.62, 2.0],
  [3.0, 1.36, 1.9],
  [4.0, 1.12, 1.8],
  [5.0, 0.9, 1.7],
  [5.9, 0.7, 1.55],
  [6.8, 0.5, 1.4],
  [7.6, 0.32, 1.25],
];

const CONIFER_BROAD: ReadonlyArray<readonly [number, number, number]> = [
  [1.1, 2.3, 2.3],
  [2.2, 1.95, 2.1],
  [3.3, 1.6, 2.0],
  [4.4, 1.25, 1.8],
  [5.5, 0.9, 1.7],
  [6.4, 0.55, 1.5],
];

const CONIFER_YOUNG: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 1.1, 1.4],
  [1.3, 0.85, 1.3],
  [2.1, 0.6, 1.2],
  [2.9, 0.35, 1.1],
];

function coniferHash(id: string, salt: number): number {
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

function pushOrientedTriangle(
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

function addTier(
  id: string,
  tierIndex: number,
  offset: number,
  radius: number,
  height: number,
  treeScale: number,
  positions: Vec3[],
  indices: number[],
): void {
  const sides = CONIFER_TIER_SIDES;
  const centerY = offset * treeScale;
  const topY = centerY + height * treeScale;
  const outerRadius = radius * treeScale;
  const innerRadius = outerRadius * 0.58;
  const innerY = centerY + height * treeScale * 0.38;
  const phase =
    tierIndex * 0.37 + coniferHash(id, 0x20 + tierIndex) * 0.42;

  const inner: Vec3[] = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = phase + (side / sides) * Math.PI * 2;
    const jitter =
      0.9 + 0.2 * (coniferHash(id, 0x40 + tierIndex * 16 + side) * 0.5 + 0.5);
    inner.push([
      Math.cos(angle) * innerRadius * jitter,
      innerY +
        (coniferHash(id, 0x60 + tierIndex * 16 + side) - 0.5) *
          height *
          treeScale *
          0.06,
      Math.sin(angle) * innerRadius * jitter,
    ]);
  }

  const apex: Vec3 = [0, topY, 0];
  for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides;
    const angle = phase + ((side + 0.5) / sides) * Math.PI * 2;
    const direction: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
    const long = side % 2 === 0;
    const tipJitter =
      0.9 + 0.18 * (coniferHash(id, 0x80 + tierIndex * 16 + side) * 0.5 + 0.5);
    const tipRadius = outerRadius * (long ? 1.0 : 0.82) * tipJitter;
    const droop =
      height *
      treeScale *
      (long ? 0.16 : 0.08) *
      (0.8 + 0.4 * coniferHash(id, 0xa0 + tierIndex * 16 + side));
    const tip: Vec3 = [
      direction[0] * tipRadius,
      centerY - droop,
      direction[2] * tipRadius,
    ];

    pushOrientedTriangle(positions, indices, inner[side]!, tip, inner[next]!, [
      direction[0],
      0.7,
      direction[2],
    ]);

    const sideAngle = phase + (side / sides) * Math.PI * 2;
    const sideDirection: Vec3 = [
      Math.cos(sideAngle),
      0,
      Math.sin(sideAngle),
    ];
    const midTipRadius =
      outerRadius *
      0.72 *
      (0.95 +
        0.1 * coniferHash(id, 0xc0 + tierIndex * 16 + side));
    const midTip: Vec3 = [
      sideDirection[0] * midTipRadius,
      centerY +
        height * treeScale * 0.12 -
        height * treeScale * 0.04 * coniferHash(id, 0xe0 + tierIndex * 16 + side),
      sideDirection[2] * midTipRadius,
    ];
    pushOrientedTriangle(
      positions,
      indices,
      inner[side]!,
      midTip,
      inner[next]!,
      [sideDirection[0], 0.8, sideDirection[2]],
    );

    pushOrientedTriangle(positions, indices, inner[side]!, inner[next]!, apex, [
      direction[0],
      1,
      direction[2],
    ]);
  }
}

export function coniferTierSet(
  variant: number,
): ReadonlyArray<readonly [number, number, number]> {
  if (variant < 0.4) {
    return CONIFER_TALL;
  }
  if (variant < 0.75) {
    return CONIFER_BROAD;
  }
  return CONIFER_YOUNG;
}

export type ConiferTone = "deep" | "mid" | "light" | "gold";

export function coniferTone(id: string, variant: number): ConiferTone {
  const roll = coniferHash(id, 0x1c0);
  if (roll < 0.12) {
    return "gold";
  }
  if (variant < 0.4) {
    return roll < 0.58 ? "deep" : "mid";
  }
  if (variant < 0.75) {
    return roll < 0.48 ? "mid" : "light";
  }
  return roll < 0.4 ? "light" : "mid";
}

export function coniferTrunk(variant: number): {
  height: number;
  radius: number;
} {
  if (variant < 0.4) {
    return { height: 2.4, radius: 0.15 };
  }
  if (variant < 0.75) {
    return { height: 2.6, radius: 0.19 };
  }
  return { height: 1.3, radius: 0.1 };
}

export function buildConiferFoliage(
  id: string,
  variant: number,
  treeScale: number,
): { positions: Vec3[]; indices: number[] } {
  const positions: Vec3[] = [];
  const indices: number[] = [];
  const tiers = coniferTierSet(variant);
  for (let tier = 0; tier < tiers.length; tier += 1) {
    const [offset, radius, height] = tiers[tier]!;
    addTier(id, tier, offset, radius, height, treeScale, positions, indices);
  }
  return { positions, indices };
}
