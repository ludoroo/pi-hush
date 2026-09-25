import assert from "node:assert/strict";

import { visibleWidth } from "@earendil-works/pi-tui";

import {
  HushAnimationRegistry,
  renderHushAnimation,
  resolveHushAnimationWidth,
  type HushAnimationFrame,
  type HushAnimationPalette,
  type HushAnimationRow,
} from "../extensions/hush/lib/animation.ts";
import {
  HUSH_FLOCK_ANIMATION,
  HUSH_FLOCK_MAX_WIDTH,
  renderHushFlock,
} from "../extensions/hush/lib/flock.ts";

const plainPalette: HushAnimationPalette = {
  accent: (text) => text,
  secondary: (text) => text,
  tertiary: (text) => text,
  highlight: (text) => text,
  muted: (text) => text,
};
new HushAnimationRegistry([HUSH_FLOCK_ANIMATION]);

const context = (elapsedMs: number, width = 28, height = 2) => ({
  elapsedMs,
  frame: Math.floor(elapsedMs / HUSH_FLOCK_ANIMATION.intervalMs),
  width,
  height,
  viewportWidth: width,
});
const render = (elapsedMs: number, width = 28, height = 2): readonly string[] =>
  renderHushAnimation(HUSH_FLOCK_ANIMATION, context(elapsedMs, width, height), plainPalette);
const rowsOf = (frame: HushAnimationFrame): readonly HushAnimationRow[] =>
  "rows" in frame ? frame.rows : [frame];

assert.equal(HUSH_FLOCK_ANIMATION.maxHeight, 2);
assert.equal(
  resolveHushAnimationWidth(HUSH_FLOCK_ANIMATION.width, 200),
  HUSH_FLOCK_MAX_WIDTH,
);
assert.equal(render(900, 28, 7).length, 2);

for (const width of [1, 2, 5, 9, 10, 11, 12, 17, 28, 40]) {
  for (const height of [1, 2, 3]) {
    // Several formations entering/exiting, plus a long-running session.
    for (const elapsedMs of [...Array.from({ length: 260 }, (_, i) => i * 100), 86_400_000]) {
      const rows = render(elapsedMs, width, height);
      assert.equal(rows.length, width < 12 ? 1 : Math.min(2, height));
      assert.ok(rows.join("").trim(), `Visible flock at ${width}×${height}, ${elapsedMs} ms`);
      for (const row of rows) {
        assert.equal(visibleWidth(row), width);
        assert.match(row, /^[ \u2801-\u28ff]+$/u);
      }
    }
  }
}

// Resize reveals more of the same flight, rather than resetting or teleporting it.
for (let elapsedMs = 0; elapsedMs < 20_000; elapsedMs += 350) {
  for (const height of [1, 2]) {
    assert.deepEqual(
      render(elapsedMs, 12, height),
      render(elapsedMs, 28, height).map((row) => row.slice(0, 12)),
    );
  }
}

// The highlighted leading bird progresses right, never reverses to circle back.
const leaderColumn = (elapsedMs: number): number => {
  const columns: number[] = [];
  for (const row of rowsOf(renderHushFlock(context(elapsedMs)))) {
    let column = 0;
    for (const segment of "segments" in row ? row.segments : [row]) {
      if (segment.color === "highlight" && segment.text.trim()) columns.push(column);
      column += visibleWidth(segment.text);
    }
  }
  assert.ok(columns.length > 0);
  return Math.min(...columns);
};
const positions = [0, 500, 1_000, 1_500, 2_000, 2_500, 3_000].map(leaderColumn);
assert.ok(positions.every((position, i) => i === 0 || position >= positions[i - 1]!));
assert.ok(positions.at(-1)! - positions[0]! >= 8);

// Wing motion remains visible even in the stationary, very narrow fallback.
assert.notDeepEqual(render(0, 5, 1), render(350, 5, 1));
assert.deepEqual(
  renderHushFlock({ ...context(2_345), frame: 0 }),
  renderHushFlock({ ...context(2_345), frame: 999_999 }),
);
assert.deepEqual(render(2_345), render(2_345));

// Semantic colours, rather than embedded ANSI, let the host own theme changes.
const usedColors = new Set<string>();
const taggedPalette = Object.fromEntries(
  Object.keys(plainPalette).map((role) => [role, (text: string) => {
    if (text.trim()) usedColors.add(role);
    return `<${role}>${text}</${role}>`;
  }]),
) as HushAnimationPalette;
const themed = renderHushAnimation(HUSH_FLOCK_ANIMATION, context(1_800), taggedPalette);
assert.equal(themed.length, 2);
assert.match(themed.join(""), /<highlight>/u);
for (const role of ["accent", "secondary", "tertiary", "muted", "highlight"]) {
  assert.ok(usedColors.has(role), `Flock uses the theme's ${role} role`);
}

console.log("flock check: ok");
