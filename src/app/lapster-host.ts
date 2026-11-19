import type { LapsterExportBundle } from "../export/lapster";

export const TRACK_ED_TRACK_ID = "track-ed";
export const TRACK_ED_TRACK_CACHE_KEY = "lapster.track-ed.v1";

export const lapsterHostEnabled = import.meta.env.VITE_LAPSTER_HOST === "1";

export interface TrackPackInput {
  glb: Uint8Array;
  json: Uint8Array;
  id: string;
}

interface TrackPackModule {
  default: (input: URL | string) => Promise<unknown>;
  compile_glb_track: (
    trackJson: Uint8Array,
    glb: Uint8Array,
    id: string,
  ) => Uint8Array;
}

export function trackPackInput(bundle: LapsterExportBundle): TrackPackInput {
  const glb = bundle.files.find((file) => file.name === "track.glb")?.bytes;
  const json = bundle.files.find((file) => file.name === "track.json")?.bytes;
  if (!glb || !json) {
    throw new Error("track-ed export is missing track.glb or track.json");
  }
  return { glb, json, id: TRACK_ED_TRACK_ID };
}

export function lapsterDriveUrl(
  baseHref: string,
  search = "",
  trees = "high",
): URL {
  const target = new URL("../drive/", baseHref);
  target.searchParams.set("track", TRACK_ED_TRACK_ID);
  const car = new URLSearchParams(search).get("car");
  if (car) {
    target.searchParams.set("car", car);
  }
  target.searchParams.set("trees", trees);
  return target;
}

export async function trackPackBaseUrl(
  baseHref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<URL> {
  try {
    const versionUrl = new URL("../version.json", baseHref);
    versionUrl.searchParams.set("t", String(Date.now()));
    const response = await fetchImpl(versionUrl, { cache: "no-store" });
    if (response.ok) {
      const info = (await response.json()) as { version?: unknown };
      if (typeof info.version === "string" && info.version.length > 0) {
        return new URL(
          `../pkg/${encodeURIComponent(info.version)}/track-pack/`,
          baseHref,
        );
      }
    }
  } catch {
    // Fall back to the unversioned package for standalone or offline use.
  }
  return new URL("../pkg/track-pack/", baseHref);
}

export async function compileAndStoreTrack(input: TrackPackInput): Promise<Uint8Array> {
  const base = await trackPackBaseUrl(window.location.href);
  const moduleUrl = new URL("track_pack_wasm.js", base);
  const wasmUrl = new URL("track_pack_wasm_bg.wasm", base);
  const module = (await import(
    /* @vite-ignore */ moduleUrl.href
  )) as TrackPackModule;
  await module.default(wasmUrl);
  const pack = module.compile_glb_track(input.json, input.glb, input.id);
  await putPack(TRACK_ED_TRACK_CACHE_KEY, pack);
  return pack;
}

async function putPack(key: string, bytes: Uint8Array): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("packs", "readwrite");
    transaction.objectStore("packs").put(bytes, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sim-assets", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("packs")) {
        request.result.createObjectStore("packs");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
