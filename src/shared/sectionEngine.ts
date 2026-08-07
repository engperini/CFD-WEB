import type { DataHallElement, DataHallProject } from "./types.js";

export type SectionAxis = "x" | "y";
export type SectionCut = { axis: SectionAxis; positionM: number };

export function getSectionElements(project: DataHallProject, cut: SectionCut): DataHallElement[] {
  return project.elements
    .filter((element) =>
      cut.axis === "y"
        ? cut.positionM >= element.y && cut.positionM <= element.y + element.depthM
        : cut.positionM >= element.x && cut.positionM <= element.x + element.widthM
    )
    .sort((first, second) => {
      const firstPosition = cut.axis === "y" ? first.x : first.y;
      const secondPosition = cut.axis === "y" ? second.x : second.y;
      return firstPosition - secondPosition;
    });
}
