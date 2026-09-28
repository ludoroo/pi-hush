import { composeHushAnimationCells, type HushAnimationCell } from "../lib/animation-cells.ts";
import {
  defineHushWorkingAnimation,
  type HushAnimationColor,
  type HushAnimationFrame,
  type HushAnimationFrameContext,
  type HushAnimationRenderContext,
} from "../lib/animation.ts";

export const HUSH_WAVE_TICK_MS = 100;
export const HUSH_WAVE_MAX_HEIGHT = 1;
export const HUSH_WAVE_WIDTH = 30;
// The underlying carrier spans five cells; modulation breaks up its repetition.
export const HUSH_WAVE_WAVELENGTH = 10;

const TAU = Math.PI * 2;
const CENTER_ROW = 1.5;
const BRAILLE_BASE = 0x2800;
const LEFT_DOT_BITS = [0x01, 0x02, 0x04, 0x40] as const;
const RIGHT_DOT_BITS = [0x08, 0x10, 0x20, 0x80] as const;
type WaveContext = HushAnimationFrameContext &
  Partial<Pick<HushAnimationRenderContext, "elapsedMs">>;
type WaveSample = { row: number; displacement: number; swell: number };

function cycleAngle(turns: number): number {
  return (((turns % 1) + 1) % 1) * TAU;
}

function sampleWave(sample: number, phase: number): WaveSample {
  // Slow swells vary the height; a separate bend varies crest spacing. A small
  // counter-moving ripple keeps this from merely scrolling a fixed waveform.
  const swell = 0.5 + 0.5 * Math.sin(cycleAngle(sample / 54 - phase / 240 + 0.18));
  const bend = 0.75 * Math.sin(cycleAngle(sample / 37 - phase / 170));
  const carrier = cycleAngle((sample - phase * 0.65) / HUSH_WAVE_WAVELENGTH);
  const ripple = 0.18 * Math.sin(cycleAngle(sample / 7 + phase / 31));
  const displacement = (0.5 + 0.8 * swell) * Math.sin(carrier + bend) + ripple;
  return {
    row: Math.max(0, Math.min(3, Math.round(CENTER_ROW - displacement))),
    displacement,
    swell,
  };
}

function waveCellColor(left: WaveSample, right: WaveSample): HushAnimationColor {
  // Colour follows the actual swells and crests, not a repeating rainbow band.
  if ((left.swell + right.swell) / 2 < 0.2) return "muted";
  if (Math.max(left.displacement, right.displacement) > 0.9) return "highlight";
  if (Math.min(left.displacement, right.displacement) < -0.65) return "secondary";
  return left.displacement + right.displacement >= 0 ? "accent" : "tertiary";
}

function waveCells(width: number, phase: number): HushAnimationCell[] {
  const columns = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const time = Number.isFinite(phase) ? phase : 0;
  return Array.from({ length: columns }, (_, column) => {
    const left = sampleWave(column * 2, time);
    const right = sampleWave(column * 2 + 1, time);
    const dots = LEFT_DOT_BITS[left.row]! | RIGHT_DOT_BITS[right.row]!;
    return {
      text: String.fromCodePoint(BRAILLE_BASE + dots),
      color: waveCellColor(left, right),
    };
  });
}

/** An evolving wave on a fixed dot grid: extra width reveals more, not larger, ripples. */
export function renderHushWaveCells(width: number, phase: number): string {
  return waveCells(width, phase).map((cell) => cell.text).join("");
}

export function renderHushWave(context: WaveContext): HushAnimationFrame {
  const phase = context.elapsedMs === undefined
    ? context.frame
    : context.elapsedMs / HUSH_WAVE_TICK_MS;
  return composeHushAnimationCells(waveCells(context.width, phase));
}

export const HUSH_WAVE_ANIMATION = defineHushWorkingAnimation({
  kind: "procedural",
  id: "wave",
  label: "Waveform",
  description: "Organic Braille swells with drifting ripples and softly lit crests",
  maxHeight: HUSH_WAVE_MAX_HEIGHT,
  placement: "aboveEditor",
  intervalMs: HUSH_WAVE_TICK_MS,
  width: HUSH_WAVE_WIDTH,
  renderFrame: renderHushWave,
});
