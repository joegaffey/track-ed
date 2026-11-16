import {
  DEFAULT_PROP_OFFSETS,
  DEFAULT_WALL_OFFSET,
} from "../kernel/kerbs";
import type {
  Project,
  ProjectJunction,
  ProjectJunctionMember,
  ProjectRoadsideRun,
  ProjectRoadsideSpline,
} from "../kernel/project";

export type ConvertResult =
  | { ok: true; project: Project }
  | { ok: false; message: string };

function groupKey(side: "left" | "right", offset: number): string {
  return `${side}:${offset.toFixed(6)}`;
}

function upgradeV4ToV5(source: Project): Project {
  const project = structuredClone(source);
  for (const section of project.centerlines) {
    const fixedLeft: ProjectRoadsideSpline = {
      id: `${section.id}:kerb-left`,
      role: "kerb-left",
      side: "left",
      offset: project.road.halfWidth,
      runs: [],
    };
    const fixedRight: ProjectRoadsideSpline = {
      id: `${section.id}:kerb-right`,
      role: "kerb-right",
      side: "right",
      offset: project.road.halfWidth,
      runs: [],
    };
    const groups = new Map<
      string,
      { side: "left" | "right"; offset: number; runs: ProjectRoadsideRun[] }
    >();
    const addRun = (
      side: "left" | "right",
      offset: number,
      run: ProjectRoadsideRun,
    ): void => {
      const key = groupKey(side, offset);
      let group = groups.get(key);
      if (!group) {
        group = { side, offset, runs: [] };
        groups.set(key, group);
      }
      group.runs.push(run);
    };

    for (const kerb of section.kerbs ?? []) {
      const target = kerb.side === "left" ? fixedLeft : fixedRight;
      target.runs.push({
        kind: "kerb",
        start: kerb.start,
        length: kerb.length,
        ...(kerb.flatHeight !== undefined ? { flatHeight: kerb.flatHeight } : {}),
        ...(kerb.cornerHeight !== undefined
          ? { cornerHeight: kerb.cornerHeight }
          : {}),
      });
    }
    for (const wall of section.walls ?? []) {
      addRun(
        wall.side,
        project.road.halfWidth + (wall.offset ?? DEFAULT_WALL_OFFSET),
        {
          kind: "wall",
          start: wall.start,
          length: wall.length,
          ...(wall.height !== undefined ? { height: wall.height } : {}),
        },
      );
    }
    for (const prop of section.props ?? []) {
      addRun(
        prop.side,
        project.road.halfWidth +
          (prop.offset ?? DEFAULT_PROP_OFFSETS[prop.kind]),
        {
          kind: prop.kind,
          start: prop.start,
          length: prop.length,
          ...(prop.spacing !== undefined ? { spacing: prop.spacing } : {}),
          ...(prop.collision !== undefined ? { collision: prop.collision } : {}),
        },
      );
    }

    const freeSplines: ProjectRoadsideSpline[] = [...groups.values()]
      .sort(
        (a, b) =>
          a.side.localeCompare(b.side) || a.offset - b.offset,
      )
      .map((group, index) => ({
        id: `${section.id}:roadside:${index + 1}`,
        side: group.side,
        offset: group.offset,
        runs: group.runs.sort((a, b) => a.start - b.start),
      }));
    fixedLeft.runs.sort((a, b) => a.start - b.start);
    fixedRight.runs.sort((a, b) => a.start - b.start);
    section.roadside = [fixedLeft, fixedRight, ...freeSplines];
    delete section.kerbs;
    delete section.walls;
    delete section.props;
  }
  project.schema = "track-ed/project@5";
  return project;
}

function ensureFixedSplines(source: Project): Project {
  const project = structuredClone(source);
  for (const section of project.centerlines) {
    const splines = section.roadside ?? [];
    for (const role of ["kerb-left", "kerb-right"] as const) {
      const side = role === "kerb-left" ? "left" : "right";
      const existing = splines.find((spline) => spline.role === role);
      if (existing) {
        existing.side = side;
        existing.offset = project.road.halfWidth;
      } else {
        splines.unshift({
          id: `${section.id}:${role}`,
          role,
          side,
          offset: project.road.halfWidth,
          runs: [],
        });
      }
    }
    section.roadside = splines;
  }
  return project;
}

export function convertProjectToLatest(source: Project): ConvertResult {
  if (source.schema === "track-ed/project@5") {
    return { ok: true, project: ensureFixedSplines(source) };
  }
  if (source.schema === "track-ed/project@1") {
    return {
      ok: false,
      message: "Legacy project@1 files remain import-only.",
    };
  }

  let project = structuredClone(source);

  if (project.schema === "track-ed/project@2") {
    for (const section of project.centerlines) {
      if (section.attach && "to" in section.attach) {
        return {
          ok: false,
          message: "Legacy fraction attachments cannot be converted automatically.",
        };
      }
    }

    const junctions: ProjectJunction[] = [];
    for (const junction of project.junctions) {
      const members: ProjectJunctionMember[] = [
        { section: junction.centerline, point: junction.point },
      ];
      for (const section of project.centerlines) {
        if (!section.closed) {
          if (
            section.attach &&
            "junction" in section.attach &&
            section.attach.junction === junction.id
          ) {
            const point = section.pointIds[0];
            if (point) {
              members.push({ section: section.id, point });
            }
          }
          if (
            section.endAttach &&
            "junction" in section.endAttach &&
            section.endAttach.junction === junction.id
          ) {
            const point = section.pointIds[section.pointIds.length - 1];
            if (point) {
              members.push({ section: section.id, point });
            }
          }
        }
      }
      if (members.length >= 2) {
        junctions.push({
          id: junction.id,
          centerline: junction.centerline,
          point: junction.point,
          members,
        });
      }
    }

    project.junctions = junctions;
    project.centerlines = project.centerlines.map((section) => {
      const converted = { ...section };
      delete converted.attach;
      delete converted.endAttach;
      return converted;
    });
  }

  if (project.schema === "track-ed/project@2" || project.schema === "track-ed/project@3") {
    project.schema = "track-ed/project@4";
  }
  if (project.schema === "track-ed/project@4") {
    project = upgradeV4ToV5(project);
  }
  return { ok: true, project };
}

export const convertProjectToV3 = convertProjectToLatest;
