import { z } from "zod";

export const wallSchema = z.enum(["north", "south", "east", "west"]);
export const orientationSchema = z.enum(["north", "south", "east", "west"]);

const positiveNumber = z.number().finite().positive();
const nonNegativeNumber = z.number().finite().nonnegative();

export const structuredCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_room"),
    widthM: positiveNumber.optional(),
    lengthM: positiveNumber.optional(),
    heightM: positiveNumber.optional()
  }),
  z.object({
    type: z.literal("resize_room"),
    widthM: positiveNumber.optional(),
    lengthM: positiveNumber.optional(),
    heightM: positiveNumber.optional()
  }),
  z.object({
    type: z.literal("add_racks"),
    count: z.number().int().nonnegative().optional(),
    widthM: positiveNumber.optional(),
    depthM: positiveNumber.optional(),
    heightM: positiveNumber.optional(),
    powerKw: nonNegativeNumber.optional(),
    orientation: orientationSchema.optional()
  }),
  z.object({
    type: z.literal("create_rack_rows"),
    rows: z.number().int().positive().optional(),
    count: z.number().int().nonnegative().optional(),
    coldAisleM: positiveNumber.optional(),
    hotAisleM: positiveNumber.optional()
  }),
  z.object({
    type: z.literal("add_fan_walls"),
    count: z.number().int().nonnegative().optional(),
    wall: wallSchema.optional(),
    widthM: positiveNumber.optional(),
    depthM: positiveNumber.optional(),
    heightM: positiveNumber.optional(),
    airflowM3h: nonNegativeNumber.optional(),
    orientation: orientationSchema.optional()
  }),
  z.object({
    type: z.literal("move_element"),
    id: z.string().min(1).optional(),
    x: nonNegativeNumber.optional(),
    y: nonNegativeNumber.optional(),
    z: nonNegativeNumber.optional()
  }),
  z.object({
    type: z.literal("rotate_element"),
    id: z.string().min(1).optional(),
    rotation: z.number().finite().optional(),
    orientation: orientationSchema.optional()
  }),
  z.object({
    type: z.literal("set_aisle_width"),
    coldAisleM: positiveNumber.optional(),
    hotAisleM: positiveNumber.optional()
  }),
  z.object({
    type: z.literal("set_wall_clearance"),
    wallClearanceM: nonNegativeNumber.optional()
  }),
  z.object({ type: z.literal("auto_arrange") }),
  z.object({
    type: z.literal("delete_element"),
    id: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal("clear_layout"),
    target: z.enum(["all", "racks", "fanWalls"]).optional()
  }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") })
]);

export const commandListSchema = z.array(structuredCommandSchema).max(20);

export const interpretResponseSchema = z.object({
  message: z.string().max(500).default("Comando interpretado."),
  commands: commandListSchema.default([])
});

export const transcribeRequestSchema = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1).default("audio/webm")
});

export const interpretRequestSchema = z.object({
  text: z.string().trim().min(1),
  project: z.unknown().optional()
});
