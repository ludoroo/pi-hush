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
  HUSH_FLOCK_PASS_DURATION_MS,
  renderHushFlock,
} from "../extensions/hush/animations/flock.ts";

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
for (const available of [1, 5, 20, 50, 200]) {
  assert.equal(resolveHushAnimationWidth(HUSH_FLOCK_ANIMATION.width, available), available);
}
assert.equal(render(900, 28, 7).length, 2);

for (const width of [1, 2, 5, 9, 10, 11, 12, 17, 18, 19, 20, 21, 28, 40, 50]) {
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

assert.ok(Number.isFinite(HUSH_FLOCK_PASS_DURATION_MS) && HUSH_FLOCK_PASS_DURATION_MS > 0);

const coloredColumns = (
  elapsedMs: number,
  width: number,
  colors: ReadonlySet<string>,
): readonly number[] => {
  const columns = new Set<number>();
  for (const row of rowsOf(renderHushFlock(context(elapsedMs, width)))) {
    let column = 0;
    for (const segment of "segments" in row ? row.segments : [row]) {
      for (const character of segment.text) {
        if (character.trim() && segment.color && colors.has(segment.color)) {
          columns.add(column);
        }
        column += visibleWidth(character);
      }
    }
  }
  return [...columns].sort((left, right) => left - right);
};
const highlightColumns = (elapsedMs: number, width = 28): readonly number[] =>
  coloredColumns(elapsedMs, width, new Set(["highlight"]));
const leaderColumn = (elapsedMs: number, width = 28): number => {
  const columns = highlightColumns(elapsedMs, width);
  assert.ok(
    columns.length > 0,
    `Highlighted leader at width ${width}, ${elapsedMs} ms`,
  );
  return columns[0]!;
};

// Every allocation uses the same pass clock. Resizing changes travel distance
// (and therefore speed), without changing the formation's normalized phase.
const firstEntryMs = HUSH_FLOCK_PASS_DURATION_MS * 0.75;
for (const phase of [0.1, 0.25, 0.5]) {
  const elapsedMs = firstEntryMs + phase * HUSH_FLOCK_PASS_DURATION_MS;
  for (const width of [20, 28, 50, 80]) {
    const expectedDotX = phase * (width * 2 + 30);
    assert.ok(
      Math.abs(leaderColumn(elapsedMs, width) * 2 - expectedDotX) <= 2,
      `Leader follows pass phase ${phase} at width ${width}`,
    );
  }
}

// The highlighted leading bird progresses right, never reverses to circle back.
const positions = [0, 500, 1_000, 1_500, 2_000, 2_500, 3_000].map((elapsedMs) =>
  leaderColumn(elapsedMs),
);
assert.ok(positions.every((position, i) => i === 0 || position >= positions[i - 1]!));
assert.ok(positions.at(-1)! - positions[0]! >= 8);

// A new leader enters only as the outgoing formation's rear bird reaches the
// right edge. Slight wing-tip overlap at the boundary is intentional.
for (const width of [10, 20, 50, 80]) {
  const entering = coloredColumns(
    firstEntryMs,
    width,
    new Set(["accent", "highlight"]),
  );
  assert.ok(
    entering.includes(0),
    `New leader enters at the left edge at width ${width}`,
  );
  const outgoingRear = coloredColumns(firstEntryMs, width, new Set(["muted"]));
  assert.ok(outgoingRear.length > 0, `Outgoing rear bird remains at width ${width}`);
  assert.ok(
    outgoingRear.every((column) => column >= width - 3),
    `Outgoing rear bird is at the right edge at width ${width}`,
  );

  for (
    let elapsedMs = firstEntryMs - 1_000;
    elapsedMs <= firstEntryMs;
    elapsedMs += 100
  ) {
    const incoming = coloredColumns(elapsedMs, width, new Set(["accent", "highlight"]));
    if (!incoming.includes(0)) continue;
    const rear = coloredColumns(elapsedMs, width, new Set(["muted"]));
    assert.ok(
      rear.length === 0 || rear.every((column) => column >= width - 3),
      `No early re-entry at width ${width}, ${elapsedMs} ms`,
    );
  }
}

// Formation hand-offs leave no blank frame, including the narrow boundaries.
for (let width = 10; width <= 20; width += 1) {
  for (let elapsedMs = 0; elapsedMs <= HUSH_FLOCK_PASS_DURATION_MS; elapsedMs += 100) {
    assert.ok(
      render(elapsedMs, width).join("").trim(),
      `Full pass visible at width ${width}`,
    );
  }
}

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
