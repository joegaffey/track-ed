import { describe, expect, it } from "vitest";
import { exportLapsterGlbTrack } from "../export/lapster";
import { bakeProject } from "./bake";
import { parseProject, type Project, type ProjectVec2 } from "./project";
import { validateBakedTrack } from "./validate-baked";

declare const process: { env: Record<string, string | undefined> };

const RUN_BENCHMARK = process.env.RUN_LARGE_VENUE === "1";
const RUNS = 3;
const SPLINE = { type: "catmull-rom" as const, samplesPerSegment: 12 };

const OCTAGON: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.7, 0.7],
  [0, 1],
  [-0.7, 0.7],
  [-1, 0],
  [-0.7, -0.7],
  [0, -1],
  [0.7, -0.7],
];

interface RawPoint {
  id: string;
  position: ProjectVec2;
}

interface RawRun {
  kind: "kerb" | "wall" | "tree" | "tyre" | "block";
  start: number;
  length: number;
  outwardOffset?: number;
  spacing?: number;
}

interface RawSpline {
  id: string;
  role?: "kerb-left" | "kerb-right";
  side: "left" | "right";
  offset: number;
  runs: RawRun[];
}

interface RawSection {
  id: string;
  closed: boolean;
  spline: typeof SPLINE;
  points: RawPoint[];
  roadside: RawSpline[];
}

function ring(
  prefix: string,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
): RawPoint[] {
  return OCTAGON.map(([x, z], index) => ({
    id: `${prefix}-p${index}`,
    position: [centerX + x * radiusX, centerZ + z * radiusZ],
  }));
}

function fixedSplines(
  sectionId: string,
  left: RawRun[],
  right: RawRun[],
): RawSpline[] {
  return [
    {
      id: `${sectionId}:kerb-left`,
      role: "kerb-left",
      side: "left",
      offset: 5,
      runs: left,
    },
    {
      id: `${sectionId}:kerb-right`,
      role: "kerb-right",
      side: "right",
      offset: 5,
      runs: right,
    },
  ];
}

function loopSection(
  id: string,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  left: RawRun[],
  right: RawRun[],
  extraSplines: RawSpline[] = [],
): RawSection {
  return {
    id,
    closed: true,
    spline: SPLINE,
    points: ring(id, centerX, centerZ, radiusX, radiusZ),
    roadside: [...fixedSplines(id, left, right), ...extraSplines],
  };
}

