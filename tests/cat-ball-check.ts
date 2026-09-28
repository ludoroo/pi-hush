import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  HushAnimationRegistry,
  renderHushAnimation,
  resolveHushAnimationHeight,
  type HushAnimationFrame,
  type HushAnimationPalette,
} from "../extensions/hush/lib/animation.ts";
import {
  HUSH_CAT_BALL_ANIMATION,
  HUSH_CAT_BALL_DURATION_MS,
  HUSH_CAT_BALL_MULTI_ROW_MIN_WIDTH,
  HUSH_CAT_BALL_TICK_MS,
  renderHushCatBall,
} from "../extensions/hush/animations/cat-ball.ts";

const palette: HushAnimationPalette = {
  accent: (text) => text,
  secondary: (text) => text,
  tertiary: (text) => text,
  highlight: (text) => text,
  muted: (text) => text,
};
new HushAnimationRegistry([HUSH_CAT_BALL_ANIMATION]);
const context = (elapsedMs: number, width = 48, height = 3) => ({
  elapsedMs, width, height, viewportWidth: width,
  frame: Math.floor(elapsedMs / HUSH_CAT_BALL_TICK_MS),
});
const render = (elapsedMs: number, width = 48, height = 3) =>
  renderHushCatBall(context(elapsedMs, width, height));
const rowsOf = (frame: HushAnimationFrame) => "rows" in frame ? frame.rows : [frame];
const segmentsOf = (row: ReturnType<typeof rowsOf>[number]) =>
  "segments" in row ? row.segments : [row];
const textOf = (frame: HushAnimationFrame) => rowsOf(frame)
  .map((row) => segmentsOf(row).map((segment) => segment.text).join(""));
const BRAILLE_BITS = [[1, 8], [2, 16], [4, 32], [64, 128]] as const;
type Dot = { x: number; y: number };
function dots(frame: HushAnimationFrame, actor: "ball" | "cat"): Dot[] {
  const found: Dot[] = [];
  rowsOf(frame).forEach((row, rowIndex) => {
    let column = 0;
    for (const segment of segmentsOf(row)) {
      const belongs = actor === "ball"
        ? segment.color === "highlight"
        : segment.color === "accent" || segment.color === "secondary" || segment.color === "tertiary";
      for (const glyph of segment.text) {
        const bits = glyph.codePointAt(0)! - 0x2800;
        if (belongs && bits > 0 && bits <= 255) {
          for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 2; x += 1) {
              if (bits & BRAILLE_BITS[y]![x]!) found.push({ x: column * 2 + x, y: rowIndex * 4 + y });
            }
          }
        }
        column += visibleWidth(glyph);
      }
    }
  });
  return found;
}
function centroid(points: readonly Dot[]): Dot {
  assert.ok(points.length > 0);
  return {
    x: points.reduce((sum, dot) => sum + dot.x, 0) / points.length,
    y: points.reduce((sum, dot) => sum + dot.y, 0) / points.length,
  };
}

assert.equal(HUSH_CAT_BALL_ANIMATION.id, "cat-ball");
assert.equal(HUSH_CAT_BALL_ANIMATION.maxHeight, 3);
assert.equal(HUSH_CAT_BALL_ANIMATION.intervalMs, HUSH_CAT_BALL_TICK_MS);
assert.equal(resolveHushAnimationHeight(HUSH_CAT_BALL_ANIMATION, 48, 24), 3);
assert.equal(resolveHushAnimationHeight(HUSH_CAT_BALL_ANIMATION, 48, 16), 2);
assert.equal(resolveHushAnimationHeight(HUSH_CAT_BALL_ANIMATION, 48, 8), 1);
assert.equal(resolveHushAnimationHeight(HUSH_CAT_BALL_ANIMATION, HUSH_CAT_BALL_MULTI_ROW_MIN_WIDTH - 1, 24), 1);

// A complete story stays inside every allocation, including narrow fallbacks.
for (const width of [1, 2, 3, 5, 8, 12, 17, 18, 24, 32, 48, 80]) {
  for (const height of [1, 2, 3]) {
    const empty: boolean[] = [];
    for (let time = 0; time < HUSH_CAT_BALL_DURATION_MS; time += HUSH_CAT_BALL_TICK_MS) {
      const frame = render(time, width, height);
      const rows = renderHushAnimation(HUSH_CAT_BALL_ANIMATION, context(time, width, height), palette);
      assert.equal(rows.length, width < HUSH_CAT_BALL_MULTI_ROW_MIN_WIDTH ? 1 : height);
      for (const row of rows) {
        assert.equal(visibleWidth(row), width, `${width}×${height} at ${time}ms`);
        assert.doesNotMatch(row, /[\p{Cc}\p{Cf}\p{M}\u2800]/u);
      }
      for (const row of rowsOf(frame)) {
        assert.ok(segmentsOf(row).every((segment) => (segment.color ?? "accent") in palette));
      }
      empty.push(!rows.join("").trim());
    }
    let run = 0;
    for (const blank of [...empty, ...empty]) {
      run = blank ? run + 1 : 0;
      assert.ok(run * HUSH_CAT_BALL_TICK_MS <= 200, `No long empty interval at ${width}×${height}`);
    }
  }
}

