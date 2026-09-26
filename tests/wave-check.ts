import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  HushAnimationRegistry,
  renderHushAnimation,
  type HushAnimationFrame,
  type HushAnimationPalette,
} from "../extensions/hush/lib/animation.ts";
import {
  HUSH_WAVE_ANIMATION,
  HUSH_WAVE_TICK_MS,
  HUSH_WAVE_WAVELENGTH,
  HUSH_WAVE_WIDTH,
  renderHushWave,
  renderHushWaveCells,
} from "../extensions/hush/lib/wave.ts";

const palette: HushAnimationPalette = {
  accent: (text) => text,
  secondary: (text) => text,
  tertiary: (text) => text,
  highlight: (text) => text,
  muted: (text) => text,
};
new HushAnimationRegistry([HUSH_WAVE_ANIMATION]);
assert.equal(HUSH_WAVE_ANIMATION.width, HUSH_WAVE_WIDTH);
assert.equal(HUSH_WAVE_ANIMATION.maxHeight, 1);
const context = (elapsedMs: number, width = HUSH_WAVE_WIDTH) => ({
  elapsedMs, width, viewportWidth: width + 1, height: 1,
  frame: Math.floor(elapsedMs / HUSH_WAVE_TICK_MS),
});
function cells(frame: HushAnimationFrame) {
  assert.ok(!("rows" in frame), "Wave keeps its single-row footprint");
  return ("segments" in frame ? frame.segments : [frame]).flatMap((segment) =>
    Array.from(segment.text, (text) => ({ text, color: segment.color ?? "accent" })),
  );
}
function dotRows(text: string): number[] {
  return Array.from(text).flatMap((glyph) => {
    const bits = glyph.codePointAt(0)! - 0x2800;
    return [
      [1, 2, 4, 64].findIndex((bit) => (bits & bit) !== 0),
      [8, 16, 32, 128].findIndex((bit) => (bits & bit) !== 0),
    ];
  });
}

for (const width of [0, 1, 2, 8, 30, 60, 120]) {
  for (const elapsedMs of [0, 50, 750, 2_345, 12_000, 60_000, 86_400_000]) {
    const raw = renderHushWave(context(elapsedMs, width));
    const rows = renderHushAnimation(HUSH_WAVE_ANIMATION, context(elapsedMs, width), palette);
    assert.equal(rows.length, 1);
    assert.equal(visibleWidth(rows[0]!), width);
    assert.match(rows[0]!, /^[\u2801-\u28ff]*$/u);
    assert.ok(cells(raw).every((cell) => cell.color in palette));
    assert.equal(rows[0], renderHushWaveCells(width, elapsedMs / HUSH_WAVE_TICK_MS));
    assert.deepEqual(renderHushWave(context(elapsedMs, width)), raw, "Rendering is deterministic");
  }
}

// Added drawing space reveals the same surface and colours, rather than stretching it.
for (const time of [0, 5_555, 12_000]) {
  assert.deepEqual(cells(renderHushWave(context(time, 60))).slice(0, 12),
    cells(renderHushWave(context(time, 12))));
}
const beforeResize = renderHushWave(context(2_345));
renderHushWave(context(2_345, 80));
assert.deepEqual(renderHushWave(context(2_345)), beforeResize);
assert.deepEqual(renderHushWave({ ...context(2_345), frame: 0 }),
  renderHushWave({ ...context(2_345), frame: 999_999 }));
assert.deepEqual(renderHushWave({ frame: 17, width: 30, viewportWidth: 80 }),
  renderHushWave(context(17 * HUSH_WAVE_TICK_MS)));

// A swell contains differing heights, not tiled copies of one sine-wave period.
const surface = dotRows(renderHushWaveCells(60, 0));
const heights = new Set<number>();
for (let i = 0; i < surface.length; i += HUSH_WAVE_WAVELENGTH) {
  const section = surface.slice(i, i + HUSH_WAVE_WAVELENGTH);
  heights.add(Math.max(...section) - Math.min(...section));
}
assert.ok(heights.size > 1, "Both quiet ripples and taller swells are visible");
assert.notEqual(renderHushWaveCells(30, 0), renderHushWaveCells(30, HUSH_WAVE_WAVELENGTH));

// Evolving geometry stays gentle: no dot jumps more than one row per normal tick.
let previous = dotRows(renderHushWaveCells(HUSH_WAVE_WIDTH, 0));
for (let phase = 1; phase <= 600; phase += 1) {
  const current = dotRows(renderHushWaveCells(HUSH_WAVE_WIDTH, phase));
  assert.ok(current.every((row, i) => row >= 0 && row <= 3 && Math.abs(row - previous[i]!) <= 1));
  previous = current;
}
assert.equal(renderHushWaveCells(NaN, 0), "");
assert.equal(renderHushWaveCells(Infinity, 0), "");
assert.equal(renderHushWaveCells(-1, 0), "");
assert.equal(renderHushWaveCells(30, NaN), renderHushWaveCells(30, 0));

console.log("wave check: ok");
