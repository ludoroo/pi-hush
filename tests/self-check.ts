/**
 * Lightweight self-check for pi-hush presentation helpers.
 * Run: node --experimental-strip-types tests/self-check.ts
 * (or: pi -e ./extensions/hush/index.ts after install smoke)
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type {
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { createHushAnimationExtension } from "../animation-api.ts";
import {
  findHushAnimationFiles,
  loadHushAnimationFiles,
} from "../extensions/hush/lib/animation-loader.ts";
import {
  parseHushAnimationPreference,
  resolveHushAnimationPreference,
  serializeHushAnimationPreference,
} from "../extensions/hush/lib/animation-preference.ts";
import {
  classifyOperationalText,
  encodeHushHideInput,
  encodeFirstmateOperationalInput,
  isOperationalInput,
  INVISIBLE_SEPARATOR,
} from "../extensions/hush/lib/operational-input.ts";
import {
  applyHushPreference,
  hushPresentationHides,
  hushPresentationIsActive,
  hushThinkingIsVisible,
  DEFAULT_HUSH_PREFERENCE,
  parseHushPreference,
  serializeHushPreference,
  setHushStockExportRendering,
} from "../extensions/hush/lib/visibility.ts";
import { getHushArgumentCompletions } from "../extensions/hush/index.ts";
import {
  HUSH_ANIMATION_MAX_HEIGHT,
  HushWorkingAnimationHost,
  HushWorkingAnimationRegistry,
  defineHushWorkingAnimation,
  normalizeHushWidgetFrame,
  renderHushAnimation,
  resolveHushAnimationWidth,
} from "../extensions/hush/lib/working-animation.ts";
import {
  BUILT_IN_HUSH_WORKING_ANIMATIONS,
  DEFAULT_HUSH_WORKING_ANIMATION_ID,
} from "../extensions/hush/lib/working-animations.ts";
import {
  HUSH_WORKING_BARS_ANIMATION,
  HUSH_WORKING_BARS_MAX_HEIGHT,
  renderHushWorkingBarCells,
  renderHushWorkingBars,
} from "../extensions/hush/lib/working-bars.ts";
import {
  HUSH_WORKING_WAVE_ANIMATION,
  HUSH_WORKING_WAVE_MAX_HEIGHT,
  HUSH_WORKING_WAVE_WIDTH,
  renderHushWorkingWave,
  renderHushWorkingWaveCells,
} from "../extensions/hush/lib/working-wave.ts";

// --- operational markers ---
const hide = encodeHushHideInput("watcher done");
assert.equal(hide.startsWith(`${INVISIBLE_SEPARATOR}HUSH_HIDE:`), true);
assert.equal(classifyOperationalText(hide), "hush-hide");
assert.equal(isOperationalInput(hide), true);

const watcher = encodeFirstmateOperationalInput(
  "watcher",
  "signal: done\n\nDrain the queue.",
);
assert.equal(classifyOperationalText(watcher), "watcher");

const fromFm = encodeFirstmateOperationalInput(
  "from-firstmate",
  "status update",
);
assert.equal(classifyOperationalText(fromFm), "from-firstmate");

// Near misses stay unclassified
assert.equal(classifyOperationalText("hello captain"), undefined);
assert.equal(
  classifyOperationalText("quote: " + watcher),
  undefined,
);
assert.equal(
  classifyOperationalText("FIRSTMATE_OP: v1 watcher: body"),
  undefined,
);
assert.equal(
  classifyOperationalText(`${INVISIBLE_SEPARATOR}unrelated text`),
  undefined,
);

// --- preference parse / serialize ---
assert.deepEqual(parseHushPreference(""), DEFAULT_HUSH_PREFERENCE);
assert.deepEqual(parseHushPreference("on"), {
  active: true,
  thinking: false,
});
assert.deepEqual(parseHushPreference("on thinking"), {
  active: true,
  thinking: true,
});
assert.deepEqual(parseHushPreference("off"), {
  active: false,
  thinking: false,
});
assert.equal(serializeHushPreference({ active: true, thinking: false }), "on\n");
assert.equal(
  serializeHushPreference({ active: true, thinking: true }),
  "on thinking\n",
);
assert.equal(serializeHushPreference({ active: false, thinking: false }), "off\n");

// Animation selection is separate so the main Hush preference stays simple.
assert.equal(parseHushAnimationPreference("bars\n"), "bars");
assert.equal(parseHushAnimationPreference("not valid!"), undefined);
assert.equal(serializeHushAnimationPreference("bars"), "bars\n");
assert.throws(() => serializeHushAnimationPreference("not valid!"), /Invalid/);

// --- command argument completion ---
assert.deepEqual(
  getHushArgumentCompletions("")?.map((item) => item.value),
  ["on", "thinking", "animation", "off"],
);
assert.deepEqual(
  getHushArgumentCompletions("thi")?.map((item) => item.value),
  ["thinking"],
);
assert.equal(getHushArgumentCompletions("thinking "), null);
assert.deepEqual(
  getHushArgumentCompletions("animation ")?.map((item) => item.value),
  ["animation wave", "animation bars"],
);
assert.deepEqual(
  getHushArgumentCompletions("animation b")?.map((item) => item.value),
  ["animation bars"],
);
assert.equal(getHushArgumentCompletions("unknown"), null);

// --- visibility policy ---
setHushStockExportRendering(false);
applyHushPreference({ active: false, thinking: false });
assert.equal(hushPresentationIsActive(), false);
assert.equal(hushPresentationHides("assistant-tool-call"), false);
assert.equal(hushPresentationHides("assistant-thinking"), false);

applyHushPreference({ active: true, thinking: false });
assert.equal(hushPresentationIsActive(), true);
assert.equal(hushThinkingIsVisible(), false);
assert.equal(hushPresentationHides("assistant-tool-call"), true);
assert.equal(hushPresentationHides("tool-result"), true);
assert.equal(hushPresentationHides("assistant-thinking"), true);
assert.equal(hushPresentationHides("synthetic-user"), true);
assert.equal(hushPresentationHides("genuine-user-prompt"), false);
assert.equal(hushPresentationHides("genuine-agent-response"), false);
assert.equal(hushPresentationHides("working-status"), false);

// /hush thinking shows CoT while tools stay hidden
applyHushPreference({ active: true, thinking: true });
assert.equal(hushThinkingIsVisible(), true);
assert.equal(hushPresentationHides("assistant-thinking"), false);
assert.equal(hushPresentationHides("assistant-tool-call"), true);
assert.equal(hushPresentationHides("working-status"), false);

// Export restores stock chrome
setHushStockExportRendering(true);
assert.equal(hushPresentationHides("assistant-tool-call"), false);
assert.equal(hushPresentationHides("assistant-thinking"), false);
setHushStockExportRendering(false);

// Default preference is on
assert.deepEqual(DEFAULT_HUSH_PREFERENCE, {
  active: true,
  thinking: false,
});

// --- adapter exports load without throwing when Pi APIs exist ---
const { installHushAssistantLayout } = await import(
  "../extensions/hush/lib/assistant-layout.ts"
);
const { installHushOperationalUserLayout } = await import(
  "../extensions/hush/lib/operational-user-layout.ts"
);
const { installHushToolExecutionLayout } = await import(
  "../extensions/hush/lib/tool-execution-layout.ts"
);
installHushAssistantLayout();
installHushOperationalUserLayout();
installHushToolExecutionLayout();

// Tool rows are hidden by their shared renderer, not by a built-in name list.
const toolRender = PiCodingAgent.ToolExecutionComponent.prototype.render;
assert.deepEqual(toolRender.call({}, 80), []);

// Idempotent reinstall
installHushAssistantLayout();
installHushOperationalUserLayout();
installHushToolExecutionLayout();

// --- working animation contracts ---
assert.equal(DEFAULT_HUSH_WORKING_ANIMATION_ID, "wave");
assert.deepEqual(
  BUILT_IN_HUSH_WORKING_ANIMATIONS.map((animation) => animation.id),
  ["wave", "bars"],
);
assert.equal(
  BUILT_IN_HUSH_WORKING_ANIMATIONS.every(
    (animation) => animation.maxHeight === 1,
  ),
  true,
);
const normalizedWidgetFrame = normalizeHushWidgetFrame(
  ["abcdef", "x"],
  3,
  1,
);
assert.deepEqual(normalizedWidgetFrame.map(visibleWidth), [3]);
assert.equal(normalizedWidgetFrame[0]?.startsWith("abc"), true);
const testAnimation = defineHushWorkingAnimation({
  id: "test",
  label: "Test",
  description: "Contract test",
  intervalMs: 100,
  width: 1,
  maxHeight: 1,
  renderFrame: () => ({ text: "x", color: "accent" }),
});
const declarativeAnimation = defineHushWorkingAnimation({
  kind: "frames",
  id: "declarative",
  label: "Declarative",
  description: "Frame contract test",
  intervalMs: 100,
  width: 2,
  maxHeight: 1,
  frames: [
    { text: "· ", color: "muted" },
    {
      segments: [
        { text: "•", color: "secondary" },
        { text: "●", color: "highlight" },
      ],
    },
  ],
});
const taggedPalette = {
  accent: (text: string) => `<accent>${text}</accent>`,
  secondary: (text: string) => `<secondary>${text}</secondary>`,
  tertiary: (text: string) => `<tertiary>${text}</tertiary>`,
  highlight: (text: string) => `<highlight>${text}</highlight>`,
  muted: (text: string) => `<muted>${text}</muted>`,
};
assert.deepEqual(
  renderHushAnimation(
    declarativeAnimation,
    {
      frame: 0,
      width: 2,
      viewportWidth: 4,
    },
    taggedPalette,
  ),
  ["<muted>· </muted>"],
);
assert.deepEqual(
  renderHushAnimation(
    declarativeAnimation,
    {
      frame: 1,
      width: 2,
      viewportWidth: 4,
    },
    taggedPalette,
  ),
  ["<secondary>•</secondary><highlight>●</highlight>"],
);
const testRegistry = new HushWorkingAnimationRegistry([
  testAnimation,
  declarativeAnimation,
]);
assert.equal(testRegistry.get("test"), testAnimation);
assert.equal(testRegistry.get("declarative"), declarativeAnimation);
assert.throws(() => testRegistry.register(testAnimation), /Duplicate/);
assert.throws(
  () =>
    new HushWorkingAnimationRegistry([
      { ...testAnimation, id: undefined as unknown as string },
    ]),
  /Invalid Hush animation id/,
);
assert.throws(
  () =>
    new HushWorkingAnimationRegistry([
      {
        ...declarativeAnimation,
        id: "bad-color",
        frames: [{ text: "x", color: "red" as "accent" }],
      },
    ]),
  /Invalid frames/,
);
const replacementAnimation = defineHushWorkingAnimation({
  ...testAnimation,
  id: "replacement",
});
testRegistry.reset([replacementAnimation]);
assert.equal(testRegistry.get("test"), undefined);
assert.equal(testRegistry.get("replacement"), replacementAnimation);
testRegistry.reset([testAnimation]);
let discoveryHandler: ((data: unknown) => void) | undefined;
createHushAnimationExtension(testAnimation)({
  events: {
    on: (channel: string, handler: (data: unknown) => void) => {
      assert.equal(channel, "pi-hush:discover-animations");
      discoveryHandler = handler;
      return () => {};
    },
  },
} as unknown as PiCodingAgent.ExtensionAPI);
let discoveredAnimationId: string | undefined;
discoveryHandler?.({
  apiVersion: 1,
  register: (animation: { id: string }) => {
    discoveredAnimationId = animation.id;
  },
});
assert.equal(discoveredAnimationId, "test");
assert.throws(
  () =>
    new HushWorkingAnimationRegistry([
      {
        ...testAnimation,
        id: "too-tall",
        maxHeight: HUSH_ANIMATION_MAX_HEIGHT + 1,
      },
    ]),
  /Invalid height/,
);
assert.equal(
  resolveHushAnimationPreference("test", testRegistry, "test"),
  "test",
);
assert.equal(
  resolveHushAnimationPreference("  TEST \n", testRegistry, "test"),
  "test",
);
assert.equal(
  resolveHushAnimationPreference("cat", testRegistry, "test"),
  "test",
);

// Theme-like files and one-level index modules are discovered deterministically.
const animationRoot = mkdtempSync(join(tmpdir(), "pi-hush-animations-"));
try {
  writeFileSync(
    join(animationRoot, "spark.ts"),
    `export default {
      id: "spark", label: "Spark", description: "test", intervalMs: 100,
      width: { ratio: 0.25, minColumns: 4 }, maxHeight: 1,
      renderFrame(context: { width: number }) { return ["x".repeat(context.width)]; }
    };`,
  );
  mkdirSync(join(animationRoot, "pack"));
  writeFileSync(
    join(animationRoot, "pack", "index.mjs"),
    `export default {
      id: "pack", label: "Pack", description: "test", intervalMs: 100,
      width: 2, maxHeight: 1, renderFrame() { return ["xx"]; }
    };`,
  );
  const animationFiles = findHushAnimationFiles([animationRoot]);
  assert.equal(animationFiles.length, 2);
  const loadedAnimations = await loadHushAnimationFiles(animationFiles);
  assert.deepEqual(
    loadedAnimations.map(({ animation }) => animation.id),
    ["pack", "spark"],
  );
  const discoveredRegistry = new HushWorkingAnimationRegistry(
    loadedAnimations.map(({ animation }) => animation),
  );
  assert.ok(discoveredRegistry.get("spark"));
} finally {
  rmSync(animationRoot, { recursive: true, force: true });
}

// The host owns one temporary widget surface and restores Pi's native status.
type TestIntervalHandle = ReturnType<typeof setInterval>;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const intervalCallbacks = new Map<TestIntervalHandle, () => void>();
globalThis.setInterval = ((callback: () => void) => {
  const handle = { unref() {} } as unknown as TestIntervalHandle;
  intervalCallbacks.set(handle, callback);
  return handle;
}) as typeof setInterval;
globalThis.clearInterval = ((handle: TestIntervalHandle | undefined) => {
  if (handle !== undefined) intervalCallbacks.delete(handle);
}) as typeof clearInterval;

const throwingAnimation = defineHushWorkingAnimation({
  ...testAnimation,
  id: "throwing",
  renderFrame: () => {
    throw new Error("broken renderer");
  },
});
const invalidFrameAnimation = defineHushWorkingAnimation({
  ...testAnimation,
  id: "invalid-frame",
  renderFrame: (() =>
    "not an array") as unknown as typeof testAnimation.renderFrame,
});
const hostRegistry = new HushWorkingAnimationRegistry([
  ...BUILT_IN_HUSH_WORKING_ANIMATIONS,
  throwingAnimation,
  invalidFrameAnimation,
]);
const hostTui = { requestRender() {} } as unknown as TUI;
const renderedThemeColors: string[] = [];
const hostTheme = {
  fg: (color: string, text: string) => {
    renderedThemeColors.push(color);
    return text;
  },
} as unknown as Theme;
let hostWidget: (Component & { dispose?(): void }) | undefined;
let workingVisible = true;
const hostNotifications: string[] = [];
const hostUi = {
  theme: hostTheme,
  setWidget: (
    _key: string,
    content:
      | undefined
      | ((tui: TUI, theme: Theme) => Component & { dispose?(): void }),
  ) => {
    hostWidget?.dispose?.();
    hostWidget =
      typeof content === "function" ? content(hostTui, hostTheme) : undefined;
  },
  setWorkingVisible: (visible: boolean) => {
    workingVisible = visible;
  },
  notify: (message: string) => {
    hostNotifications.push(message);
  },
} as unknown as ExtensionUIContext;
const animationHost = new HushWorkingAnimationHost(
  hostRegistry,
  DEFAULT_HUSH_WORKING_ANIMATION_ID,
);
animationHost.apply(hostUi, { enabled: true, animationId: "wave" });
assert.equal(hostWidget, undefined);
assert.equal(workingVisible, true);
animationHost.setWorking(true);
assert.equal(workingVisible, false);
assert.equal(intervalCallbacks.size, 1);
const mountedWaveWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.ok(mountedWaveWidget);
const initialWaveFrame = mountedWaveWidget.render(30);
assert.equal(initialWaveFrame.length, HUSH_WORKING_WAVE_MAX_HEIGHT);
assert.equal(visibleWidth(initialWaveFrame[0] ?? ""), 14);
assert.equal(
  ["accent", "syntaxVariable", "syntaxFunction", "warning"].every((color) =>
    renderedThemeColors.includes(color),
  ),
  true,
);
animationHost.apply(hostUi, { enabled: true, animationId: "wave" });
assert.equal(hostWidget, mountedWaveWidget);

const advanceWave = intervalCallbacks.values().next().value;
assert.ok(advanceWave);
advanceWave();
advanceWave();
const advancedWaveFrame = mountedWaveWidget.render(30);
assert.notDeepEqual(advancedWaveFrame, initialWaveFrame);
animationHost.setWorking(false);
assert.equal(hostWidget, undefined);
assert.equal(intervalCallbacks.size, 0);
animationHost.setWorking(true);
assert.equal(intervalCallbacks.size, 1);
const resumedWaveWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.ok(resumedWaveWidget);
assert.deepEqual(resumedWaveWidget.render(30), advancedWaveFrame);

// User-authored renderer failures never escape the widget or leave a blank loader.
animationHost.apply(hostUi, { enabled: true, animationId: "throwing" });
const throwingWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.ok(throwingWidget);
assert.deepEqual(throwingWidget.render(30), []);
await Promise.resolve();
assert.notEqual(hostWidget, throwingWidget);
assert.equal(workingVisible, false);
assert.equal(
  hostNotifications.some((message) => message.includes("throwing")),
  true,
);
const throwingFallbackWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.doesNotThrow(() => throwingFallbackWidget?.render(30));

animationHost.apply(hostUi, { enabled: true, animationId: "invalid-frame" });
const invalidFrameWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.ok(invalidFrameWidget);
assert.deepEqual(invalidFrameWidget.render(30), []);
await Promise.resolve();
assert.notEqual(hostWidget, invalidFrameWidget);
assert.equal(
  hostNotifications.some((message) => message.includes("invalid-frame")),
  true,
);

animationHost.apply(hostUi, { enabled: true, animationId: "bars" });
const mountedBarsWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.ok(mountedBarsWidget);
assert.notEqual(mountedBarsWidget, resumedWaveWidget);
assert.equal(intervalCallbacks.size, 1);
assert.equal(
  mountedBarsWidget.render(30).length,
  HUSH_WORKING_BARS_MAX_HEIGHT,
);
animationHost.setWorking(false);
assert.equal(hostWidget, undefined);
assert.equal(workingVisible, true);
assert.equal(intervalCallbacks.size, 0);
animationHost.setWorking(true);
assert.equal(intervalCallbacks.size, 1);
animationHost.apply(hostUi, {
  enabled: true,
  animationId: "bars",
  widgetsEnabled: false,
});
assert.equal(hostWidget, undefined);
assert.equal(workingVisible, true);
assert.equal(intervalCallbacks.size, 0);
animationHost.apply(hostUi, {
  enabled: true,
  animationId: "bars",
  widgetsEnabled: true,
});
assert.ok(hostWidget);
assert.equal(intervalCallbacks.size, 1);
animationHost.apply(hostUi, { enabled: false, animationId: "bars" });
assert.equal(hostWidget, undefined);
assert.equal(workingVisible, true);
assert.equal(intervalCallbacks.size, 0);
animationHost.dispose({ restorePi: true });
assert.equal(intervalCallbacks.size, 0);
globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;

// --- compact accent waveform ---
const plainPalette = {
  accent: (text: string) => text,
  secondary: (text: string) => text,
  tertiary: (text: string) => text,
  highlight: (text: string) => text,
  muted: (text: string) => text,
};
assert.equal(renderHushWorkingWaveCells(0, 0), "");
for (const width of [1, 3, HUSH_WORKING_WAVE_WIDTH]) {
  const frame = renderHushWorkingWaveCells(width, 0);
  assert.equal(visibleWidth(frame), width);
  assert.equal(
    Array.from(frame).every((glyph) => {
      const codePoint = glyph.codePointAt(0) ?? 0;
      return codePoint >= 0x2800 && codePoint <= 0x28ff;
    }),
    true,
  );
}
assert.equal(resolveHushAnimationWidth(12, 0), 0);
assert.equal(resolveHushAnimationWidth(12, 8), 8);
assert.equal(resolveHushAnimationWidth(12, 80), 12);
assert.equal(
  resolveHushAnimationWidth(
    { ratio: 0.25, minColumns: 8, maxColumns: 30 },
    80,
  ),
  20,
);
assert.equal(
  resolveHushAnimationWidth(
    { ratio: 0.25, minColumns: 8, maxColumns: 30 },
    20,
  ),
  8,
);
assert.throws(
  () =>
    new HushWorkingAnimationRegistry([
      { ...testAnimation, id: "bad-width", width: { ratio: 2 } },
    ]),
  /Invalid width/,
);
const waveAtStart = renderHushAnimation(
  HUSH_WORKING_WAVE_ANIMATION,
  {
    frame: 0,
    width: HUSH_WORKING_WAVE_WIDTH,
    viewportWidth: 80,
  },
  plainPalette,
);
const waveLater = renderHushAnimation(
  HUSH_WORKING_WAVE_ANIMATION,
  {
    frame: 4,
    width: HUSH_WORKING_WAVE_WIDTH,
    viewportWidth: 80,
  },
  plainPalette,
);
assert.equal(waveAtStart.length, 1);
assert.equal(visibleWidth(waveAtStart[0] ?? ""), HUSH_WORKING_WAVE_WIDTH);
assert.notDeepEqual(waveAtStart, waveLater);
assert.notDeepEqual(
  renderHushWorkingWave({
    frame: 0,
    width: HUSH_WORKING_WAVE_WIDTH,
    viewportWidth: 80,
  }),
  renderHushWorkingWave({
    frame: 4,
    width: HUSH_WORKING_WAVE_WIDTH,
    viewportWidth: 80,
  }),
);
for (const width of [1, 2, 8]) {
  const lines = renderHushAnimation(
    HUSH_WORKING_WAVE_ANIMATION,
    { frame: 2, width, viewportWidth: width },
    plainPalette,
  );
  assert.equal(lines.every((line) => visibleWidth(line) <= width), true);
}

// --- compact accent equalizer bars ---
const barCharacters = new Set(Array.from("▁▂▃▄▅▆▇█"));
const barsAtStart = renderHushWorkingBarCells(10, 0);
const barsLater = renderHushWorkingBarCells(10, 3);
assert.equal(visibleWidth(barsAtStart), 10);
assert.equal(Array.from(barsAtStart).every((bar) => barCharacters.has(bar)), true);
assert.notEqual(barsAtStart, barsLater);
const renderedBars = renderHushAnimation(
  HUSH_WORKING_BARS_ANIMATION,
  { frame: 0, width: 10, viewportWidth: 80 },
  plainPalette,
);
assert.equal(renderedBars.length, HUSH_WORKING_BARS_MAX_HEIGHT);
assert.equal(visibleWidth(renderedBars[0] ?? ""), 10);
assert.ok(
  "segments" in
    renderHushWorkingBars({
      frame: 0,
      width: 10,
      viewportWidth: 80,
    }),
);
for (const width of [1, 2, 8]) {
  const lines = renderHushAnimation(
    HUSH_WORKING_BARS_ANIMATION,
    { frame: 2, width, viewportWidth: width },
    plainPalette,
  );
  assert.equal(lines.every((line) => visibleWidth(line) <= width), true);
}

console.log("pi-hush self-check: ok");
