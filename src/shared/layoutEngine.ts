import type {
  DataHallElement,
  DataHallProject,
  LayoutStats,
  Orientation,
  Room,
  StructuredCommand,
  Wall
} from "./types.js";

export const CURRENT_LAYOUT_RULES_VERSION = 2;

const ROOM_LIMITS = {
  widthM: [3, 200],
  lengthM: [3, 300],
  heightM: [2, 20]
} as const;

export function createDefaultProject(): DataHallProject {
  return {
    version: 2,
    layoutRulesVersion: CURRENT_LAYOUT_RULES_VERSION,
    name: "Novo Data Hall",
    room: { widthM: 18, lengthM: 24, heightM: 5 },
    rackDefaults: {
      widthM: 0.6,
      depthM: 1.2,
      heightM: 2.2,
      powerKw: 20,
      orientation: "north"
    },
    fanWallDefaults: {
      widthM: 1.2,
      depthM: 0.6,
      heightM: 3.2,
      airflowM3h: 18000,
      orientation: "south",
      wall: "north"
    },
    pillarDefaults: {
      count: 0,
      columns: 3,
      widthM: 0.45,
      depthM: 0.45,
      heightM: 5,
      orientation: "north"
    },
    architecture: {
      raisedFloor: {
        enabled: false,
        visible: true,
        opacity: 0.32,
        tileWidthM: 0.6,
        tileDepthM: 0.6,
        heightM: 0.6
      },
      ceiling: {
        enabled: false,
        visible: true,
        opacity: 0.28,
        panelWidthM: 1.2,
        panelDepthM: 0.6,
        heightM: 4.6
      }
    },
    visibility: {
      racks: { visible: true, opacity: 1 },
      fanWalls: { visible: true, opacity: 1 },
      pillars: { visible: true, opacity: 1 }
    },
    settings: {
      rackRows: 4,
      coldAisleM: 1.2,
      hotAisleM: 1,
      wallClearanceM: 1
    },
    elements: [],
    warnings: []
  };
}

export function normalizeProject(candidate: unknown): DataHallProject {
  if (!candidate || typeof candidate !== "object") return autoArrange(createDefaultProject());
  const value = candidate as Partial<DataHallProject>;
  const base = createDefaultProject();
  const project: DataHallProject = {
    ...base,
    ...value,
    room: { ...base.room, ...value.room },
    rackDefaults: { ...base.rackDefaults, ...value.rackDefaults },
    fanWallDefaults: { ...base.fanWallDefaults, ...value.fanWallDefaults },
    pillarDefaults: { ...base.pillarDefaults, ...value.pillarDefaults },
    architecture: {
      raisedFloor: { ...base.architecture.raisedFloor, ...value.architecture?.raisedFloor },
      ceiling: { ...base.architecture.ceiling, ...value.architecture?.ceiling }
    },
    visibility: {
      racks: { ...base.visibility.racks, ...value.visibility?.racks },
      fanWalls: { ...base.visibility.fanWalls, ...value.visibility?.fanWalls },
      pillars: { ...base.visibility.pillars, ...value.visibility?.pillars }
    },
    settings: { ...base.settings, ...value.settings },
    elements: Array.isArray(value.elements) ? value.elements.map(normalizeElement).filter(isElement) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.map(String) : []
  };
  project.version = 2;
  return validateProject(project);
}

