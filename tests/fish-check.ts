import assert from "node:assert/strict";

import { visibleWidth } from "@earendil-works/pi-tui";

import {
  HushAnimationRegistry,
  renderHushAnimation,
  type HushAnimationFrame,
  type HushAnimationPalette,
  type HushAnimationRow,
} from "../extensions/hush/lib/animation.ts";
import {
  HUSH_FISH_LOOP_ANIMATION,
  renderHushFishLoop,
} from "../extensions/hush/lib/fish-loop.ts";

const palette: HushAnimationPalette = {
  accent: (text) => text,
  secondary: (text) => text,
  tertiary: (text) => text,
  highlight: (text) => text,
  muted: (text) => text,
};
new HushAnimationRegistry([HUSH_FISH_LOOP_ANIMATION]);

function rowsOf(frame: HushAnimationFrame): readonly HushAnimationRow[] {
  return "rows" in frame ? frame.rows : [frame];
}

function plainText(row: HushAnimationRow): string {
  return "segments" in row
    ? row.segments.map(({ text }) => text).join("")
    : row.text;
}

function render(width: number, height: number, elapsedMs: number) {
  return renderHushFishLoop({
    frame: Math.floor(elapsedMs / HUSH_FISH_LOOP_ANIMATION.intervalMs),
    width,
    height,
    viewportWidth: width,
    elapsedMs,
  });
}

assert.equal(HUSH_FISH_LOOP_ANIMATION.id, "fish-loop");
assert.deepEqual(HUSH_FISH_LOOP_ANIMATION.width, {
  ratio: 1,
  minColumns: 12,
  maxColumns: 48,
});
assert.equal(HUSH_FISH_LOOP_ANIMATION.maxHeight, 3);
assert.equal(HUSH_FISH_LOOP_ANIMATION.minWidthForMultiRow, 16);

for (const width of [1, 2, 7, 12, 15, 16, 31, 48]) {
  for (const height of [1, 2, 3]) {
    for (let elapsedMs = 0; elapsedMs < 7_200; elapsedMs += 100) {
      const rows = renderHushAnimation(HUSH_FISH_LOOP_ANIMATION, {
        frame: elapsedMs / 100,
        elapsedMs,
        width,
        height,
        viewportWidth: width,
      }, palette);
      const expectedHeight = height === 1 || width < 16 ? 1 : height;
      assert.equal(rows.length, expectedHeight, `${width}x${height} row count`);
      assert.ok(rows.join("").trim(), "Never leave a blank working indicator");
      for (const text of rows) {
        assert.equal(visibleWidth(text), width, `${width}x${height}`);
        assert.match(text, /^[ \u2801-\u28ff]+$/u);
      }
    }
  }
}

assert.equal(rowsOf(render(48, 7, 900)).length, 3);

// Narrow canvases must leave swimming room, not merely inflate the fish in place.
const leadingColumn = (width: number, elapsedMs: number): number => {
  const columns = rowsOf(render(width, 3, elapsedMs))
    .map((row) => plainText(row).search(/\S/u))
    .filter((column) => column >= 0);
  assert.ok(columns.length > 0);
  return Math.min(...columns);
};
for (const width of [12, 16, 17, 18, 24, 48]) {
  assert.ok(
    leadingColumn(width, 3_600) - leadingColumn(width, 0) >= width * 0.35,
    `Fish must swim across at least 35% of a ${width}-column canvas`,
  );
}

// elapsedMs, rather than host frame numbering, is the animation clock.
assert.deepEqual(
  renderHushFishLoop({
    frame: 0,
    width: 32,
    height: 3,
    viewportWidth: 32,
    elapsedMs: 2_345,
  }),
  renderHushFishLoop({
    frame: 999_999,
    width: 32,
    height: 3,
    viewportWidth: 32,
    elapsedMs: 2_345,
  }),
);

// A fixed-duration loop does not restart when the viewport width changes.
assert.deepEqual(render(32, 3, 0), render(32, 3, 7_200));
assert.notDeepEqual(render(32, 3, 0), render(32, 3, 1_800));

// The compact rendering remains recognisably detailed rather than a sliding token.
const compactGlyphs = Array.from(plainText(rowsOf(render(15, 1, 900))[0]!));
assert.ok(compactGlyphs.some((glyph) => /[\u2801-\u28ff]/u.test(glyph)));
assert.ok(compactGlyphs.filter((glyph) => glyph !== " ").length >= 3);

console.log("fish check: ok");
