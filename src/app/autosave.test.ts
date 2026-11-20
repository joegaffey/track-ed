import { describe, expect, it } from "vitest";
import loopSplineTerrainJunctionsFixture from "../../fixtures/projects/loop-spline-terrain-junctions.json";
import {
  AUTOSAVE_KEY,
  clearAutosave,
  readAutosave,
  writeAutosave,
  type AutosaveStorage,
} from "./autosave";

class MemoryStorage implements AutosaveStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;
  failRemoves = false;

  getItem(key: string): string | null {
    if (this.failReads) {
      throw new Error("storage read blocked");
    }
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failRemoves) {
      throw new Error("storage remove blocked");
    }
    this.values.delete(key);
  }
}

const fixture = loopSplineTerrainJunctionsFixture;

describe("autosave", () => {
  it("round-trips a project through the versioned envelope", () => {
    const storage = new MemoryStorage();
    const wrote = writeAutosave(
      storage,
      fixture,
      new Date("2026-11-20T12:34:56.000Z"),
    );
    expect(wrote).toEqual({
      status: "saved",
      savedAt: "2026-11-20T12:34:56.000Z",
    });

    const stored = JSON.parse(storage.values.get(AUTOSAVE_KEY) ?? "null") as {
      version: number;
      savedAt: string;
      project: unknown;
    };
    expect(stored.version).toBe(1);
    expect(stored.savedAt).toBe("2026-11-20T12:34:56.000Z");
    expect(stored.project).toBeDefined();

    const read = readAutosave(storage);
    expect(read.status).toBe("restored");
    if (read.status !== "restored") {
      throw new Error(`expected restored, got ${read.status}`);
    }
    expect(read.savedAt).toBe("2026-11-20T12:34:56.000Z");
    expect(read.project.schema).toBe("track-ed/project@5");
    expect(read.project.name).toBe(fixture.name);
    expect(read.project.centerlines[0]?.points[0]).toEqual(
      fixture.centerlines[0]?.points[0]?.position,
    );
  });

  it("rejects invalid JSON", () => {
    const storage = new MemoryStorage();
    storage.values.set(AUTOSAVE_KEY, "{not valid json");
    expect(readAutosave(storage)).toEqual({
      status: "invalid",
      reason: "invalid-json",
    });
  });

  it("rejects an unsupported envelope version", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      AUTOSAVE_KEY,
      JSON.stringify({ version: 2, savedAt: "now", project: fixture }),
    );
    expect(readAutosave(storage)).toEqual({
      status: "invalid",
      reason: "unsupported-version",
    });
  });

  it("rejects a project payload that does not parse", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      AUTOSAVE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: "now",
        project: { schema: "not-a-project", sections: [] },
      }),
    );
    expect(readAutosave(storage)).toEqual({
      status: "invalid",
      reason: "invalid-project",
    });
  });

  it("reports write failures without throwing or losing the old value", () => {
    const storage = new MemoryStorage();
    expect(writeAutosave(storage, fixture).status).toBe("saved");
    const previous = storage.values.get(AUTOSAVE_KEY);

    storage.failWrites = true;
    expect(() => writeAutosave(storage, fixture)).not.toThrow();
    expect(writeAutosave(storage, fixture)).toEqual({ status: "failed" });
    expect(storage.values.get(AUTOSAVE_KEY)).toBe(previous);
  });

  it("clears the stored project", () => {
    const storage = new MemoryStorage();
    writeAutosave(storage, fixture);
    expect(storage.values.has(AUTOSAVE_KEY)).toBe(true);

    expect(clearAutosave(storage)).toEqual({ status: "cleared" });
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(readAutosave(storage)).toEqual({ status: "empty" });
  });

  it("reports storage access failures without throwing", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    expect(readAutosave(storage)).toEqual({ status: "unavailable" });

    storage.failRemoves = true;
    expect(clearAutosave(storage)).toEqual({ status: "unavailable" });
  });
});
