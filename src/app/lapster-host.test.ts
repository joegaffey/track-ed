import { describe, expect, it } from "vitest";
import type { LapsterExportBundle } from "../export/lapster";
import { lapsterDriveUrl, trackPackBaseUrl, trackPackInput } from "./lapster-host";

function bundle(files: LapsterExportBundle["files"]): LapsterExportBundle {
  return {
    manifest: {
      schema: "sim-track-glb-v2",
      kind: "track",
      name: "test",
      length: 1,
      spawn: { position: [0, 0, 0], rotation_xyzw: [0, 0, 0, 1] },
      visual: {
        glb: "track.glb",
        include: [],
        exclude: [],
        scale: 1,
        yaw_degrees: 0,
        offset: [0, 0, 0],
      },
      collision: { include: [], exclude: [] },
      surfaces: [],
      default_surface: 0,
    },
    files,
  };
}

describe("trackPackInput", () => {
  it("selects the exported GLB and JSON files", () => {
    const glb = new Uint8Array([1, 2, 3]);
    const json = new Uint8Array([4, 5]);
    const input = trackPackInput(
      bundle([
        { name: "track.json", mimeType: "application/json", bytes: json },
        { name: "track.glb", mimeType: "model/gltf-binary", bytes: glb },
      ]),
    );
    expect(input).toEqual({ glb, json, id: "track-ed" });
  });

  it("rejects bundles without both files", () => {
    expect(() =>
      trackPackInput(
        bundle([{ name: "track.glb", mimeType: "model/gltf-binary", bytes: new Uint8Array() }]),
      ),
    ).toThrow(/track\.glb or track\.json/);
  });
});

describe("trackPackBaseUrl", () => {
  it("uses the deployed versioned package when version metadata is available", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ version: "dev-abc123" }), {
        status: 200,
      })) as typeof fetch;
    const url = await trackPackBaseUrl(
      "https://example.test/lapster-dev/web/track-ed/",
      fetchImpl,
    );
    expect(url.href).toBe(
      "https://example.test/lapster-dev/web/pkg/dev-abc123/track-pack/",
    );
  });

  it("falls back to the unversioned package", async () => {
    const fetchImpl = (async () => new Response("missing", { status: 404 })) as typeof fetch;
    const url = await trackPackBaseUrl(
      "https://example.test/lapster/web/track-ed/",
      fetchImpl,
    );
    expect(url.href).toBe("https://example.test/lapster/web/pkg/track-pack/");
  });
});

describe("lapsterDriveUrl", () => {
  it("targets the drive viewer with the local track id", () => {
    const url = lapsterDriveUrl(
      "https://example.test/lapster/web/track-ed/",
      "?car=cars%2Frx7.sima",
      "cards",
    );
    expect(url.pathname).toBe("/lapster/web/drive/");
    expect(url.searchParams.get("track")).toBe("track-ed");
    expect(url.searchParams.get("car")).toBe("cars/rx7.sima");
    expect(url.searchParams.get("trees")).toBe("cards");
  });
});
