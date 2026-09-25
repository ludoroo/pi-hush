import type {
  HushAnimationColor,
  HushAnimationRow,
  HushAnimationFrameSegment,
} from "./animation.ts";

export type HushAnimationCell = {
  readonly text: string;
  readonly color: HushAnimationColor;
};

/** Group adjacent cells by semantic colour to avoid excessive ANSI spans. */
export function composeHushAnimationCells(
  cells: readonly HushAnimationCell[],
): HushAnimationRow {
  const segments: HushAnimationFrameSegment[] = [];
  for (const cell of cells) {
    const previous = segments.at(-1);
    if (previous?.color === cell.color) {
      segments[segments.length - 1] = {
        text: previous.text + cell.text,
        color: cell.color,
      };
    } else {
      segments.push({ text: cell.text, color: cell.color });
    }
  }
  return { segments };
}
