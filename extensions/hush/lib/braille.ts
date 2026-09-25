import { composeHushAnimationCells } from "./animation-cells.ts";
import type { HushAnimationColor, HushAnimationRow } from "./animation.ts";

export type HushBraillePixel = HushAnimationColor | undefined;

const BRAILLE_BASE = 0x2800;
const BRAILLE_DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;
const COLOR_PRIORITY: Record<HushAnimationColor, number> = {
  muted: 0,
  accent: 1,
  secondary: 2,
  tertiary: 3,
  highlight: 4,
};

/** Pack a 2×4-dot-per-cell canvas into theme-coloured terminal rows. */
export function renderHushBrailleRows(
  pixels: readonly HushBraillePixel[],
  width: number,
  height: number,
): readonly HushAnimationRow[] {
  const pixelWidth = width * 2;
  return Array.from({ length: height }, (_, row) => {
    const glyphs = Array.from({ length: width }, (_, column) => {
      let dots = 0;
      let color: HushAnimationColor = "muted";
      let priority = -1;
      for (let dotY = 0; dotY < 4; dotY += 1) {
        for (let dotX = 0; dotX < 2; dotX += 1) {
          const pixel =
            pixels[(row * 4 + dotY) * pixelWidth + column * 2 + dotX];
          if (pixel === undefined) continue;
          dots |= BRAILLE_DOTS[dotY]![dotX]!;
          if (COLOR_PRIORITY[pixel] > priority) {
            color = pixel;
            priority = COLOR_PRIORITY[pixel];
          }
        }
      }
      return {
        text: dots === 0 ? " " : String.fromCodePoint(BRAILLE_BASE + dots),
        color,
      };
    });
    return composeHushAnimationCells(glyphs);
  });
}