export function applyCommands(project: DataHallProject, commands: StructuredCommand[]): DataHallProject {
  let next = clone(project);
  let shouldArrange = false;

  for (const command of commands) {
    switch (command.type) {
      case "create_room":
      case "resize_room":
        next.room = resizeRoom(next.room, command);
        next.elements = next.elements.map((element) => clampElementToRoom(element, next.room));
        break;
      case "add_racks":
        updateRackDefaults(next, command);
        next.elements.push(...createRacks(next, command.count ?? 1));
        shouldArrange = true;
        break;
      case "create_rack_rows":
        if (isPositive(command.rows)) next.settings.rackRows = clampInt(command.rows, 1, 100);
        if (isPositive(command.count)) {
          const targetCount = command.count;
          const racks = next.elements.filter((element) => element.type === "rack");
          const desiredRacks =
            targetCount > racks.length
              ? [...racks, ...createRacks(next, targetCount - racks.length)]
              : racks.slice(0, targetCount);
          next.elements = [...next.elements.filter((element) => element.type !== "rack"), ...desiredRacks];
        }
        if (isPositive(command.coldAisleM)) next.settings.coldAisleM = clamp(command.coldAisleM, 0.4, 10);
        if (isPositive(command.hotAisleM)) next.settings.hotAisleM = clamp(command.hotAisleM, 0.4, 10);
        shouldArrange = true;
        break;
      case "add_fan_walls":
        updateFanWallDefaults(next, command);
        next.elements.push(...createFanWalls(next, command.count ?? 1));
        shouldArrange = true;
        break;
      case "add_pillars":
        updatePillarDefaults(next, command);
        next.elements.push(...createPillars(next, command.count ?? 1));
        shouldArrange = true;
        break;
      case "create_pillar_grid":
        updatePillarDefaults(next, command);
        if (isFiniteNumber(command.count)) next.pillarDefaults.count = clampInt(command.count, 0, 400);
        if (isPositive(command.columns)) next.pillarDefaults.columns = clampInt(command.columns, 1, 50);
        {
          const pillars = next.elements.filter((element) => element.type === "pillar");
          const targetCount = next.pillarDefaults.count;
          const desiredPillars =
            targetCount > pillars.length
              ? [...pillars, ...createPillars(next, targetCount - pillars.length)]
              : pillars.slice(0, targetCount);
          next.elements = [...next.elements.filter((element) => element.type !== "pillar"), ...desiredPillars];
        }
        shouldArrange = true;
        break;
      case "move_element":
        if (command.id && isFiniteNumber(command.x) && isFiniteNumber(command.y)) {
          next = moveElement(next, command.id, command.x, command.y, command.z);
        }
        break;
      case "rotate_element":
        if (command.id) next = rotateElement(next, command.id, command.rotation, command.orientation);
        break;
      case "set_aisle_width":
        if (isPositive(command.coldAisleM)) next.settings.coldAisleM = clamp(command.coldAisleM, 0.4, 10);
        if (isPositive(command.hotAisleM)) next.settings.hotAisleM = clamp(command.hotAisleM, 0.4, 10);
        shouldArrange = true;
        break;
      case "set_wall_clearance":
        if (isFiniteNumber(command.wallClearanceM)) next.settings.wallClearanceM = clamp(command.wallClearanceM, 0, 10);
        shouldArrange = true;
        break;
      case "auto_arrange":
        shouldArrange = true;
        break;
      case "delete_element":
        if (command.id) next.elements = next.elements.filter((element) => element.id !== command.id);
        break;
      case "clear_layout":
        next.elements =
          command.target === "racks"
            ? next.elements.filter((element) => element.type !== "rack")
            : command.target === "fanWalls"
              ? next.elements.filter((element) => element.type !== "fanWall")
              : command.target === "pillars"
                ? next.elements.filter((element) => element.type !== "pillar")
              : [];
        break;
    }
  }

  return validateProject(shouldArrange ? autoArrange(next) : next);
}

export function autoArrange(project: DataHallProject): DataHallProject {
  const next = clone(project);
  const racks = next.elements.filter((element) => element.type === "rack");
  const fanWalls = next.elements.filter((element) => element.type === "fanWall");
  const pillars = next.elements.filter((element) => element.type === "pillar");
  const arranged: DataHallElement[] = [];

  arranged.push(...arrangeRackRows(next, racks));
  arranged.push(...arrangeFanWalls(next, fanWalls));
  arranged.push(...arrangePillars(next, pillars));

  next.elements = arranged;
  return validateProject(next);
}

export function moveElement(project: DataHallProject, id: string, x: number, y: number, z = 0): DataHallProject {
  const next = clone(project);
  const element = next.elements.find((item) => item.id === id);
  if (!element) return next;
  element.x = round(x);
  element.y = round(y);
  element.z = round(clamp(z, 0, Math.max(0, next.room.heightM - element.heightM)));
  return validateProject(next);
}

