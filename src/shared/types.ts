export type ElementType = "rack" | "fanWall";
export type Wall = "north" | "south" | "east" | "west";
export type Orientation = "north" | "south" | "east" | "west";
export type CommandType =
  | "create_room"
  | "resize_room"
  | "add_racks"
  | "create_rack_rows"
  | "add_fan_walls"
  | "move_element"
  | "rotate_element"
  | "set_aisle_width"
  | "set_wall_clearance"
  | "auto_arrange"
  | "delete_element"
  | "clear_layout"
  | "undo"
  | "redo";

export interface Room {
  widthM: number;
  lengthM: number;
  heightM: number;
}

export interface DataHallElement {
  id: string;
  type: ElementType;
  label: string;
  x: number;
  y: number;
  z: number;
  widthM: number;
  depthM: number;
  heightM: number;
  rotation: number;
  orientation: Orientation;
  powerKw?: number;
  airflowM3h?: number;
  row?: number;
  wall?: Wall;
}

export interface RackDefaults {
  widthM: number;
  depthM: number;
  heightM: number;
  powerKw: number;
  orientation: Orientation;
}

export interface FanWallDefaults {
  widthM: number;
  depthM: number;
  heightM: number;
  airflowM3h: number;
  orientation: Orientation;
  wall: Wall;
}

export interface LayoutSettings {
  rackRows: number;
  coldAisleM: number;
  hotAisleM: number;
  wallClearanceM: number;
}

export interface DataHallProject {
  version: 2;
  name: string;
  room: Room;
  rackDefaults: RackDefaults;
  fanWallDefaults: FanWallDefaults;
  settings: LayoutSettings;
  elements: DataHallElement[];
  warnings: string[];
}

export interface LayoutStats {
  rackCount: number;
  fanWallCount: number;
  totalPowerKw: number;
  totalAirflowM3h: number;
  roomAreaM2: number;
  occupiedAreaM2: number;
  occupiedPercent: number;
  alerts: string[];
}

export type StructuredCommand =
  | { type: "create_room"; widthM?: number; lengthM?: number; heightM?: number }
  | { type: "resize_room"; widthM?: number; lengthM?: number; heightM?: number }
  | {
      type: "add_racks";
      count?: number;
      widthM?: number;
      depthM?: number;
      heightM?: number;
      powerKw?: number;
      orientation?: Orientation;
    }
  | {
      type: "create_rack_rows";
      rows?: number;
      count?: number;
      coldAisleM?: number;
      hotAisleM?: number;
    }
  | {
      type: "add_fan_walls";
      count?: number;
      wall?: Wall;
      widthM?: number;
      depthM?: number;
      heightM?: number;
      airflowM3h?: number;
      orientation?: Orientation;
    }
  | { type: "move_element"; id?: string; x?: number; y?: number; z?: number }
  | { type: "rotate_element"; id?: string; rotation?: number; orientation?: Orientation }
  | { type: "set_aisle_width"; coldAisleM?: number; hotAisleM?: number }
  | { type: "set_wall_clearance"; wallClearanceM?: number }
  | { type: "auto_arrange" }
  | { type: "delete_element"; id?: string }
  | { type: "clear_layout"; target?: "all" | "racks" | "fanWalls" }
  | { type: "undo" }
  | { type: "redo" };
