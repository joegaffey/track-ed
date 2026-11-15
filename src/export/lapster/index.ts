import type { BakedTrack } from "../../model/baked-track";
import { validateBakedTrack } from "../../kernel/validate-baked";
import { buildTrackGlb } from "./glb";
import { buildLapsterManifest, type LapsterManifest } from "./manifest";

export interface ExportFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface LapsterExportBundle {
  files: ExportFile[];
  manifest: LapsterManifest;
}

export function exportLapsterGlbTrack(track: BakedTrack): LapsterExportBundle {
  const validation = validateBakedTrack(track);
  if (!validation.ok) {
    const summary = validation.violations
      .filter((violation) => violation.severity === "error")
      .map((violation) => `${violation.rule}: ${violation.message}`)
      .join("; ");
    throw new Error(`refusing to export an invalid BakedTrack: ${summary}`);
  }

  const manifest = buildLapsterManifest(track);
  const glb = buildTrackGlb(track);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

  return {
    manifest,
    files: [
      {
        name: "track.glb",
        mimeType: "model/gltf-binary",
        bytes: glb,
      },
      {
        name: "track.json",
        mimeType: "application/json",
        bytes: new TextEncoder().encode(manifestText),
      },
    ],
  };
}

export { buildLapsterManifest, buildTrackGlb };
export type { LapsterManifest };