export function rotateElement(
  project: DataHallProject,
  id: string,
  rotation?: number,
  orientation?: Orientation
): DataHallProject {
  const next = clone(project);
  const element = next.elements.find((item) => item.id === id);
  if (!element) return next;
  const degrees = normalizeRotation(rotation ?? orientationToRotation(orientation ?? element.orientation));
  if (degrees % 180 !== element.rotation % 180) {
    [element.widthM, element.depthM] = [element.depthM, element.widthM];
  }
  element.rotation = degrees;
  element.orientation = rotationToOrientation(degrees);
  return validateProject(next);
}

export function validateProject(project: DataHallProject): DataHallProject {
  const next = clone(project);
  const warnings: string[] = [];

  next.layoutRulesVersion = CURRENT_LAYOUT_RULES_VERSION;
  next.room = resizeRoom(next.room, next.room);
  next.settings.rackRows = clampInt(next.settings.rackRows, 1, 100);
  next.settings.coldAisleM = clamp(next.settings.coldAisleM, 0.4, 10);
  next.settings.hotAisleM = clamp(next.settings.hotAisleM, 0.4, 10);
  next.settings.wallClearanceM = clamp(next.settings.wallClearanceM, 0, 10);
  next.pillarDefaults.count = clampInt(next.pillarDefaults.count, 0, 400);
  next.pillarDefaults.columns = clampInt(next.pillarDefaults.columns, 1, 50);
  next.architecture.raisedFloor.opacity = clamp(next.architecture.raisedFloor.opacity, 0, 1);
  next.architecture.raisedFloor.tileWidthM = clamp(next.architecture.raisedFloor.tileWidthM, 0.3, 2.4);
  next.architecture.raisedFloor.tileDepthM = clamp(next.architecture.raisedFloor.tileDepthM, 0.3, 2.4);
  next.architecture.raisedFloor.heightM = clamp(next.architecture.raisedFloor.heightM, 0.05, 2);
  next.architecture.ceiling.opacity = clamp(next.architecture.ceiling.opacity, 0, 1);
  next.architecture.ceiling.panelWidthM = clamp(next.architecture.ceiling.panelWidthM, 0.3, 3);
  next.architecture.ceiling.panelDepthM = clamp(next.architecture.ceiling.panelDepthM, 0.3, 3);
  next.architecture.ceiling.heightM = clamp(next.architecture.ceiling.heightM, 2, next.room.heightM);
  next.visibility.racks.opacity = clamp(next.visibility.racks.opacity, 0, 1);
  next.visibility.fanWalls.opacity = clamp(next.visibility.fanWalls.opacity, 0, 1);
  next.visibility.pillars.opacity = clamp(next.visibility.pillars.opacity, 0, 1);
  next.elements = next.elements.map((element) => clampElementToRoom(element, next.room));

  for (const element of next.elements) {
    if (isAtRoomLimit(element, next.room)) {
      warnings.push(`${element.label} foi limitado aos contornos da sala.`);
    }
    if (element.heightM > next.room.heightM) {
      warnings.push(`${element.label} excede a altura da sala.`);
    }
  }

  for (let index = 0; index < next.elements.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < next.elements.length; otherIndex += 1) {
      const first = next.elements[index];
      const second = next.elements[otherIndex];
      if (overlaps(first, second)) {
        warnings.push(`Sobreposicao detectada entre ${first.label} e ${second.label}.`);
      }
    }
  }

  next.warnings = [...new Set(warnings)];
  return next;
}

export function calculateStats(project: DataHallProject): LayoutStats {
  const racks = project.elements.filter((element) => element.type === "rack");
  const fanWalls = project.elements.filter((element) => element.type === "fanWall");
  const pillars = project.elements.filter((element) => element.type === "pillar");
  const roomAreaM2 = project.room.widthM * project.room.lengthM;
  const occupiedAreaM2 = project.elements.reduce((sum, element) => sum + element.widthM * element.depthM, 0);
  const totalPowerKw = racks.reduce((sum, rack) => sum + (rack.powerKw ?? 0), 0);

  return {
    rackCount: racks.length,
    fanWallCount: fanWalls.length,
    pillarCount: pillars.length,
    totalPowerKw,
    totalAirflowM3h: fanWalls.reduce((sum, fanWall) => sum + (fanWall.airflowM3h ?? 0), 0),
    roomAreaM2,
    occupiedAreaM2,
    occupiedPercent: roomAreaM2 > 0 ? (occupiedAreaM2 / roomAreaM2) * 100 : 0,
    alerts: project.warnings
  };
}

