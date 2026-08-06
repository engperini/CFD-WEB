export function createDefaultProject() {
  return {
    version: 1,
    name: "Novo Data Hall",
    room: { widthM: 18, lengthM: 24, heightM: 5 },
    rackConfig: {
      count: 24,
      rows: 4,
      widthM: 0.6,
      depthM: 1.2,
      heightM: 2.2,
      powerKw: 20
    },
    fanWallConfig: {
      count: 4,
      wall: "north",
      widthM: 1.2,
      depthM: 0.6,
      heightM: 3.2,
      airflowM3h: 18000
    },
    aisles: { coldM: 1.2, hotM: 1.0, perimeterM: 1.0 },
    optimizationMode: "balanced",
    elements: [],
    warnings: []
  };
}

export function applyActions(project, actions) {
  const next = structuredClone(project);

  for (const action of actions || []) {
    switch (action.type) {
      case "set_room":
        setFinite(next.room, "widthM", action.widthM, 3, 200);
        setFinite(next.room, "lengthM", action.lengthM, 3, 300);
        setFinite(next.room, "heightM", action.heightM, 2, 20);
        break;
      case "configure_racks":
        setInteger(next.rackConfig, "count", action.count, 0, 2000);
        setInteger(next.rackConfig, "rows", action.rows, 1, 100);
        setFinite(next.rackConfig, "widthM", action.widthM, 0.3, 3);
        setFinite(next.rackConfig, "depthM", action.depthM, 0.4, 4);
        setFinite(next.rackConfig, "heightM", action.heightM, 0.5, 6);
        setFinite(next.rackConfig, "powerKw", action.powerKw, 0, 1000);
        break;
      case "configure_fan_walls":
        setInteger(next.fanWallConfig, "count", action.count, 0, 100);
        setFinite(next.fanWallConfig, "widthM", action.widthM, 0.3, 10);
        setFinite(next.fanWallConfig, "depthM", action.depthM, 0.2, 5);
        setFinite(next.fanWallConfig, "heightM", action.heightM, 0.5, 10);
        setFinite(next.fanWallConfig, "airflowM3h", action.airflowM3h, 0, 500000);
        if (["north", "south", "east", "west"].includes(action.wall)) {
          next.fanWallConfig.wall = action.wall;
        }
        break;
      case "set_aisles":
        setFinite(next.aisles, "coldM", action.coldM, 0.4, 10);
        setFinite(next.aisles, "hotM", action.hotM, 0.4, 10);
        setFinite(next.aisles, "perimeterM", action.perimeterM, 0, 10);
        break;
      case "optimize_layout":
        if (["balanced", "capacity", "maintenance"].includes(action.mode)) {
          next.optimizationMode = action.mode;
        }
        break;
      case "clear":
        if (action.target === "racks" || action.target === "all") next.rackConfig.count = 0;
        if (action.target === "fanWalls" || action.target === "all") next.fanWallConfig.count = 0;
        break;
    }
  }

  return autoArrange(next);
}

export function autoArrange(project) {
  const next = structuredClone(project);
  const { room, rackConfig, fanWallConfig, aisles } = next;
  const warnings = [];
  const elements = [];

  const rows = Math.max(1, Math.min(rackConfig.rows, Math.max(1, rackConfig.count)));
  const basePerRow = Math.floor(rackConfig.count / rows);
  const remainder = rackConfig.count % rows;
  const rowCounts = Array.from({ length: rows }, (_, index) => basePerRow + (index < remainder ? 1 : 0));
  const maxRowCount = Math.max(0, ...rowCounts);

  const availableWidth = room.widthM - 2 * aisles.perimeterM;
  const rackSpan = maxRowCount * rackConfig.widthM;
  let rackGap = maxRowCount > 1 ? (availableWidth - rackSpan) / (maxRowCount - 1) : 0;
  if (rackGap < 0) {
    warnings.push("Os racks não cabem na largura disponível mantendo o perímetro informado.");
    rackGap = 0;
  }
  rackGap = Math.min(Math.max(rackGap, 0), 0.25);

  const rowAisles = Array.from({ length: Math.max(0, rows - 1) }, (_, index) =>
    index % 2 === 0 ? aisles.coldM : aisles.hotM
  );
  const totalDepth = rows * rackConfig.depthM + rowAisles.reduce((sum, value) => sum + value, 0);
  const availableLength = room.lengthM - 2 * aisles.perimeterM;
  if (totalDepth > availableLength) {
    warnings.push("As fileiras e os corredores não cabem no comprimento disponível.");
  }

  const startY = Math.max(aisles.perimeterM, (room.lengthM - totalDepth) / 2);
  let y = startY;
  let rackIndex = 0;

  for (let row = 0; row < rows; row += 1) {
    const count = rowCounts[row];
    const rowWidth = count * rackConfig.widthM + Math.max(0, count - 1) * rackGap;
    const startX = Math.max(aisles.perimeterM, (room.widthM - rowWidth) / 2);
    const rotation = row % 2 === 0 ? 0 : 180;

    for (let column = 0; column < count; column += 1) {
      elements.push({
        id: `rack-${rackIndex + 1}`,
        type: "rack",
        label: `R${String(rackIndex + 1).padStart(2, "0")}`,
        x: round(startX + column * (rackConfig.widthM + rackGap)),
        y: round(y),
        z: 0,
        widthM: rackConfig.widthM,
        depthM: rackConfig.depthM,
        heightM: rackConfig.heightM,
        rotation,
        powerKw: rackConfig.powerKw,
        row: row + 1
      });
      rackIndex += 1;
    }

    y += rackConfig.depthM;
    if (row < rowAisles.length) y += rowAisles[row];
  }

  elements.push(...arrangeFanWalls(room, fanWallConfig, warnings));

  next.rackConfig.rows = rows;
  next.elements = elements;
  next.warnings = warnings;
  return next;
}

