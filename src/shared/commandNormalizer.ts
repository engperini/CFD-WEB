import type { StructuredCommand } from "./types.js";

type ProjectContext = {
  settings?: {
    rackRows?: unknown;
  };
};

const TYPE_ALIASES: Record<string, StructuredCommand["type"]> = {
  set_room: "resize_room",
  configure_room: "resize_room",
  room: "resize_room",
  create_racks: "add_racks",
  configure_racks: "add_racks",
  set_racks: "add_racks",
  racks: "add_racks",
  rack_rows: "create_rack_rows",
  set_rack_rows: "create_rack_rows",
  configure_rack_rows: "create_rack_rows",
  create_fan_wall: "add_fan_walls",
  create_fan_walls: "add_fan_walls",
  configure_fan_walls: "add_fan_walls",
  set_fan_walls: "add_fan_walls",
  fan_walls: "add_fan_walls",
  pillar: "add_pillars",
  pillars: "add_pillars",
  pilar: "add_pillars",
  pilares: "add_pillars",
  add_pillar: "add_pillars",
  add_columns: "add_pillars",
  create_pillars: "add_pillars",
  concrete_pillars: "add_pillars",
  create_pillar_grid: "create_pillar_grid",
  pillar_grid: "create_pillar_grid",
  distribute_pillars: "create_pillar_grid",
  set_aisles: "set_aisle_width",
  configure_aisles: "set_aisle_width",
  set_aisle_widths: "set_aisle_width",
  optimize_layout: "auto_arrange",
  arrange_layout: "auto_arrange",
  organize_layout: "auto_arrange",
  delete: "delete_element",
  remove_element: "delete_element",
  clear: "clear_layout",
  reset_layout: "clear_layout",
  move: "move_element",
  rotate: "rotate_element"
};

const ALLOWED_TYPES = new Set<StructuredCommand["type"]>([
  "create_room",
  "resize_room",
  "add_racks",
  "create_rack_rows",
  "add_fan_walls",
  "add_pillars",
  "create_pillar_grid",
  "move_element",
  "rotate_element",
  "set_aisle_width",
  "set_wall_clearance",
  "auto_arrange",
  "delete_element",
  "clear_layout",
  "undo",
  "redo"
]);

export function normalizeAiCommands(candidate: unknown, project?: unknown, sourceText = ""): unknown[] {
  const list = Array.isArray(candidate) ? candidate : candidate && typeof candidate === "object" ? [candidate] : [];
  const context = normalizeProjectContext(project);
  const normalized = list.flatMap((item) => normalizeCommand(item, context));
  return applyTextHeuristics(normalized, context, sourceText);
}

function normalizeCommand(candidate: unknown, project?: ProjectContext): unknown[] {
  if (!candidate || typeof candidate !== "object") return [];
  const input = candidate as Record<string, unknown>;
  const type = normalizeType(input.type ?? input.command ?? input.action ?? input.name);
  if (!type) return [];

  const command: Record<string, unknown> = { type };
  copyNumber(input, command, "widthM", ["widthM", "width", "largura", "roomWidth", "room_width"]);
  copyNumber(input, command, "lengthM", ["lengthM", "length", "comprimento", "roomLength", "room_length"]);
  copyNumber(input, command, "heightM", ["heightM", "height", "altura", "roomHeight", "room_height"]);
  copyNumber(input, command, "depthM", ["depthM", "depth", "profundidade"]);
  copyNumber(input, command, "powerKw", ["powerKw", "powerKW", "power_kw", "power", "potenciaKw", "potencia_kW", "potencia"]);
  copyNumber(input, command, "airflowM3h", ["airflowM3h", "airflow", "airflow_m3h", "vazao", "vazaoM3h"]);
  copyNumber(input, command, "coldAisleM", ["coldAisleM", "coldM", "cold_aisle_m", "corredorFrio", "corredor_frio"]);
  copyNumber(input, command, "hotAisleM", ["hotAisleM", "hotM", "hot_aisle_m", "corredorQuente", "corredor_quente"]);
  copyNumber(input, command, "wallClearanceM", ["wallClearanceM", "perimeterM", "perimeter", "afastamento", "afastamentoParede"]);
  copyNumber(input, command, "x", ["x"]);
  copyNumber(input, command, "y", ["y"]);
  copyNumber(input, command, "z", ["z"]);
  copyNumber(input, command, "rotation", ["rotation", "rotacao"]);
  copyInteger(input, command, "rows", ["rows", "rowCount", "rackRows", "fileiras", "quantidadeFileiras"]);
  copyInteger(input, command, "columns", ["columns", "columnCount", "pillarColumns", "colunas", "quantidadeColunas"]);
  copyInteger(input, command, "count", ["count", "quantity", "quantidade", "rackCount", "rack_count", "fanWallCount"]);

  const rows = readNumber(input, ["rows", "rowCount", "rackRows", "fileiras", "quantidadeFileiras"]) ?? readContextRows(project);
  const perRow = readNumber(input, ["racksPerRow", "racks_per_row", "countPerRow", "count_per_row", "porFileira", "por_fileira"]);
  if ((type === "add_racks" || type === "create_rack_rows") && perRow !== undefined && rows !== undefined) {
    command.count = Math.round(perRow * rows);
    if (type === "create_rack_rows") command.rows = Math.round(rows);
  }

  const wall = normalizeWall(readString(input, ["wall", "parede"]));
  if (wall) command.wall = wall;
  const orientation = normalizeOrientation(readString(input, ["orientation", "orientacao"]));
  if (orientation) command.orientation = orientation;
  const target = normalizeTarget(readString(input, ["target", "alvo"]));
  if (target) command.target = target;
  const id = readString(input, ["id", "elementId", "element_id", "equipamento"]);
  if (id) command.id = id;

  return [command];
}