function buildLargeVenue(): unknown {
  const main = "main-loop";
  const sections: RawSection[] = [
    loopSection(
      main,
      0,
      0,
      100,
      100,
      [{ kind: "kerb", start: 0.05, length: 0.2 }],
      [{ kind: "kerb", start: 0.55, length: 0.18 }],
      [
        {
          id: `${main}:trees`,
          side: "left",
          offset: 12,
          runs: [{ kind: "tree", start: 0.05, length: 0.4, spacing: 6 }],
        },
        {
          id: `${main}:tyres`,
          side: "right",
          offset: 5.8,
          runs: [{ kind: "tyre", start: 0.3, length: 0.1, spacing: 0.8 }],
        },
      ],
    ),
    {
      id: "spur-east",
      closed: false,
      spline: SPLINE,
      points: [
        { id: "spur-east-p0", position: [100, 0] },
        { id: "spur-east-p1", position: [170, 0] },
        { id: "spur-east-p2", position: [230, 40] },
      ],
      roadside: fixedSplines(
        "spur-east",
        [{ kind: "kerb", start: 0.1, length: 0.3 }],
        [{ kind: "kerb", start: 0.2, length: 0.4 }],
      ),
    },
    {
      id: "spur-north",
      closed: false,
      spline: SPLINE,
      points: [
        { id: "spur-north-p0", position: [0, 100] },
        { id: "spur-north-p1", position: [0, 170] },
        { id: "spur-north-p2", position: [-40, 230] },
      ],
      roadside: fixedSplines(
        "spur-north",
        [{ kind: "kerb", start: 0, length: 0.25 }],
        [{ kind: "kerb", start: 0.3, length: 0.3 }],
      ),
    },
    loopSection(
      "loop-east",
      350,
      0,
      60,
      55,
      [{ kind: "kerb", start: 0.1, length: 0.2 }],
      [{ kind: "kerb", start: 0.5, length: 0.25 }],
    ),
    loopSection(
      "loop-north-east",
      210,
      250,
      60,
      55,
      [{ kind: "kerb", start: 0.05, length: 0.15 }],
      [],
      [
        {
          id: "loop-north-east:trees",
          side: "right",
          offset: 10,
          runs: [{ kind: "tree", start: 0.2, length: 0.5, spacing: 6 }],
        },
      ],
    ),
    loopSection(
      "loop-north",
      0,
      360,
      60,
      55,
      [],
      [{ kind: "kerb", start: 0.2, length: 0.2 }],
    ),
    loopSection(
      "loop-north-west",
      -220,
      260,
      60,
      55,
      [{ kind: "kerb", start: 0.1, length: 0.2 }],
      [],
    ),
    loopSection(
      "loop-west",
      -380,
      0,
      60,
      55,
      [{ kind: "kerb", start: 0.3, length: 0.2 }],
      [{ kind: "kerb", start: 0.6, length: 0.2 }],
    ),
    loopSection(
      "loop-south-west",
      -230,
      -250,
      60,
      55,
      [],
      [{ kind: "kerb", start: 0.15, length: 0.25 }],
    ),
    loopSection(
      "loop-south",
      130,
      -330,
      60,
      55,
      [{ kind: "kerb", start: 0.4, length: 0.2 }],
      [],
    ),
  ];

  return {
    schema: "track-ed/project@5",
    name: "Large Venue Benchmark",
    generator: "track-ed large-venue-bench",
    road: { halfWidth: 5, shoulderHalfWidth: 8 },
    terrain: {
      margin: 30,
      mode: "conform",
      points: [
        { position: [0, 0], height: 8 },
        { position: [45, 25], height: 5 },
        { position: [-35, 30], height: 7 },
        { position: [25, -40], height: 6 },
        { position: [-30, -35], height: 4 },
        { position: [180, 80], height: 9 },
        { position: [150, -120], height: 6 },
        { position: [-170, 100], height: 10 },
        { position: [-150, -110], height: 7 },
        { position: [300, 120], height: 8 },
        { position: [290, -120], height: 5 },
        { position: [-300, 120], height: 9 },
        { position: [-300, -150], height: 6 },
        { position: [70, 300], height: 7 },
        { position: [-80, 320], height: 8 },
        { position: [50, -260], height: 5 },
        { position: [-90, -300], height: 7 },
        { position: [380, 70], height: 6 },
        { position: [-390, -70], height: 8 },
        { position: [220, 210], height: 9 },
        { position: [-220, -210], height: 5 },
      ],
    },
    spawn: { centerline: main, fraction: 0.1, lateral: 0 },
    cameras: [],
    junctions: [
      {
        id: "junction-east",
        members: [
          { section: main, point: `${main}-p0` },
          { section: "spur-east", point: "spur-east-p0" },
        ],
        anchor: { section: main, point: `${main}-p0` },
      },
      {
        id: "junction-north",
        members: [
          { section: main, point: `${main}-p2` },
          { section: "spur-north", point: "spur-north-p0" },
        ],
        anchor: { section: main, point: `${main}-p2` },
      },
    ],
    sections,
  };
}

