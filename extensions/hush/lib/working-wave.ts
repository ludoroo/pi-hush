import {
  defineHushWorkingAnimation,
  type HushAnimationFrameContext,
} from "./working-animation.ts";

export const HUSH_WORKING_WAVE_TICK_MS = 100;
export const HUSH_WORKING_WAVE_MAX_HEIGHT = 1;
export const HUSH_WORKING_WAVE_WIDTH = 12;
// One wavelength spans 24 Braille dot columns, or 12 terminal cells.
export const HUSH_WORKING_WAVE_WAVELENGTH = 24;

const CENTER_ROW = 1.5;
const AMPLITUDE = 1.15;
const BRAILLE_BASE = 0x2800;
const LEFT_DOT_BITS = [0x01, 0x02, 0x04, 0x40] as const;
const RIGHT_DOT_BITS = [0x08, 0x10, 0x20, 0x80] as const;

function sampleRow(sample: number, phase: number): number {
  const radians =
    ((sample - phase) * 2 * Math.PI) / HUSH_WORKING_WAVE_WAVELENGTH;
  return Math.max(
    0,
    Math.min(3, Math.round(CENTER_ROW + AMPLITUDE * Math.sin(radians))),
  );
}

/** Render a compact Braille waveform. Increasing phase moves it to the right. */
export function renderHushWorkingWaveCells(
  width: number,
  phase: number,
): string {
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

function paintWaveCell(
  glyph: string,
  column: number,
  context: HushAnimationFrameContext,
): string {
  // Move broad colour bands with the waveform instead of producing a
  // stationary rainbow. Gold occupies only the narrow crest-sized band.
  const phase = positiveModulo(
    column * 2 - context.frame,
    HUSH_WORKING_WAVE_WAVELENGTH,
  );
  if (phase >= 5 && phase < 8) return context.palette.highlight(glyph);
  if (phase < 5 || phase >= 20) return context.palette.accent(glyph);
  if (phase < 14) return context.palette.secondary(glyph);
  return context.palette.tertiary(glyph);
}

export function renderHushWorkingWave(
  context: HushAnimationFrameContext,
): string[] {
  if (context.width === 0) return [];
  const wave = Array.from(
    renderHushWorkingWaveCells(context.width, context.frame),
    (glyph, column) => paintWaveCell(glyph, column, context),
  ).join("");
  return [wave];
}

export const HUSH_WORKING_WAVE_ANIMATION = defineHushWorkingAnimation({
  id: "wave",
  label: "Waveform",
  description: "A compact multi-tone Braille waveform from the active theme",
  maxHeight: HUSH_WORKING_WAVE_MAX_HEIGHT,
  placement: "aboveEditor",
  intervalMs: HUSH_WORKING_WAVE_TICK_MS,
  width: HUSH_WORKING_WAVE_WIDTH,
  renderFrame: renderHushWorkingWave,
});