export function overlaps(first: DataHallElement, second: DataHallElement): boolean {
  return (
    first.x < second.x + second.widthM &&
    first.x + first.widthM > second.x &&
    first.y < second.y + second.depthM &&
    first.y + first.depthM > second.y
  );
}

function arrangeRackRows(project: DataHallProject, racks: DataHallElement[]): DataHallElement[] {
  if (racks.length === 0) return [];
  const rows = Math.min(project.settings.rackRows, racks.length);
  const rowCounts = distribute(racks.length, rows);
  const maxCount = Math.max(...rowCounts);
  const totalDepth =
    rows * project.rackDefaults.depthM +
    Array.from({ length: rows - 1 }, (_, index) =>
      index % 2 === 0 ? project.settings.coldAisleM : project.settings.hotAisleM
    ).reduce((sum, value) => sum + value, 0);
  let rackIndex = 0;
  let y = Math.max(project.settings.wallClearanceM, (project.room.lengthM - totalDepth) / 2);
  const result: DataHallElement[] = [];

  for (let row = 0; row < rows; row += 1) {
    const count = rowCounts[row];
    const rowWidth = count * project.rackDefaults.widthM;
    const xStart = Math.max(project.settings.wallClearanceM, (project.room.widthM - rowWidth) / 2);
    const orientation: Orientation = row % 2 === 0 ? "north" : "south";

    for (let column = 0; column < count; column += 1) {
      const source = racks[rackIndex];
      result.push(
        clampElementToRoom(
          {
            ...source,
            label: source.label || `R${rackIndex + 1}`,
            x: round(xStart + column * project.rackDefaults.widthM),
            y: round(y),
            z: 0,
            widthM: project.rackDefaults.widthM,
            depthM: project.rackDefaults.depthM,
            heightM: project.rackDefaults.heightM,
            rotation: orientationToRotation(orientation),
            orientation,
            powerKw: project.rackDefaults.powerKw,
            row: row + 1
          },
          project.room
        )
      );
      rackIndex += 1;
    }

    y += project.rackDefaults.depthM;
    if (row < rows - 1) y += row % 2 === 0 ? project.settings.coldAisleM : project.settings.hotAisleM;
  }

  return result;
}

function arrangeFanWalls(project: DataHallProject, fanWalls: DataHallElement[]): DataHallElement[] {
  if (fanWalls.length === 0) return [];
  const wall = project.fanWallDefaults.wall;
  const horizontal = wall === "north" || wall === "south";
  const wallLength = horizontal ? project.room.widthM : project.room.lengthM;
  const span = project.fanWallDefaults.widthM;
  const gap = Math.max(0, (wallLength - fanWalls.length * span) / (fanWalls.length + 1));

  return fanWalls.map((source, index) => {
    const along = gap + index * (span + gap);
    const element = {
      ...source,
      label: source.label || `FW${index + 1}`,
      widthM: horizontal ? project.fanWallDefaults.widthM : project.fanWallDefaults.depthM,
      depthM: horizontal ? project.fanWallDefaults.depthM : project.fanWallDefaults.widthM,
      heightM: project.fanWallDefaults.heightM,
      airflowM3h: project.fanWallDefaults.airflowM3h,
      wall,
      orientation: wallToOrientation(wall),
      rotation: orientationToRotation(wallToOrientation(wall)),
      x: wall === "east" ? project.room.widthM - project.fanWallDefaults.depthM : wall === "west" ? 0 : along,
      y: wall === "south" ? project.room.lengthM - project.fanWallDefaults.depthM : wall === "north" ? 0 : along,
      z: 0
    };
    return clampElementToRoom(element, project.room);
  });
}

