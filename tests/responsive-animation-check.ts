import assert from "node:assert/strict";
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import {
  HUSH_ANIMATION_ROW_BUDGET,
  HushAnimationHost,
  HushAnimationRegistry,
  defineHushWorkingAnimation,
  normalizeHushWidgetFrame,
  renderHushAnimation,
  resolveHushAnimationHeight,
  type HushAnimationFrame,
  type HushAnimationPalette,
  type HushAnimationRenderContext,
} from "../extensions/hush/lib/animation.ts";
import { composeHushAnimationCells } from "../extensions/hush/lib/animation-cells.ts";

const palette: HushAnimationPalette = {
  accent: (text) => text,
  secondary: (text) => text,
  tertiary: (text) => text,
  highlight: (text) => text,
  muted: (text) => text,
};
const recorded = defineHushWorkingAnimation({
  kind: "frames",
  id: "recorded",
  label: "Recorded",
  description: "Sparse content on a stable canvas",
  intervalMs: 100,
  width: { ratio: 1 },
  maxHeight: 3,
  frames: [
    { rows: [{ text: "" }, { segments: [{ text: "  x", color: "accent" }] }] },
    { rows: [{ text: "y" }] },
  ],
});
new HushAnimationRegistry([recorded]);
const grouped = composeHushAnimationCells([
  { text: "a", color: "accent" },
  { text: "b", color: "accent" },
  { text: "c", color: "secondary" },
]);
assert.deepEqual(grouped, { segments: [
  { text: "ab", color: "accent" },
  { text: "c", color: "secondary" },
] });
const blank = composeHushAnimationCells([]);
assert.doesNotThrow(() => new HushAnimationRegistry([{ ...recorded, frames: [blank] }]));
const directContext = { frame: 0, width: 10, viewportWidth: 10 };
assert.deepEqual(renderHushAnimation(recorded, directContext, palette), ["", "  x"]);
assert.deepEqual(normalizeHushWidgetFrame(["", "  x"], 5, 3), ["     ", "  x  ", "     "]);
const clipped = normalizeHushWidgetFrame(["oversized", "y", "z"], 2, 2);
assert.deepEqual(clipped.map(visibleWidth), [2, 2]);
assert.ok(clipped[0].startsWith("ov"));
assert.equal(clipped[1], "y ");
// Existing single-row shapes still work, including an explicit blank row.
for (const frame of [{ text: "x" }, { segments: [{ text: "x" }] }, { text: "" }]) {
  const legacy = { ...recorded, maxHeight: 1, frames: [frame] };
  assert.doesNotThrow(() => new HushAnimationRegistry([legacy]));
  assert.equal(renderHushAnimation(legacy, directContext, palette).length, 1);
}
for (const text of ["a\nb", "a\tb", "\x1b[31mred", "\x1b]0;title\x07", "\u009b31m", "\u202eRTL"]) {
  assert.throws(() => new HushAnimationRegistry([
    { ...recorded, frames: [{ rows: [{ text }] }] },
  ]), /Invalid frames/);
}
for (const frame of [
  { rows: [] },
  { rows: [{ rows: [{ text: "nested" }] }] },
  { rows: Array.from({ length: 4 }, () => ({ text: "x" })) },
  { rows: [{ text: "x", color: "raw-hex" }] },
]) {
  assert.throws(() => new HushAnimationRegistry([
    { ...recorded, frames: [frame as unknown as HushAnimationFrame] },
  ]), /Invalid frames/);
}
assert.throws(() => new HushAnimationRegistry([
  { ...recorded, minWidthForMultiRow: 0 },
]), /Invalid multi-row/);
assert.equal(resolveHushAnimationHeight(recorded, 40, 24), 3);
assert.equal(resolveHushAnimationHeight(recorded, 40, 16), 2);
assert.equal(resolveHushAnimationHeight(recorded, 40, 8), 1);
assert.equal(resolveHushAnimationHeight(recorded, 40, 1), 1);
assert.equal(resolveHushAnimationHeight(recorded, 40, NaN), 1);
assert.equal(resolveHushAnimationHeight({ maxHeight: 10 }, 40, 100), HUSH_ANIMATION_ROW_BUDGET);
assert.equal(resolveHushAnimationHeight({ ...recorded, minWidthForMultiRow: 16 }, 15, 100), 1);
assert.equal(resolveHushAnimationHeight({ ...recorded, minWidthForMultiRow: 16 }, 16, 100), 3);

