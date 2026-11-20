import { parseProject, type Project } from "../kernel/project";
import { convertProjectToLatest } from "./convert-project";

export const AUTOSAVE_KEY = "track-ed.autosave.v1";
export const AUTOSAVE_VERSION = 1;

/**
 * Narrow view of browser storage so the autosave envelope can be unit tested
 * without touching a real localStorage.
 */
export interface AutosaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveEnvelope {
  version: number;
  savedAt: string;
  project: unknown;
}

export type AutosaveInvalidReason =
  | "invalid-json"
  | "invalid-envelope"
  | "unsupported-version"
  | "invalid-project";

export type AutosaveReadResult =
  | { status: "empty" }
  | { status: "restored"; project: Project; savedAt: string }
  | { status: "invalid"; reason: AutosaveInvalidReason }
  | { status: "unavailable" };

export type AutosaveWriteResult =
  | { status: "saved"; savedAt: string }
  | { status: "failed" };

export type AutosaveClearResult =
  | { status: "cleared" }
  | { status: "unavailable" };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Read and validate the stored project. Missing data is `empty`; any malformed
 * envelope or project is reported as `invalid` so the caller can remove it and
 * fall back to a default. Storage access failures never throw.
 */
export function readAutosave(storage: AutosaveStorage): AutosaveReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) {
    return { status: "empty" };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "invalid-json" };
  }

  const envelope = asRecord(value);
  if (!envelope || !("project" in envelope)) {
    return { status: "invalid", reason: "invalid-envelope" };
  }
  if (envelope.version !== AUTOSAVE_VERSION) {
    return { status: "invalid", reason: "unsupported-version" };
  }

  const parsed = parseProject(envelope.project);
  if (!parsed.project) {
    return { status: "invalid", reason: "invalid-project" };
  }
  const converted = convertProjectToLatest(parsed.project);
  if (!converted.ok) {
    return { status: "invalid", reason: "invalid-project" };
  }

  return {
    status: "restored",
    project: converted.project,
    savedAt: typeof envelope.savedAt === "string" ? envelope.savedAt : "",
  };
}

/**
 * Write a versioned autosave envelope. Serialisation and storage failures are
 * reported, never thrown, so the caller keeps its in-memory project.
 */
export function writeAutosave(
  storage: AutosaveStorage,
  project: unknown,
  now: Date = new Date(),
): AutosaveWriteResult {
  const savedAt = now.toISOString();
  const envelope: AutosaveEnvelope = {
    version: AUTOSAVE_VERSION,
    savedAt,
    project,
  };

  let raw: string;
  try {
    raw = JSON.stringify(envelope);
  } catch {
    return { status: "failed" };
  }

  try {
    storage.setItem(AUTOSAVE_KEY, raw);
  } catch {
    return { status: "failed" };
  }
  return { status: "saved", savedAt };
}

/** Remove the stored project. Storage failures are reported, never thrown. */
export function clearAutosave(storage: AutosaveStorage): AutosaveClearResult {
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  return { status: "cleared" };
}