function arrangePillars(project: DataHallProject, pillars: DataHallElement[]): DataHallElement[] {
  if (pillars.length === 0) return [];
  const columns = Math.min(project.pillarDefaults.columns, pillars.length);
  const rows = Math.ceil(pillars.length / columns);
  const usableWidth = Math.max(0, project.room.widthM - project.settings.wallClearanceM * 2 - project.pillarDefaults.widthM);
  const usableLength = Math.max(0, project.room.lengthM - project.settings.wallClearanceM * 2 - project.pillarDefaults.depthM);
  const xStep = columns > 1 ? usableWidth / (columns - 1) : 0;
  const yStep = rows > 1 ? usableLength / (rows - 1) : 0;

  return pillars.map((source, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return clampElementToRoom(
      {
        ...source,
        label: source.label || `P${index + 1}`,
        x: round(project.settings.wallClearanceM + column * xStep),
        y: round(project.settings.wallClearanceM + row * yStep),
        z: 0,
        widthM: project.pillarDefaults.widthM,
        depthM: project.pillarDefaults.depthM,
        heightM: project.pillarDefaults.heightM,
        rotation: orientationToRotation(project.pillarDefaults.orientation),
        orientation: project.pillarDefaults.orientation
      },
      project.room
    );
  });
}

function createRacks(project: DataHallProject, count: number): DataHallElement[] {
  const start = nextIndex(project.elements, "rack");
  return Array.from({ length: clampInt(count, 0, 2000) }, (_, index) => ({
    id: `rack-${start + index}`,
    type: "rack",
    label: `R${start + index}`,
    x: 0,
    y: 0,
    z: 0,
    widthM: project.rackDefaults.widthM,
    depthM: project.rackDefaults.depthM,
    heightM: project.rackDefaults.heightM,
    rotation: orientationToRotation(project.rackDefaults.orientation),
    orientation: project.rackDefaults.orientation,
    powerKw: project.rackDefaults.powerKw
  }));
}

function createFanWalls(project: DataHallProject, count: number): DataHallElement[] {
  const start = nextIndex(project.elements, "fan-wall");
  return Array.from({ length: clampInt(count, 0, 100) }, (_, index) => ({
    id: `fan-wall-${start + index}`,
    type: "fanWall",
    label: `FW${start + index}`,
    x: 0,
    y: 0,
    z: 0,
    widthM: project.fanWallDefaults.widthM,
    depthM: project.fanWallDefaults.depthM,
    heightM: project.fanWallDefaults.heightM,
    rotation: orientationToRotation(project.fanWallDefaults.orientation),
    orientation: project.fanWallDefaults.orientation,
    airflowM3h: project.fanWallDefaults.airflowM3h,
    wall: project.fanWallDefaults.wall
  }));
}

function createPillars(project: DataHallProject, count: number): DataHallElement[] {
  const start = nextIndex(project.elements, "pillar");
  return Array.from({ length: clampInt(count, 0, 400) }, (_, index) => ({
    id: `pillar-${start + index}`,
    type: "pillar",
    label: `P${start + index}`,
    x: 0,
    y: 0,
    z: 0,
    widthM: project.pillarDefaults.widthM,
    depthM: project.pillarDefaults.depthM,
    heightM: project.pillarDefaults.heightM,
    rotation: orientationToRotation(project.pillarDefaults.orientation),
    orientation: project.pillarDefaults.orientation
  }));
}

function updateRackDefaults(project: DataHallProject, command: Extract<StructuredCommand, { type: "add_racks" }>) {
  if (isPositive(command.widthM)) project.rackDefaults.widthM = clamp(command.widthM, 0.3, 3);
  if (isPositive(command.depthM)) project.rackDefaults.depthM = clamp(command.depthM, 0.4, 4);
  if (isPositive(command.heightM)) project.rackDefaults.heightM = clamp(command.heightM, 0.5, 6);
  if (isFiniteNumber(command.powerKw)) project.rackDefaults.powerKw = clamp(command.powerKw, 0, 1000);
  if (command.orientation) project.rackDefaults.orientation = command.orientation;
}

function updateFanWallDefaults(project: DataHallProject, command: Extract<StructuredCommand, { type: "add_fan_walls" }>) {
  if (isPositive(command.widthM)) project.fanWallDefaults.widthM = clamp(command.widthM, 0.3, 10);
  if (isPositive(command.depthM)) project.fanWallDefaults.depthM = clamp(command.depthM, 0.2, 5);
  if (isPositive(command.heightM)) project.fanWallDefaults.heightM = clamp(command.heightM, 0.5, 10);
  if (isFiniteNumber(command.airflowM3h)) project.fanWallDefaults.airflowM3h = clamp(command.airflowM3h, 0, 500000);
  if (command.wall) project.fanWallDefaults.wall = command.wall;
  if (command.orientation) project.fanWallDefaults.orientation = command.orientation;
}