// Exercise real host layout with a fake terminal and a monotonic playback clock.
const originalInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalNow = performance.now;
type Handle = ReturnType<typeof setInterval>;
const timers = new Map<Handle, () => void>();
let now = 0;
let mounted: (Component & { dispose?(): void }) | undefined;
let nativeVisible = true;
let workingMessage: string | undefined;
let workingIndicator: { frames?: string[] } | undefined;
let lastContext: HushAnimationRenderContext | undefined;
let tint = "\x1b[36m";
const terminal = { rows: 24 };
let renderRequests = 0;
const tui = { terminal, requestRender() { renderRequests += 1; } } as unknown as TUI;
const plain = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const theme = { fg: (_role: string, text: string) => `${tint}${text}\x1b[0m` } as unknown as Theme;
const notifications: string[] = [];
const ui = {
  setWidget(_key: string, factory?: (tui: TUI, theme: Theme) => Component & { dispose?(): void }) {
    mounted?.dispose?.();
    mounted = factory?.(tui, theme);
  },
  setWorkingVisible(visible: boolean) { nativeVisible = visible; },
  setWorkingMessage(message?: string) { workingMessage = message; },
  setWorkingIndicator(options?: { frames?: string[] }) { workingIndicator = options; },
  notify(text: string) { notifications.push(text); },
} as unknown as ExtensionUIContext;
const responsive = defineHushWorkingAnimation({
  id: "responsive",
  label: "Responsive",
  description: "Captures allocated size and time",
  intervalMs: 100,
  width: { ratio: 1 },
  maxHeight: 3,
  minWidthForMultiRow: 16,
  renderFrame(context: HushAnimationRenderContext): HushAnimationFrame {
    lastContext = context;
    // Change content height without changing the allocated surface.
    return context.frame % 2 === 0
      ? { rows: [{ text: " x" }, { text: "" }, { text: "y" }] }
      : { text: "z" };
  },
});
const bad = defineHushWorkingAnimation({
  ...responsive,
  id: "bad",
  renderFrame: (): HushAnimationFrame => ({ rows: [{ text: "\x1b[2J" }] }),
});
const capped = defineHushWorkingAnimation({
  ...responsive,
  id: "capped",
  width: { ratio: 0.5, minColumns: 12, maxColumns: 20 },
});
const host = new HushAnimationHost(new HushAnimationRegistry([recorded, responsive, capped, bad]), "recorded");
const getWidget = () => {
  assert.ok(mounted);
  return mounted;
};
const context = () => {
  assert.ok(lastContext);
  return { ...lastContext };
};
try {
  performance.now = () => now;
  globalThis.setInterval = ((callback: () => void) => {
    const handle = { unref() {} } as unknown as Handle;
    timers.set(handle, callback);
    return handle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: Handle | undefined) => {
    if (handle !== undefined) timers.delete(handle);
  }) as typeof clearInterval;
  const tick = (ms: number) => {
    now += ms;
    for (const callback of [...timers.values()]) callback();
  };

  host.apply(ui, { enabled: true, animationId: "responsive", activityTextEnabled: true });
  host.setActivityText("Thinking");
  host.setWorking(true);
  assert.equal(nativeVisible, true);
  assert.equal(workingMessage, "Thinking");
  assert.deepEqual(workingIndicator, { frames: [] });
  const widget = getWidget();
  assert.equal(timers.size, 1);
  const first = widget.render(65);
  assert.equal(first.length, 3);
  assert.deepEqual(context(), { width: 64, height: 3, viewportWidth: 65, elapsedMs: 0, frame: 0 });
  assert.ok(first.every((line) => !line.includes("Thinking")));
  tick(350); // A delayed timer skips ahead, rather than slowing the playback.
  const advanced = widget.render(65);
  assert.equal(context().elapsedMs, 350);
  assert.equal(context().frame, 3);
  assert.equal(advanced.length, 3);
  assert.notDeepEqual(advanced, first);

  const originalTimer = [...timers.keys()][0];
  const leftSettings = {
    enabled: true, animationId: "responsive", activityTextEnabled: true,
  };
  host.apply(ui, leftSettings);
  const leftRows = widget.render(65).map(plain);
  assert.equal(leftRows[0].indexOf("z"), 1);
  assert.equal(leftRows[1].includes("Thinking"), false);
  assert.equal(leftRows[2].trim(), "");
  assert.deepEqual(leftRows.map(visibleWidth), [65, 65, 65]);
  assert.equal(context().elapsedMs, 350);
  assert.equal(getWidget(), widget);
  assert.deepEqual([...timers.keys()], [originalTimer]);
  const requestsBeforeNoop = renderRequests;
  host.apply(ui, leftSettings);
  assert.equal(renderRequests, requestsBeforeNoop);
  for (const [text, expectedMessage] of [
    [undefined, undefined],
    ["Read…", "Read…"],
    ["Running 長いツール名 very long name", "Running 長いツール名 very long name"],
    ["x\ny\x1b[31m", "x y"],
  ] as const) {
    host.setActivityText(text);
    assert.equal(workingMessage, expectedMessage);
    assert.equal(plain(widget.render(65)[0]).indexOf("z"), 1);
    for (const width of [0, 1, 2, 12, 18, 19, 20, 24, 25, 26, 40, 41, 65, 120]) {
      const rows = widget.render(width);
      assert.ok(rows.length <= HUSH_ANIMATION_ROW_BUDGET);
      assert.ok(rows.every((line) => visibleWidth(line) <= width));
      assert.ok(rows.every((line) => !/[\r\n]/u.test(line)));
    }
  }
  host.setActivityText("Thinking");
  terminal.rows = 16;
  const leftTwoRows = widget.render(65).map(plain);
  assert.equal(leftTwoRows[0].indexOf("z"), 1);
  assert.equal(leftTwoRows[1].includes("Thinking"), false);
  terminal.rows = 8;
  assert.equal(plain(widget.render(65)[0]).indexOf("z"), 1);
  terminal.rows = 24;
  host.apply(ui, { enabled: true, animationId: "responsive", activityTextEnabled: true });
  assert.deepEqual(widget.render(65), advanced);
  assert.deepEqual([...timers.keys()], [originalTimer]);

  host.apply(ui, leftSettings);
  host.setActivityText("Thinking");
  widget.render(50);
  assert.equal(context().width, 49);
  assert.equal(context().elapsedMs, 350);
  assert.equal(context().frame, 3);
  assert.equal(getWidget(), widget);
  assert.equal(timers.size, 1);
  assert.deepEqual(widget.render(65), advanced);
  terminal.rows = 16;
  const twoRows = widget.render(65);
  assert.equal(twoRows.length, 2);
  assert.equal(twoRows[0].includes("Thinking"), false);
  assert.equal(twoRows[1].includes("Thinking"), false);
  assert.equal(context().height, 2);
  terminal.rows = 8;
  assert.equal(widget.render(65).length, 1);
  assert.equal(context().height, 1);
  terminal.rows = 24;
  assert.equal(widget.render(29).length, 3);
  assert.equal(context().width, 28);
  assert.equal(context().height, 3);
  assert.equal(context().elapsedMs, 350);
  host.setActivityText(undefined);
  assert.equal(widget.render(29).length, 3);
  assert.equal(context().width, 28);
  assert.equal(context().height, 3);
  assert.equal(widget.render(18).length, 3);
  host.setActivityText("Thinking");
  assert.equal(widget.render(18).length, 3);
  assert.equal(widget.render(1).length, 1);
  assert.equal(visibleWidth(widget.render(1)[0]), 1);
  assert.deepEqual(widget.render(0), []);
  for (const width of [1, 2, 12, 18, 19, 20, 24, 25, 26, 40, 41, 65, 120]) {
    const rows = widget.render(width);
    assert.ok(rows.length <= HUSH_ANIMATION_ROW_BUDGET);
    assert.ok(rows.every((line) => visibleWidth(line) <= width));
  }
  assert.deepEqual(widget.render(65), advanced);
  tint = "\x1b[35m";
  widget.invalidate();
  assert.ok(widget.render(65)[0].includes(tint));
  assert.equal(context().elapsedMs, 350);

  host.setActivityText("Running read");
  const beforeToggle = widget.render(65);
  assert.ok(beforeToggle.every((line) => !line.includes("Running read")));
  assert.equal(workingMessage, "Running read");

  // Widget placements reserve a stable, responsive activity column. Activity
  // updates repaint the existing widget without remounting it or changing its
  // animation canvas, row count, or timer.
  host.apply(ui, {
    enabled: true,
    animationId: "responsive",
    activityTextEnabled: true,
    activityPlacement: "widget-left",
  });
  assert.equal(nativeVisible, false);
  assert.equal(workingMessage, undefined);
  const widgetLeft = widget.render(65).map(plain);
  assert.equal(getWidget(), widget);
  assert.equal(timers.size, 1);
  assert.deepEqual(widgetLeft.map(visibleWidth), [65, 65, 65]);
  assert.equal(widgetLeft[0].indexOf("Running read"), 1);
  assert.equal(widgetLeft[0].indexOf("z"), 26);
  assert.equal(widgetLeft.slice(1).some((line) => line.includes("Running read")), false);
  assert.equal(context().width, 39);
  const requestsBeforeWidgetActivity = renderRequests;
  host.setActivityText("x\ny\x1b[31m");
  assert.equal(renderRequests, requestsBeforeWidgetActivity + 1);
  const sanitizedLeft = widget.render(65).map(plain);
  assert.equal(sanitizedLeft[0].includes("x y"), true);
  assert.equal(sanitizedLeft[0].indexOf("z"), 26);
  assert.equal(context().width, 39);
  host.setActivityText("Running " + "very-long-name ".repeat(10));
  const truncatedLeft = widget.render(65).map(plain);
  assert.equal(truncatedLeft[0].slice(1, 25), "Running very-long-name …");
  assert.equal(truncatedLeft[0].includes("very-long-name very-long-name"), false);
  assert.equal(truncatedLeft[0].indexOf("z"), 26);

  host.apply(ui, {
    enabled: true,
    animationId: "responsive",
    activityTextEnabled: true,
    activityPlacement: "widget-right",
  });
  host.setActivityText("Thinking");
  const widgetRight = widget.render(65).map(plain);
  assert.deepEqual(widgetRight.map(visibleWidth), [65, 65, 65]);
  assert.equal(widgetRight[0].indexOf("z"), 1);
  assert.equal(widgetRight[0].indexOf("Thinking"), 41);
  assert.equal(context().width, 39);
  const tooNarrowForActivity = widget.render(17).map(plain);
  assert.ok(tooNarrowForActivity.every((line) => !line.includes("Thinking")));
  assert.equal(context().width, 16);
  const minimumActivityWidth = widget.render(18).map(plain);
  assert.ok(minimumActivityWidth.some((line) => line.includes("Thinking")));
  assert.equal(context().width, 8);
  for (const width of [0, 1, 2, 3, 12, 17, 18, 24, 40, 65, 120]) {
    const rows = widget.render(width);
    assert.ok(rows.length <= HUSH_ANIMATION_ROW_BUDGET);
    assert.ok(rows.every((line) => visibleWidth(line) <= width));
    assert.ok(rows.every((line) => !/[\r\n]/u.test(line)));
  }

  host.apply(ui, {
    enabled: true,
    animationId: "responsive",
    activityTextEnabled: true,
    activityPlacement: "status",
  });
  assert.equal(nativeVisible, true);
  assert.equal(workingMessage, "Thinking");
  widget.render(65);
  assert.equal(context().width, 64);

  host.apply(ui, { enabled: true, animationId: "responsive", activityTextEnabled: false });
  widget.render(65);
  assert.equal(nativeVisible, false);
  assert.equal(workingMessage, undefined);
  assert.equal(context().width, 64);
  assert.equal(context().elapsedMs, 350);
  assert.equal(getWidget(), widget);
  assert.equal(timers.size, 1);
  tick(100); // Advance the timer without displaying a new frame.
  host.setWorking(false);
  assert.equal(mounted, undefined);
  assert.equal(timers.size, 0);
  assert.equal(nativeVisible, false);
  now += 10000;
  host.apply(ui, { ...leftSettings, widthOverride: 18 });
  assert.equal(timers.size, 0); // Changing settings while idle must not start playback.
  host.setWorking(true);
  getWidget().render(65);
  assert.equal(context().width, 18);
  assert.equal(context().elapsedMs, 350); // Idle time is not animation time.
  host.apply(ui, { enabled: true, animationId: "responsive" });
  tick(50);
  getWidget().render(65);
  assert.equal(context().elapsedMs, 400);

  host.apply(ui, { enabled: true, animationId: "recorded" });
  const recordedWidget = getWidget();
  const recordedFirst = recordedWidget.render(10);
  tick(100);
  const recordedSecond = recordedWidget.render(10);
  assert.equal(recordedFirst.length, 3);
  assert.equal(recordedSecond.length, 3);
  assert.notDeepEqual(recordedFirst, recordedSecond);
  assert.equal(recordedFirst[1].includes("  x"), true);
  for (const widthOverride of [1, 6]) {
    host.apply(ui, { enabled: true, animationId: "recorded", widthOverride });
    const resized = recordedWidget.render(10).map(plain);
    assert.equal(resized[0], " y" + " ".repeat(widthOverride - 1));
    assert.ok(resized.every((row) => visibleWidth(row) === widthOverride + 1));
    assert.equal(getWidget(), recordedWidget);
  }
  host.apply(ui, { enabled: true, animationId: "recorded" });
  terminal.rows = 8;
  // Recorded assets intentionally use stable top-left clipping, not per-frame trimming.
  assert.equal(recordedWidget.render(10).length, 1);
  terminal.rows = 16;
  assert.equal(recordedWidget.render(10).length, 2);
  terminal.rows = 24;
  host.apply(ui, { enabled: true, animationId: "responsive" });
  getWidget().render(65);
  assert.equal(context().elapsedMs, 400); // Each animation retains its own playback position.

  // Explicit sizing bypasses both default bounds, but not the terminal budget.
  const cappedSettings = {
    enabled: true, animationId: "capped", activityTextEnabled: true,
  };
  host.apply(ui, { ...cappedSettings, widthOverride: 37 });
  const cappedWidget = getWidget();
  cappedWidget.render(65);
  assert.equal(context().width, 37);
  tick(250);
  for (const widthOverride of [4, 37, { ratio: 0.6 }, Number.MAX_SAFE_INTEGER]) {
    host.apply(ui, { ...cappedSettings, widthOverride });
    cappedWidget.render(65);
    assert.equal(context().width, typeof widthOverride === "number" ? Math.min(64, widthOverride) : 38);
    assert.equal(context().height, widthOverride === 4 ? 1 : 3);
    assert.equal(context().elapsedMs, 250);
    assert.equal(getWidget(), cappedWidget);
    assert.equal(timers.size, 1);
    for (const viewport of [1, 20, 25, 26, 40, 65, 105]) {
      assert.ok(cappedWidget.render(viewport).every((row) => visibleWidth(row) <= viewport));
    }
  }
  host.apply(ui, { ...cappedSettings, widthOverride: { ratio: 0.6 } });
  cappedWidget.render(105);
  assert.equal(context().width, 62); // percent of all 104 available columns
  const beforeEqualWidth = renderRequests;
  host.apply(ui, { ...cappedSettings, widthOverride: { ratio: 0.6 } });
  assert.equal(renderRequests, beforeEqualWidth);
  host.apply(ui, cappedSettings); // auto restores built-in ratio/min/max
  cappedWidget.render(105);
  assert.equal(context().width, 20);
  assert.equal(context().elapsedMs, 250);
  assert.equal(getWidget(), cappedWidget);
  assert.throws(() => host.apply(ui, { ...cappedSettings, widthOverride: 0 }), /Invalid width/);
  assert.equal(getWidget(), cappedWidget);

  host.apply(ui, { enabled: true, animationId: "bad", widthOverride: 1 });
  assert.deepEqual(getWidget().render(65), []);
  await Promise.resolve();
  assert.equal(notifications.length, 1);
  const fallbackRows = getWidget().render(65);
  assert.deepEqual(fallbackRows.map(visibleWidth), [65, 65, 65]); // no failed override leak
  const fallbackWidget = getWidget();
  host.retryFailedAnimations(); // discovery can await I/O while this fallback stays mounted
  host.setActivityText("x");
  host.apply(ui, { enabled: true, animationId: "bad", widthOverride: 2 });
  assert.equal(getWidget(), fallbackWidget);
  assert.deepEqual(fallbackWidget.render(65).map(visibleWidth), [65, 65, 65]);
  assert.equal(timers.size, 1);
  assert.equal(nativeVisible, false);
  assert.equal(workingMessage, undefined);
  assert.deepEqual(workingIndicator, { frames: [] });
} finally {
  host.dispose({ restorePi: true });
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClearInterval;
  performance.now = originalNow;
}
assert.equal(timers.size, 0);
assert.equal(mounted, undefined);
assert.equal(nativeVisible, true);
assert.equal(workingMessage, undefined);
assert.equal(workingIndicator, undefined);
console.log("responsive animation check: ok");
