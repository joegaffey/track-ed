import { describe, expect, it } from "vitest";
import loopFixture from "../../../fixtures/projects/loop.json";
import loopSpurFixture from "../../../fixtures/projects/venue-loop-spur-junction.json";
import venueFixture from "../../../fixtures/projects/venue-two-loops-spur.json";
import { bakeProject } from "../../kernel/bake";
import { parseProject } from "../../kernel/project";
import { exportLapsterGlbTrack } from "./index";

function validTrack() {
  const parsed = parseProject(loopFixture);
  return bakeProject(parsed.project!);
}

function readJsonChunk(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.length);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const jsonBytes = bytes.slice(20, 20 + jsonLength);
  let text = "";
  for (const byte of jsonBytes) {
    text += String.fromCharCode(byte);
  }
  return JSON.parse(text.trimEnd()) as Record<string, unknown>;
}

describe("lapster-glb-track@2", () => {
  it("emits a deterministic GLB and manifest", () => {
    const track = validTrack();
    const first = exportLapsterGlbTrack(track);
    const second = exportLapsterGlbTrack(track);

    expect(first.files.map((file) => file.name)).toEqual(["track.glb", "track.json"]);
    expect(first.files.map((file) => file.mimeType)).toEqual([
      "model/gltf-binary",
      "application/json",
    ]);
    for (let i = 0; i < first.files.length; i += 1) {
      expect(Array.from(first.files[i]!.bytes)).toEqual(Array.from(second.files[i]!.bytes));
    }
  });

  it("writes a valid manifest", () => {
    const bundle = exportLapsterGlbTrack(validTrack());
    const manifest = bundle.manifest;

    expect(manifest.schema).toBe("sim-track-glb-v1");
    expect(manifest.kind).toBe("track");
    expect(manifest.name).toBe("Loop Fixture");
    expect(manifest.length).toBeCloseTo(360, 9);
    expect(manifest.visual.glb).toBe("track.glb");
    expect(manifest.visual.include).toEqual(["surface_*"]);
    expect(manifest.visual.exclude).toEqual([]);
    expect(manifest.visual.scale).toBe(1);
    expect(manifest.visual.yaw_degrees).toBe(0);
    expect(manifest.visual.offset).toEqual([0, 0, 0]);
    expect(manifest.collision.include).toEqual(["surface_*"]);
    expect(manifest.collision.exclude).toEqual([]);
    expect(manifest.surfaces.map((surface) => surface.name)).toEqual([
      "asphalt",
      "dirt",
      "grass",
    ]);
    expect(manifest.default_surface).toBe(0);
  });

  it("writes a GLB with the required Lapster node and material names", () => {
    const glb = exportLapsterGlbTrack(validTrack()).files[0]!.bytes;
    const gltf = readJsonChunk(glb);

    const nodes = gltf.nodes as Array<{ name: string }>;
    expect(nodes.map((node) => node.name)).toEqual([
      "surface_asphalt",
      "surface_dirt",
      "surface_grass",
    ]);

    const materials = gltf.materials as Array<{ name: string }>;
    expect(materials.map((material) => material.name)).toEqual([
      "asphalt",
      "dirt",
      "grass",
    ]);
  });

  it("exports venue fixtures with multiple loops, dead ends, and junctions", () => {
    for (const fixture of [venueFixture, loopSpurFixture]) {
      const parsed = parseProject(fixture);
      expect(parsed.issues).toEqual([]);
      const track = bakeProject(parsed.project!);
      const bundle = exportLapsterGlbTrack(track);
      const repeat = exportLapsterGlbTrack(track);
      for (let index = 0; index < bundle.files.length; index += 1) {
        expect(Array.from(bundle.files[index]!.bytes)).toEqual(
          Array.from(repeat.files[index]!.bytes),
        );
      }

      expect(bundle.manifest.length).toBeCloseTo(track.length, 9);
      expect(bundle.manifest.length).toBeGreaterThan(0);
      expect(bundle.files.map((file) => file.name)).toEqual(["track.glb", "track.json"]);
      const glb = bundle.files[0]!.bytes;
      const gltf = readJsonChunk(glb);
      expect((gltf.nodes as Array<{ name: string }>).map((node) => node.name)).toEqual([
        "surface_asphalt",
        "surface_dirt",
        "surface_grass",
        "surface_kerb_red",
        "surface_kerb_white",
      ]);
      expect(bundle.manifest.surfaces.map((surface) => surface.name)).toEqual([
        "asphalt",
        "dirt",
        "grass",
        "kerb_red",
        "kerb_white",
      ]);
      expect(
        bundle.manifest.surfaces.filter((surface) => surface.name.startsWith("kerb_")),
      ).toHaveLength(2);
      expect(bundle.manifest.surfaces.every((surface) => !surface.mountable)).toBe(true);
    }
  });

  it("refuses to export an invalid track", () => {
    const track = validTrack();
    track.surfaceGraph.indices.splice(0, 3);
    track.surfaceGraph.triangleSurfaces.shift();
    expect(() => exportLapsterGlbTrack(track)).toThrow(/invalid BakedTrack/);
  });
});