function updatePillarDefaults(
  project: DataHallProject,
  command: Extract<StructuredCommand, { type: "add_pillars" | "create_pillar_grid" }>
) {
  if (isFiniteNumber(command.count)) project.pillarDefaults.count = clampInt(command.count, 0, 400);
  if (isPositive(command.columns)) project.pillarDefaults.columns = clampInt(command.columns, 1, 50);
  if (isPositive(command.widthM)) project.pillarDefaults.widthM = clamp(command.widthM, 0.1, 5);
  if (isPositive(command.depthM)) project.pillarDefaults.depthM = clamp(command.depthM, 0.1, 5);
  if (isPositive(command.heightM)) project.pillarDefaults.heightM = clamp(command.heightM, 0.5, 30);
  if (command.orientation) project.pillarDefaults.orientation = command.orientation;
}

function resizeRoom(room: Room, candidate: Partial<Room>): Room {
  return {
    widthM: clamp(Number(candidate.widthM ?? room.widthM), ...ROOM_LIMITS.widthM),
    lengthM: clamp(Number(candidate.lengthM ?? room.lengthM), ...ROOM_LIMITS.lengthM),
    heightM: clamp(Number(candidate.heightM ?? room.heightM), ...ROOM_LIMITS.heightM)
  };
}

function clampElementToRoom(element: DataHallElement, room: Room): DataHallElement {
  return {
    ...element,
    x: round(clamp(element.x, 0, Math.max(0, room.widthM - element.widthM))),
    y: round(clamp(element.y, 0, Math.max(0, room.lengthM - element.depthM))),
    z: round(clamp(element.z, 0, Math.max(0, room.heightM - element.heightM)))
  };
}

function isAtRoomLimit(element: DataHallElement, room: Room): boolean {
  return (
    element.x < 0 ||
    element.y < 0 ||
    element.x + element.widthM > room.widthM ||
    element.y + element.depthM > room.lengthM
  );
}

function normalizeElement(element: unknown): DataHallElement | null {
  if (!element || typeof element !== "object") return null;
  const value = element as DataHallElement;
  if (value.type !== "rack" && value.type !== "fanWall" && value.type !== "pillar") return null;
  return {
    ...value,
    id: String(value.id || `${value.type}-${cryptoSafeId()}`),
    label: String(value.label || value.id || value.type),
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    z: Number(value.z) || 0,
    widthM: Number(value.widthM) || 1,
    depthM: Number(value.depthM) || 1,
    heightM: Number(value.heightM) || 1,
    rotation: normalizeRotation(Number(value.rotation) || 0),
    orientation: value.orientation || rotationToOrientation(Number(value.rotation) || 0)
  };
}

function isElement(element: DataHallElement | null): element is DataHallElement {
  return element !== null;
}

function distribute(count: number, rows: number): number[] {
  const base = Math.floor(count / rows);
  const remainder = count % rows;
  return Array.from({ length: rows }, (_, index) => base + (index < remainder ? 1 : 0));
}

function nextIndex(elements: DataHallElement[], prefix: string): number {
  const values = elements
    .map((element) => (element.id.startsWith(prefix) ? Number(element.id.split("-").at(-1)) : 0))
    .filter(Number.isFinite);
  return Math.max(0, ...values) + 1;
}

function orientationToRotation(orientation: Orientation): number {
  const rotations: Record<Orientation, number> = { north: 0, east: 90, south: 180, west: 270 };
  return rotations[orientation];
}

function rotationToOrientation(rotation: number): Orientation {
  return ({ 0: "north", 90: "east", 180: "south", 270: "west" } as const)[normalizeRotation(rotation)] ?? "north";
}

function wallToOrientation(wall: Wall): Orientation {
  const orientations: Record<Wall, Orientation> = { north: "south", south: "north", east: "west", west: "east" };
  return orientations[wall];
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  return normalized as 0 | 90 | 180 | 270;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cryptoSafeId(): string {
  return Math.random().toString(36).slice(2, 8);
}