function arrangeFanWalls(room, config, warnings) {
  const result = [];
  if (config.count <= 0) return result;

  const horizontal = config.wall === "north" || config.wall === "south";
  const wallLength = horizontal ? room.widthM : room.lengthM;
  const unitSpan = config.widthM;
  const totalSpan = config.count * unitSpan;

  if (totalSpan > wallLength) {
    warnings.push(`Os fan walls excedem a dimensão da parede ${wallLabel(config.wall)}.`);
  }

  const gap = Math.max(0, (wallLength - totalSpan) / (config.count + 1));

  for (let index = 0; index < config.count; index += 1) {
    const along = gap + index * (unitSpan + gap);
    let x;
    let y;
    let widthM;
    let depthM;
    let rotation;

    if (config.wall === "north") {
      x = along;
      y = 0;
      widthM = config.widthM;
      depthM = config.depthM;
      rotation = 0;
    } else if (config.wall === "south") {
      x = along;
      y = room.lengthM - config.depthM;
      widthM = config.widthM;
      depthM = config.depthM;
      rotation = 180;
    } else if (config.wall === "west") {
      x = 0;
      y = along;
      widthM = config.depthM;
      depthM = config.widthM;
      rotation = 90;
    } else {
      x = room.widthM - config.depthM;
      y = along;
      widthM = config.depthM;
      depthM = config.widthM;
      rotation = 270;
    }

    result.push({
      id: `fan-wall-${index + 1}`,
      type: "fanWall",
      label: `FW${index + 1}`,
      x: round(x),
      y: round(y),
      z: 0,
      widthM,
      depthM,
      heightM: config.heightM,
      rotation,
      airflowM3h: config.airflowM3h,
      wall: config.wall
    });
  }

  return result;
}

export function calculateStats(project) {
  const racks = project.elements.filter((element) => element.type === "rack");
  const fanWalls = project.elements.filter((element) => element.type === "fanWall");
  const roomArea = project.room.widthM * project.room.lengthM;
  const rackArea = racks.reduce((sum, rack) => sum + rack.widthM * rack.depthM, 0);

  return {
    rackCount: racks.length,
    fanWallCount: fanWalls.length,
    totalPowerKw: racks.reduce((sum, rack) => sum + (rack.powerKw || 0), 0),
    totalAirflowM3h: fanWalls.reduce((sum, fan) => sum + (fan.airflowM3h || 0), 0),
    roomAreaM2: roomArea,
    occupiedPercent: roomArea > 0 ? (rackArea / roomArea) * 100 : 0,
    densityKwM2:
      roomArea > 0
        ? racks.reduce((sum, rack) => sum + (rack.powerKw || 0), 0) / roomArea
        : 0
  };
}

export function moveElement(project, id, x, y) {
  const next = structuredClone(project);
  const element = next.elements.find((item) => item.id === id);
  if (!element) return next;

  element.x = round(clamp(x, 0, Math.max(0, next.room.widthM - element.widthM)));
  element.y = round(clamp(y, 0, Math.max(0, next.room.lengthM - element.depthM)));
  return next;
}

function setFinite(target, field, candidate, min, max) {
  const value = Number(candidate);
  if (Number.isFinite(value)) target[field] = clamp(value, min, max);
}

function setInteger(target, field, candidate, min, max) {
  const value = Number(candidate);
  if (Number.isFinite(value)) target[field] = Math.round(clamp(value, min, max));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function wallLabel(wall) {
  return { north: "norte", south: "sul", east: "leste", west: "oeste" }[wall] || wall;
}
