import test from "node:test";
import assert from "node:assert/strict";
import {
  applyActions,
  autoArrange,
  calculateStats,
  createDefaultProject,
  moveElement
} from "../public/layout-engine.js";

test("organiza a quantidade configurada de racks e fan walls", () => {
  const project = autoArrange(createDefaultProject());
  const stats = calculateStats(project);
  assert.equal(stats.rackCount, 24);
  assert.equal(stats.fanWallCount, 4);
  assert.equal(stats.totalPowerKw, 480);
});

test("aplica comandos estruturados da IA", () => {
  const project = applyActions(createDefaultProject(), [
    { type: "set_room", widthM: 20, lengthM: 30, heightM: 6 },
    { type: "configure_racks", count: 32, rows: 4, powerKw: 40 },
    { type: "configure_fan_walls", count: 6, wall: "south" }
  ]);

  assert.deepEqual(project.room, { widthM: 20, lengthM: 30, heightM: 6 });
  assert.equal(project.elements.filter((element) => element.type === "rack").length, 32);
  assert.equal(project.elements.filter((element) => element.type === "fanWall").length, 6);
  assert.equal(calculateStats(project).totalPowerKw, 1280);
});

test("mantém elementos arrastados dentro da sala", () => {
  const project = autoArrange(createDefaultProject());
  const moved = moveElement(project, "rack-1", 1000, -1000);
  const rack = moved.elements.find((element) => element.id === "rack-1");

  assert.equal(rack.y, 0);
  assert.equal(rack.x, project.room.widthM - rack.widthM);
});