function parseLargeVenue(): Project {
  const parsed = parseProject(buildLargeVenue());
  expect(parsed.issues).toEqual([]);
  return parsed.project!;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function ms(value: number): string {
  return value.toFixed(1);
}

describe.skipIf(!RUN_BENCHMARK)("large venue benchmark", () => {
  it(
    "bakes, validates, exports and incrementally edits a deterministic 10-section venue",
    { timeout: 600_000 },
    () => {
      const base = parseLargeVenue();
      expect(base.centerlines).toHaveLength(10);
      expect(base.junctions).toHaveLength(2);
      const totalProjectPoints = base.centerlines.reduce(
        (sum, section) => sum + section.points.length,
        0,
      );

      const bakeTimes: number[] = [];
      const validateTimes: number[] = [];
      const exportTimes: number[] = [];
      const incrementalTimes: number[] = [];
      let track = bakeProject(structuredClone(base));

      for (let run = 0; run < RUNS; run += 1) {
        const project = structuredClone(base);
        const bakeStart = performance.now();
        track = bakeProject(project);
        bakeTimes.push(performance.now() - bakeStart);
      }

      const validation = validateBakedTrack(track);
      expect(validation.ok).toBe(true);
      for (let run = 0; run < RUNS; run += 1) {
        const start = performance.now();
        validateBakedTrack(track);
        validateTimes.push(performance.now() - start);
      }

      let bundleBytes = 0;
      for (let run = 0; run < RUNS; run += 1) {
        const start = performance.now();
        const bundle = exportLapsterGlbTrack(track);
        exportTimes.push(performance.now() - start);
        bundleBytes = bundle.files.reduce((sum, file) => sum + file.bytes.length, 0);
      }

      for (let run = 0; run < RUNS; run += 1) {
        const project = structuredClone(base);
        const main = project.centerlines[0]!;
        const pointIndex = 4;
        const delta = run + 1;
        const start = performance.now();
        main.points[pointIndex] = [
          (main.points[pointIndex]?.[0] ?? 0) - delta,
          main.points[pointIndex]?.[1] ?? 0,
        ];
        bakeProject(project);
        incrementalTimes.push(performance.now() - start);
      }

      const bakeMedian = median(bakeTimes);
      const validateMedian = median(validateTimes);
      const exportMedian = median(exportTimes);
      const incrementalMedian = median(incrementalTimes);
      const groundVertices = track.surfaceGraph.positions.length;
      const groundTriangles = track.surfaceGraph.indices.length / 3;
      const kerbTriangles = (track.kerbGraph?.indices.length ?? 0) / 3;
      const propCount = track.props?.length ?? 0;
      const thresholdMs = 2_000;

      const table = [
        "| Metric | Median (ms) | Runs |",
        "| --- | ---: | ---: |",
        `| Full bakeProject | ${ms(bakeMedian)} | ${bakeTimes.map(ms).join(", ")} |`,
        `| validateBakedTrack | ${ms(validateMedian)} | ${validateTimes.map(ms).join(", ")} |`,
        `| exportLapsterGlbTrack (in memory) | ${ms(exportMedian)} | ${exportTimes.map(ms).join(", ")} |`,
        `| Incremental edit + re-bake | ${ms(incrementalMedian)} | ${incrementalTimes.map(ms).join(", ")} |`,
        "",
        "| Count | Value |",
        "| --- | ---: |",
        `| Sections | ${base.centerlines.length} |`,
        `| Junctions | ${base.junctions.length} |`,
        `| Project control points | ${totalProjectPoints} |`,
        `| Ground vertices | ${groundVertices} |`,
        `| Ground triangles | ${groundTriangles} |`,
        `| Kerb triangles | ${kerbTriangles} |`,
        `| Props | ${propCount} |`,
        `| Export bundle bytes | ${bundleBytes} |`,
      ].join("\n");

      console.log(
        [
          `Large venue benchmark (${process.env.RUN_LARGE_VENUE === "1" ? "enabled" : "disabled"})`,
          table,
          `Acceptable authoring budget at ${thresholdMs} ms: ${bakeMedian <= thresholdMs ? "yes" : "no"}`,
        ].join("\n"),
      );
      expect(bakeMedian).toBeGreaterThan(0);
      expect(groundTriangles).toBeGreaterThan(0);
    },
  );
});