function applyTextHeuristics(commands: unknown[], project?: ProjectContext, sourceText = ""): unknown[] {
  const text = normalizeText(sourceText);
  const perRowMatch = text.match(/(\d+(?:[.,]\d+)?)\s*racks?\s*(?:em|por)\s*cada\s*fileira/);
  const powerMatch = text.match(/(\d+(?:[.,]\d+)?)\s*k\s*w/);
  if (!perRowMatch) return commands;

  const rows = readContextRows(project) ?? 1;
  const total = Math.round(parseNumber(perRowMatch[1]) * rows);
  const powerKw = powerMatch ? parseNumber(powerMatch[1]) : undefined;
  const withoutRackCommands = commands.filter((command) => {
    if (!command || typeof command !== "object") return true;
    return !["add_racks", "create_rack_rows"].includes(String((command as { type?: unknown }).type));
  });

  return [
    { type: "add_racks", count: total, ...(powerKw !== undefined ? { powerKw } : {}) },
    { type: "create_rack_rows", count: total, rows },
    { type: "auto_arrange" },
    ...withoutRackCommands
  ];
}

function normalizeType(value: unknown): StructuredCommand["type"] | null {
  const key = normalizeKey(String(value || ""));
  const type = TYPE_ALIASES[key] ?? key;
  return ALLOWED_TYPES.has(type as StructuredCommand["type"]) ? (type as StructuredCommand["type"]) : null;
}

function copyNumber(input: Record<string, unknown>, output: Record<string, unknown>, target: string, aliases: string[]) {
  const value = readNumber(input, aliases);
  if (value !== undefined) output[target] = value;
}

function copyInteger(input: Record<string, unknown>, output: Record<string, unknown>, target: string, aliases: string[]) {
  const value = readNumber(input, aliases);
  if (value !== undefined) output[target] = Math.round(value);
}

function readNumber(input: Record<string, unknown>, aliases: string[]): number | undefined {
  for (const alias of aliases) {
    const value = input[alias];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = parseNumber(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readString(input: Record<string, unknown>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = input[alias];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readContextRows(project?: ProjectContext): number | undefined {
  const rows = Number(project?.settings?.rackRows);
  return Number.isFinite(rows) && rows > 0 ? Math.round(rows) : undefined;
}

function normalizeProjectContext(project: unknown): ProjectContext | undefined {
  return project && typeof project === "object" ? (project as ProjectContext) : undefined;
}

function parseNumber(value: string): number {
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function normalizeWall(value: string) {
  const key = normalizeKey(value);
  return ({ norte: "north", sul: "south", leste: "east", oeste: "west", north: "north", south: "south", east: "east", west: "west" } as const)[key];
}

function normalizeOrientation(value: string) {
  return normalizeWall(value);
}

function normalizeTarget(value: string) {
  const key = normalizeKey(value);
  return ({
    all: "all",
    tudo: "all",
    racks: "racks",
    rack: "racks",
    fanwalls: "fanWalls",
    fan_walls: "fanWalls",
    fanwall: "fanWalls",
    pillars: "pillars",
    pillar: "pillars",
    pilares: "pillars",
    pilar: "pillars"
  } as const)[key];
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
