import { describe, expect, it } from "vitest";
import {
  applyCommands,
  autoArrange,
  calculateStats,
  createDefaultProject,
  moveElement,
  overlaps
} from "../src/shared/layoutEngine";
import { normalizeAiCommands } from "../src/shared/commandNormalizer";
import { getSectionElements } from "../src/shared/sectionEngine";

describe("layoutEngine", () => {
  it("organiza racks e fan walls automaticamente", () => {
    const project = autoArrange(
      applyCommands(createDefaultProject(), [
        { type: "add_racks", count: 24 },
        { type: "add_fan_walls", count: 4 }
      ])
    );
    const stats = calculateStats(project);

    expect(stats.rackCount).toBe(24);
    expect(stats.fanWallCount).toBe(4);
    expect(stats.totalPowerKw).toBe(480);
  });

  it("aplica comandos estruturados esperados do MVP", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "create_room", widthM: 20, lengthM: 30, heightM: 6 },
      { type: "add_racks", count: 32, widthM: 0.6, depthM: 1.2, heightM: 2.2, powerKw: 40 },
      { type: "create_rack_rows", rows: 4, coldAisleM: 1.2, hotAisleM: 1 },
      { type: "add_fan_walls", count: 6, wall: "south" },
      { type: "set_wall_clearance", wallClearanceM: 1 },
      { type: "auto_arrange" }
    ]);

    expect(project.room).toEqual({ widthM: 20, lengthM: 30, heightM: 6 });
    expect(project.elements.filter((element) => element.type === "rack")).toHaveLength(32);
    expect(project.elements.filter((element) => element.type === "fanWall")).toHaveLength(6);
    expect(calculateStats(project).totalPowerKw).toBe(1280);
  });

  it("mantem elementos arrastados dentro da sala", () => {
    const project = applyCommands(createDefaultProject(), [{ type: "add_racks", count: 1 }, { type: "auto_arrange" }]);
    const rack = project.elements.find((element) => element.type === "rack");
    expect(rack).toBeDefined();

    const moved = moveElement(project, rack!.id, 1000, -1000);
    const movedRack = moved.elements.find((element) => element.id === rack!.id)!;

    expect(movedRack.y).toBe(0);
    expect(movedRack.x).toBe(project.room.widthM - movedRack.widthM);
  });

  it("mantem racks da mesma fileira encostados", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "add_racks", count: 4, widthM: 0.6 },
      { type: "create_rack_rows", rows: 1 },
      { type: "auto_arrange" }
    ]);
    const racks = project.elements
      .filter((element) => element.type === "rack")
      .sort((first, second) => first.x - second.x);

    expect(racks[1].x - racks[0].x).toBeCloseTo(racks[0].widthM);
    expect(racks[2].x - racks[1].x).toBeCloseTo(racks[1].widthM);
    expect(racks[3].x - racks[2].x).toBeCloseTo(racks[2].widthM);
  });

  it("mantem 23 racks em 2 fileiras sem vao lateral", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "add_racks", count: 23, widthM: 0.6 },
      { type: "create_rack_rows", rows: 2 },
      { type: "auto_arrange" }
    ]);
    const firstRow = project.elements
      .filter((element) => element.type === "rack" && element.row === 1)
      .sort((first, second) => first.x - second.x);

    for (let index = 1; index < firstRow.length; index += 1) {
      expect(firstRow[index].x - firstRow[index - 1].x).toBeCloseTo(firstRow[index - 1].widthM);
    }
  });

  it("detecta sobreposicao entre elementos", () => {
    const withRacks = applyCommands(createDefaultProject(), [{ type: "add_racks", count: 2 }]);
    const project = applyCommands(withRacks, [
      { type: "move_element", id: "rack-1", x: 1, y: 1 },
      { type: "move_element", id: "rack-2", x: 1.2, y: 1.1 }
    ]);
    const [first, second] = project.elements;

    expect(overlaps(first, second)).toBe(true);
    expect(project.warnings.some((warning) => warning.includes("Sobreposicao"))).toBe(true);
  });

  it("reduz a quantidade de racks ao recriar fileiras", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "add_racks", count: 10 },
      { type: "create_rack_rows", count: 4, rows: 2 },
      { type: "auto_arrange" }
    ]);

    expect(project.elements.filter((element) => element.type === "rack")).toHaveLength(4);
  });

  it("deleta um equipamento por id", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "add_racks", count: 2 },
      { type: "delete_element", id: "rack-1" }
    ]);

    expect(project.elements.map((element) => element.id)).toEqual(["rack-2"]);
  });

  it("permite reduzir fan walls limpando e recriando o conjunto", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "add_fan_walls", count: 4 },
      { type: "clear_layout", target: "fanWalls" },
      { type: "add_fan_walls", count: 2 },
      { type: "auto_arrange" }
    ]);

    expect(project.elements.filter((element) => element.type === "fanWall")).toHaveLength(2);
  });

  it("cria pilares retangulares em malha automatica", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "create_pillar_grid", count: 6, columns: 3, widthM: 0.5, depthM: 0.7, heightM: 5 },
      { type: "auto_arrange" }
    ]);
    const pillars = project.elements.filter((element) => element.type === "pillar");

    expect(pillars).toHaveLength(6);
    expect(pillars[0]).toMatchObject({ widthM: 0.5, depthM: 0.7, heightM: 5 });
    expect(calculateStats(project).pillarCount).toBe(6);
  });

  it("reduz pilares ao recriar a malha", () => {
    const project = applyCommands(createDefaultProject(), [
      { type: "create_pillar_grid", count: 8, columns: 4 },
      { type: "create_pillar_grid", count: 3, columns: 3 },
      { type: "auto_arrange" }
    ]);

    expect(project.elements.filter((element) => element.type === "pillar")).toHaveLength(3);
  });

  it("normaliza resposta da IA com aliases e valores com unidade", () => {
    const commands = normalizeAiCommands([
      { type: "configure_racks", quantidade: "24 racks", potencia: "30kW" }
    ]);

    expect(commands).toEqual([{ type: "add_racks", count: 24, powerKw: 30 }]);
  });

  it("normaliza aliases de pilares da IA", () => {
    const commands = normalizeAiCommands([
      { type: "pilares", quantidade: "6", colunas: "3", largura: "0,5 m", profundidade: "0,7 m", altura: "5 m" }
    ]);

    expect(commands).toEqual([{ type: "add_pillars", count: 6, columns: 3, widthM: 0.5, depthM: 0.7, heightM: 5 }]);
  });

  it("interpreta racks por fileira a partir do texto do usuario", () => {
    const commands = normalizeAiCommands(
      [{ type: "add_racks", count: 24, power_kw: "30kW" }],
      { settings: { rackRows: 2 } },
      "quero 24 rack em cada fileira sendo todos racks de 30kW"
    );

    expect(commands).toEqual([
      { type: "add_racks", count: 48, powerKw: 30 },
      { type: "create_rack_rows", count: 48, rows: 2 },
      { type: "auto_arrange" }
    ]);
  });

  it("projeta no corte longitudinal os equipamentos a esquerda da linha", () => {
    const arranged = applyCommands(createDefaultProject(), [
      { type: "add_racks", count: 4 },
      { type: "create_rack_rows", rows: 1 },
      { type: "auto_arrange" }
    ]);
    const project = applyCommands(arranged, [
      { type: "move_element", id: "rack-1", x: 2, y: 1 },
      { type: "move_element", id: "rack-2", x: 4, y: 18 },
      { type: "move_element", id: "rack-3", x: 14, y: 1 }
    ]);

    const elements = getSectionElements(project, { axis: "x", positionM: 10 });

    expect(elements.map((element) => element.id)).toContain("rack-1");
    expect(elements.map((element) => element.id)).toContain("rack-2");
    expect(elements.map((element) => element.id)).not.toContain("rack-3");
  });

  it("projeta no corte transversal os equipamentos acima da linha", () => {
    const arranged = applyCommands(createDefaultProject(), [
      { type: "add_racks", count: 4 },
      { type: "create_rack_rows", rows: 1 },
      { type: "auto_arrange" }
    ]);
    const project = applyCommands(arranged, [
      { type: "move_element", id: "rack-1", x: 2, y: 2 },
      { type: "move_element", id: "rack-2", x: 14, y: 4 },
      { type: "move_element", id: "rack-3", x: 2, y: 14 }
    ]);

    const elements = getSectionElements(project, { axis: "y", positionM: 10 });

    expect(elements.map((element) => element.id)).toContain("rack-1");
    expect(elements.map((element) => element.id)).toContain("rack-2");
    expect(elements.map((element) => element.id)).not.toContain("rack-3");
  });
});