// The toy arrives first, bounces, then holds near the middle while the cat catches up.
const early = render(HUSH_CAT_BALL_DURATION_MS * 0.02);
assert.ok(dots(early, "ball").length > 0);
assert.equal(dots(early, "cat").length, 0);
const arrival = [0.02, 0.05, 0.08, 0.11, 0.14].map((fraction) =>
  centroid(dots(render(fraction * HUSH_CAT_BALL_DURATION_MS), "ball")),
);
assert.ok(arrival.at(-1)!.x - arrival[0]!.x > 48 * 2 * 0.2);
assert.ok(Math.max(...arrival.map((p) => p.y)) - Math.min(...arrival.map((p) => p.y)) >= 2);
for (const width of [24, 48, 80]) {
  const parked = [0.18, 0.23, 0.28].map((fraction) =>
    centroid(dots(render(fraction * HUSH_CAT_BALL_DURATION_MS, width), "ball")),
  );
  assert.ok(parked.every((p) => p.x > width * 2 * 0.35 && p.x < width * 2 * 0.65));
  assert.ok(Math.max(...parked.map((p) => p.x)) - Math.min(...parked.map((p) => p.x)) <= 1);
}

// Play changes both the toy and cat pose rather than just sliding a rigid pair.
const ballPositions: number[] = [];
const catPoses = new Set<string>();
for (let fraction = 0.36; fraction < 0.7; fraction += 0.02) {
  const frame = render(fraction * HUSH_CAT_BALL_DURATION_MS);
  const ball = centroid(dots(frame, "ball"));
  const cat = dots(frame, "cat");
  assert.ok(cat.length > 0);
  assert.ok(centroid(cat).x < ball.x, "Cat plays from beside the toy");
  assert.ok(ball.x > 48 * 2 * 0.3 && ball.x < 48 * 2 * 0.75);
  ballPositions.push(ball.x);
  const left = Math.min(...cat.map((dot) => dot.x));
  catPoses.add(JSON.stringify(cat.map(({ x, y }) => [x - left, y])));
}
assert.ok(Math.max(...ballPositions) - Math.min(...ballPositions) > 1, "The cat nudges the toy");
assert.ok(catPoses.size > 1, "Paws/body/tail animate during play");
// A compact paw grows towards the toy without shifting the whole cat backwards.
const compactCatStart = (time: number): number => {
  let column = 0;
  for (const segment of segmentsOf(rowsOf(render(time, 24, 1))[0]!)) {
    for (const glyph of segment.text) {
      if (glyph !== " " && (segment.color === "accent" || segment.color === "secondary")) return column;
      column += visibleWidth(glyph);
    }
  }
  assert.fail("Compact cat must be visible during play");
};
assert.equal(compactCatStart(5_300), compactCatStart(5_000));
let followsDepartedBall = false;
for (let fraction = 0.8; fraction < 1; fraction += 0.01) {
  const frame = render(fraction * HUSH_CAT_BALL_DURATION_MS);
  const cat = dots(frame, "cat");
  if (dots(frame, "ball").length === 0 && cat.length > 0 && centroid(cat).x > 48 * 2 * 0.6) {
    followsDepartedBall = true;
  }
}
assert.ok(followsDepartedBall, "The ball exits right before the following cat");

assert.deepEqual(render(0), render(HUSH_CAT_BALL_DURATION_MS));
assert.deepEqual(render(6_432), render(6_432 + HUSH_CAT_BALL_DURATION_MS));
assert.deepEqual(renderHushCatBall({ ...context(6_432), frame: 0 }),
  renderHushCatBall({ ...context(6_432), frame: 999_999 }));
const beforeResize = render(6_432);
render(6_432, 24, 1);
assert.deepEqual(render(6_432), beforeResize);
assert.equal(textOf(render(6_432, 48, 99)).length, 3);
for (const invalid of [NaN, Infinity, -Infinity]) {
  assert.doesNotThrow(() => renderHushCatBall(context(invalid, invalid, invalid)));
}

console.log("cat-ball check: ok");
