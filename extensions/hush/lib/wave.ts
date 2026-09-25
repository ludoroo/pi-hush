import {
  defineHushWorkingAnimation,
  type HushAnimationColor,
  type HushAnimationFrame,
  type HushAnimationFrameContext,
} from "./animation.ts";

export const HUSH_WAVE_TICK_MS = 100;
export const HUSH_WAVE_MAX_HEIGHT = 1;
export const HUSH_WAVE_WIDTH = 30;
// One wavelength spans 12 Braille dot columns, or 6 terminal cells.
export const HUSH_WAVE_WAVELENGTH = 12;

const CENTER_ROW = 1.5;
const AMPLITUDE = 1.15;
const BRAILLE_BASE = 0x2800;
const LEFT_DOT_BITS = [0x01, 0x02, 0x04, 0x40] as const;
const RIGHT_DOT_BITS = [0x08, 0x10, 0x20, 0x80] as const;

function sampleRow(sample: number, phase: number): number {
  const cycleSample = positiveModulo(
    sample - phase,
    HUSH_WAVE_WAVELENGTH,
  );
  const radians = (cycleSample * 2 * Math.PI) / HUSH_WAVE_WAVELENGTH;
  return Math.max(
    0,
    Math.min(3, Math.round(CENTER_ROW + AMPLITUDE * Math.sin(radians))),
  );
}

/** Render a compact Braille waveform. Increasing phase moves it to the right. */
export function renderHushWaveCells(width: number, phase: number): string {
  if (width <= 0) return "";

  let frame = "";
  for (let column = 0; column < width; column += 1) {
    const leftRow = sampleRow(column * 2, phase);
    const rightRow = sampleRow(column * 2 + 1, phase);
    const dots = LEFT_DOT_BITS[leftRow] | RIGHT_DOT_BITS[rightRow];
    frame += String.fromCodePoint(BRAILLE_BASE + dots);
  }
  return frame;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function waveCellColor(
  column: number,
  context: HushAnimationFrameContext,
): HushAnimationColor {
  // Move broad colour bands with the waveform instead of producing a
  // stationary rainbow. Gold occupies only the narrow crest-sized band.
  const phase = positiveModulo(
    column * 2 - context.frame,
    HUSH_WAVE_WAVELENGTH,
  );
  const cycle = phase / HUSH_WAVE_WAVELENGTH;
  if (cycle >= 0.21 && cycle < 0.34) return "highlight";
  if (cycle < 0.21 || cycle >= 0.84) return "accent";
  if (cycle < 0.59) return "secondary";
  return "tertiary";
}

export function renderHushWave(
  context: HushAnimationFrameContext,
): HushAnimationFrame {
  return {
    segments: Array.from(
      renderHushWaveCells(context.width, context.frame),
      (glyph, column) => ({
        text: glyph,
        color: waveCellColor(column, context),
      }),
    ),
  };
}

export const HUSH_WAVE_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "wave",
  label: "Waveform",
  description: "A compact multi-tone Braille waveform from the active theme",
  maxHeight: HUSH_WAVE_MAX_HEIGHT,
  placement: "aboveEditor",
  intervalMs: HUSH_WAVE_TICK_MS,
  width: HUSH_WAVE_WIDTH,
  renderFrame: renderHushWave,
});
