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
  HUSH_SHOOTING_STAR_ANIMATION,
  HUSH_SHOOTING_STAR_MULTI_ROW_MIN_WIDTH,
  HUSH_SHOOTING_STAR_TAIL_LENGTH,
  HUSH_SHOOTING_STAR_TICK_MS,
  renderHushShootingStar,
} from "../extensions/hush/animations/shooting-star.ts";

const palette: HushAnimationPalette = {
  accent: (text) => text, secondary: (text) => text, tertiary: (text) => text,
  highlight: (text) => text, muted: (text) => text,
};
const context = (frame: number, width = 48, height = 2) => ({
  frame, width, height, viewportWidth: width + 1,
  elapsedMs: frame * HUSH_SHOOTING_STAR_TICK_MS,
});
function cells(frame: HushAnimationFrame) {
  return ("rows" in frame ? frame.rows : [frame]).map((row) =>
    ("segments" in row ? row.segments : [row]).flatMap((segment) =>
      Array.from(segment.text, (text) => ({ text, color: segment.color ?? "accent" })),
    ),
  );
}
function star(frame: HushAnimationFrame) {
  const positions = cells(frame).flatMap((row, y) => row.flatMap((cell, x) =>
    cell.color === "highlight" && cell.text !== " " ? [{ x, y }] : [],
  ));
  assert.equal(positions.length, 1);
  return positions[0]!;
}
new HushAnimationRegistry([HUSH_SHOOTING_STAR_ANIMATION]);
assert.deepEqual(HUSH_SHOOTING_STAR_ANIMATION.width, { ratio: 1 });
assert.equal(resolveHushAnimationHeight(HUSH_SHOOTING_STAR_ANIMATION, 80, 8), 1);
assert.equal(resolveHushAnimationHeight(HUSH_SHOOTING_STAR_ANIMATION, 80, 24), 2);
assert.equal(resolveHushAnimationHeight(HUSH_SHOOTING_STAR_ANIMATION,
  HUSH_SHOOTING_STAR_MULTI_ROW_MIN_WIDTH - 1, 100), 1);

// Full passes, including the tail's exit, stay bounded and never go entirely blank.
for (const width of [1, 2, 8, 11, 12, 24, 48, 80]) {
  for (const height of [1, 2, 3]) {
    for (let frame = 0; frame < 2 * (width + HUSH_SHOOTING_STAR_TAIL_LENGTH); frame += 1) {
      const ctx = context(frame, width, height);
      const raw = renderHushShootingStar(ctx);
      const rows = renderHushAnimation(HUSH_SHOOTING_STAR_ANIMATION, ctx, palette);
      assert.equal(rows.length, width < HUSH_SHOOTING_STAR_MULTI_ROW_MIN_WIDTH ? 1 : Math.min(2, height));
      for (const row of rows) {
        assert.equal(visibleWidth(row), width);
        assert.ok(Array.from(row).every((glyph) => visibleWidth(glyph) === 1));
        assert.doesNotMatch(row, /[.*\p{Cc}\p{Cf}]/u, "No background track or unsafe controls");
      }
      const positions = cells(raw).flatMap((row) => row.flatMap((cell, x) => {
        assert.ok(cell.color in palette);
        return cell.text === " " ? [] : [x];
      }));
      const columns = new Set(positions);
      assert.ok(columns.size > 0, "The star or its fading tail remains visible");
      assert.ok(columns.size <= HUSH_SHOOTING_STAR_TAIL_LENGTH + 1, "Only a short moving wake");
      assert.equal(Math.max(...positions) - Math.min(...positions) + 1, columns.size);
    }
  }
}

// Shimmer changes the tail itself, not just its horizontal position.
const tailPoses = new Set<string>();
for (let frame = 4; frame < 40; frame += 1) {
  const row = cells(renderHushShootingStar(context(frame, 48, 1)))[0]!;
  tailPoses.add(row.filter((cell) => cell.text !== " " && cell.color !== "highlight")
    .map((cell) => cell.text).join(""));
}
assert.ok(tailPoses.size > 1, "The tail visibly flickers on a flat trajectory too");

// A shallow, one-row descent; the dot wake bridges the transition between rows.
for (const width of [12, 24, 48, 80]) {
  const positions = Array.from({ length: width }, (_, frame) =>
    star(renderHushShootingStar(context(frame, width, 2))));
  assert.deepEqual(positions[0], { x: 0, y: 0 });
  assert.deepEqual(positions.at(-1), { x: width - 1, y: 1 });
  assert.ok(positions.every((position, i) => position.x === i &&
    (i === 0 || position.y >= positions[i - 1]!.y)));
  const poses = Array.from({ length: width }, (_, frame) =>
    cells(renderHushShootingStar(context(frame, width, 2))));
  assert.ok(poses.some((rows) =>
    rows.every((row) => row.some((cell) => cell.text !== " " && cell.color !== "highlight"))));

  const starDrop = positions.findIndex((position) => position.y > 0);
  const tailDrop = poses.findIndex((rows) =>
    rows[1]!.some((cell) => cell.text !== " " && cell.color !== "highlight"));
  assert.ok(tailDrop > starDrop, "The star must enter the lower row before its tail");
  for (let frame = 0; frame < starDrop; frame += 1) {
    assert.deepEqual(poses[frame]![0], cells(renderHushShootingStar(context(frame, width, 1)))[0],
      "The tail must not start drifting down while the star is still on its original row");
  }
}

const beforeResize = renderHushShootingStar(context(36));
renderHushShootingStar(context(36, 12, 1));
assert.deepEqual(renderHushShootingStar(context(36)), beforeResize);
assert.equal(star(renderHushShootingStar(context(36, 48, 1))).x, star(beforeResize).x);
assert.deepEqual(renderHushShootingStar({ ...context(36), frame: 0 }),
  renderHushShootingStar({ ...context(36), frame: 999_999 }));
assert.deepEqual(renderHushShootingStar({ frame: 36, width: 48, viewportWidth: 49 }),
  renderHushShootingStar(context(36, 48, 1)), "Legacy callers retain a single row");
for (const invalid of [NaN, Infinity, -Infinity]) {
  assert.doesNotThrow(() => renderHushShootingStar({ ...context(0), width: invalid, height: invalid, elapsedMs: invalid }));
}

console.log("shooting star check: ok");
