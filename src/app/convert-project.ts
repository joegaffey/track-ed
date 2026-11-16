import type {
  Project,
  ProjectJunction,
  ProjectJunctionMember,
} from "../kernel/project";

export type ConvertResult =
  | { ok: true; project: Project }
  | { ok: false; message: string };

export function convertProjectToV3(source: Project): ConvertResult {
  if (source.schema === "track-ed/project@3") {
    return { ok: true, project: structuredClone(source) };
  }
  if (source.schema === "track-ed/project@1") {
    return {
      ok: false,
      message: "Legacy project@1 files remain import-only.",
    };
  }

  const project = structuredClone(source);
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
  project.schema = "track-ed/project@3";
  return { ok: true, project };
}
