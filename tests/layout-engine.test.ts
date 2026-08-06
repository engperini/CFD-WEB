import { describe, expect, it } from "vitest";
import {
  applyCommands,
  autoArrange,
  calculateStats,
  createDefaultProject,
  moveElement,
  overlaps
} from "../src/shared/layoutEngine";

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
});
