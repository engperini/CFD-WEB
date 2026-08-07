import type { DataHallElement, DataHallProject } from "./types.js";

export type SectionAxis = "x" | "y";
export type SectionCut = { axis: SectionAxis; positionM: number };

export function getSectionElements(project: DataHallProject, cut: SectionCut): DataHallElement[] {
  return project.elements
    .filter((element) =>
      cut.axis === "x"
        ? element.x <= cut.positionM
        : element.y <= cut.positionM
    )
    .sort((first, second) => {
      const firstPosition = cut.axis === "x" ? first.y : first.x;
      const secondPosition = cut.axis === "x" ? second.y : second.x;
      return firstPosition - secondPosition;
    });
}
