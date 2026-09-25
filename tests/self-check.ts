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
  HushPresentationPublisher,
  parseHushPreference,
  serializeHushPreference,
  setHushStockExportRendering,
} from "../extensions/hush/lib/visibility.ts";
import { getHushArgumentCompletions } from "../extensions/hush/index.ts";
import {
  HUSH_ANIMATION_MAX_HEIGHT,
  HUSH_LOADER_INDENT,
  HushAnimationHost,
  HushAnimationRegistry,
  composeHushWorkingLine,
  defineHushWorkingAnimation,
  normalizeHushWidgetFrame,
  renderHushAnimation,
  resolveHushAnimationWidth,
} from "../extensions/hush/lib/animation.ts";
import {
  DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED,
  HushActivityTracker,
  parseHushActivityPreference,
  sanitizeHushToolName,
  serializeHushActivityPreference,
} from "../extensions/hush/lib/activity.ts";
import {
  BUILT_IN_HUSH_ANIMATIONS,
  DEFAULT_HUSH_ANIMATION_ID,
} from "../extensions/hush/lib/animations.ts";
import {
  HUSH_BARS_ANIMATION,
  HUSH_BARS_MAX_HEIGHT,
  renderHushBarCells,
  renderHushBars,
} from "../extensions/hush/lib/bars.ts";
import {
  HUSH_SHOOTING_STAR_ANIMATION,
  renderHushShootingStar,
} from "../extensions/hush/lib/shooting-star.ts";
import {
  HUSH_JUMPING_DOTS_ANIMATION,
  HUSH_JUMPING_DOT_LEVELS,
  HUSH_JUMPING_DOTS_WIDTH,
  renderHushJumpingDots,
} from "../extensions/hush/lib/jumping-dots.ts";
import {
  HUSH_ORBIT_ANIMATION,
  renderHushOrbit,
} from "../extensions/hush/lib/orbit.ts";
import {
  HUSH_WAVE_ANIMATION,
  HUSH_WAVE_MAX_HEIGHT,
  HUSH_WAVE_WAVELENGTH,
  HUSH_WAVE_WIDTH,
  renderHushWave,
  renderHushWaveCells,
} from "../extensions/hush/lib/wave.ts";

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

// Activity text is a separate, default-off preference.
assert.equal(DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED, false);
assert.equal(parseHushActivityPreference("on\n"), true);
assert.equal(parseHushActivityPreference(" OFF "), false);
assert.equal(parseHushActivityPreference("unknown"), false);
assert.equal(parseHushActivityPreference(""), false);
assert.equal(serializeHushActivityPreference(true), "on\n");
assert.equal(serializeHushActivityPreference(false), "off\n");

// --- command argument completion ---
assert.deepEqual(
  getHushArgumentCompletions("")?.map((item) => item.value),
  ["on", "thinking", "activity", "animation", "off"],
);
assert.deepEqual(
  getHushArgumentCompletions("thi")?.map((item) => item.value),
  ["thinking"],
);
assert.equal(getHushArgumentCompletions("thinking "), null);
assert.deepEqual(
  getHushArgumentCompletions("animation ")?.map((item) => item.value),
  [
    "animation wave",
    "animation bars",
    "animation orbit",
    "animation jumping-dots",
    "animation shooting-star",
    "animation flock",
    "animation fish-loop",
  ],
);
assert.deepEqual(
  getHushArgumentCompletions("animation b")?.map((item) => item.value),
  ["animation bars"],
);
assert.deepEqual(
  getHushArgumentCompletions("act")?.map((item) => item.value),
  ["activity"],
);
assert.equal(getHushArgumentCompletions("activity "), null);
assert.equal(getHushArgumentCompletions("unknown"), null);

// --- working activity state ---
assert.equal(sanitizeHushToolName(" read\n\tfiles "), "read files");
assert.equal(sanitizeHushToolName("\x1b[31mread\x1b[0m"), "read");
assert.equal(sanitizeHushToolName("\x1b]0;bad title\x07bash"), "bash");
assert.equal(
  sanitizeHushToolName(
    "\x1b]8;;https://example.com\x1b\\read\x1b]8;;\x1b\\",
  ),
  "read",
);
assert.equal(sanitizeHushToolName("\x1b]unterminated"), "tool");
assert.equal(sanitizeHushToolName("\u061c\u202eread\u2066"), "read");
assert.equal(sanitizeHushToolName("\n\t\x00"), "tool");
assert.equal(sanitizeHushToolName("x".repeat(100)).length, 80);

const activity = new HushActivityTracker();
assert.equal(activity.text, undefined);
activity.startRun();
assert.equal(activity.text, "Thinking…");
activity.updateAssistant("thinking_delta");
assert.equal(activity.text, "Thinking…");
activity.updateAssistant("text_start");
assert.equal(activity.text, "Responding…");
activity.updateAssistant("toolcall_start");
assert.equal(activity.text, "Thinking…");
activity.startTool("read-1", "read");
assert.equal(activity.text, "Running read…");
activity.startTool("bash-1", "bash");
activity.startTool("grep-1", "grep");
assert.equal(activity.text, "Running read +2…");
activity.startTool("read-1", "ignored duplicate");
activity.updateAssistant("text_delta");
assert.equal(activity.text, "Running read +2…");
activity.endTool("bash-1");
assert.equal(activity.text, "Running read +1…");
activity.endTool("unknown");
assert.equal(activity.text, "Running read +1…");
activity.endTool("read-1");
assert.equal(activity.text, "Running grep…");
activity.endTool("grep-1");
assert.equal(activity.text, "Thinking…");
activity.updateAssistant("text_delta");
assert.equal(activity.text, "Responding…");
activity.endRun();
assert.equal(activity.text, "Thinking…");
activity.startTool("stale", "bash");
activity.startRun();
assert.equal(activity.text, "Thinking…");
activity.reset();
assert.equal(activity.text, undefined);
activity.startTurn();
activity.startTool("orphan", "bash");
assert.equal(activity.text, undefined);

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

// Identical presentation states are emitted once, not once per token delta.
const presentationPublisher = new HushPresentationPublisher();
const publishedPresentationStates: unknown[] = [];
const presentationState = {
  active: true,
  thinking: false,
  workingAnimationId: "wave",
  activityTextEnabled: true,
  activityText: "Thinking…",
  stockExportRendering: false,
};
assert.equal(
  presentationPublisher.publish(presentationState, (state) =>
    publishedPresentationStates.push(state),
  ),
  true,
);
assert.equal(
  presentationPublisher.publish({ ...presentationState }, (state) =>
    publishedPresentationStates.push(state),
  ),
  false,
);
assert.equal(
  presentationPublisher.publish(
    { ...presentationState, activityText: "Responding…" },
    (state) => publishedPresentationStates.push(state),
  ),
  true,
);
assert.equal(publishedPresentationStates.length, 2);
presentationPublisher.reset();
assert.equal(
  presentationPublisher.publish(
    { ...presentationState, activityText: "Responding…" },
    (state) => publishedPresentationStates.push(state),
  ),
  true,
);
assert.equal(publishedPresentationStates.length, 3);

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
assert.equal(DEFAULT_HUSH_ANIMATION_ID, "wave");
assert.deepEqual(
  BUILT_IN_HUSH_ANIMATIONS.map((animation) => animation.id),
  ["wave", "bars", "orbit", "jumping-dots", "shooting-star", "flock", "fish-loop"],
);
assert.equal(
  BUILT_IN_HUSH_ANIMATIONS.every(
    (animation) => animation.maxHeight >= 1 && animation.maxHeight <= 3,
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
assert.equal(
  composeHushWorkingLine({
    animationLine: "abc",
    animationWidth: 3,
    viewportWidth: 30,
  }),
  "abc",
);
assert.equal(
  composeHushWorkingLine({
    animationLine: "x",
    animationWidth: 3,
    viewportWidth: 30,
    activityText: "Thinking…",
  }),
  "x   Thinking…",
);
assert.equal(
  composeHushWorkingLine({
    animationLine: "abc",
    animationWidth: 3,
    viewportWidth: 5,
    activityText: "Thinking…",
  }),
  "abc …",
);
const clippedWorkingLine = composeHushWorkingLine({
  animationLine: "abc",
  animationWidth: 3,
  viewportWidth: 10,
  activityText: "Responding…",
  styleActivity: (text) => `\x1b[2m${text}\x1b[22m`,
});
assert.equal(visibleWidth(clippedWorkingLine), 10);
assert.equal(clippedWorkingLine.includes("\x1b[2mRespo…\x1b[22m"), true);
assert.equal(clippedWorkingLine.includes("\n"), false);
assert.equal(
  composeHushWorkingLine({
    animationLine: "abc",
    animationWidth: 3,
    viewportWidth: 9,
    activityText: "Thinking…",
  }),
  "abc Thin…",
);
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
const testRegistry = new HushAnimationRegistry([
  testAnimation,
  declarativeAnimation,
]);
assert.equal(testRegistry.get("test"), testAnimation);
assert.equal(testRegistry.get("declarative"), declarativeAnimation);
assert.throws(() => testRegistry.register(testAnimation), /Duplicate/);
assert.throws(
  () =>
    new HushAnimationRegistry([
      { ...testAnimation, id: undefined as unknown as string },
    ]),
  /Invalid Hush animation id/,
);
assert.throws(
  () =>
    new HushAnimationRegistry([
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
    new HushAnimationRegistry([
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
  const discoveredRegistry = new HushAnimationRegistry(
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
const realPerformanceNow = performance.now;
let hostNow = 0;
performance.now = () => hostNow;
globalThis.setInterval = ((callback: () => void, intervalMs: number) => {
  const handle = { unref() {} } as unknown as TestIntervalHandle;
  intervalCallbacks.set(handle, () => {
    hostNow += intervalMs;
    callback();
  });
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
const hostRegistry = new HushAnimationRegistry([
  ...BUILT_IN_HUSH_ANIMATIONS,
  throwingAnimation,
  invalidFrameAnimation,
]);
let hostRenderRequests = 0;
const hostTui = {
  terminal: { rows: 24 },
  requestRender() {
    hostRenderRequests += 1;
  },
} as unknown as TUI;
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
const animationHost = new HushAnimationHost(
  hostRegistry,
  DEFAULT_HUSH_ANIMATION_ID,
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
assert.equal(initialWaveFrame.length, HUSH_WAVE_MAX_HEIGHT);
assert.equal(
  visibleWidth(initialWaveFrame[0] ?? ""),
  HUSH_LOADER_INDENT +
    Math.min(HUSH_WAVE_WIDTH, 30 - HUSH_LOADER_INDENT),
);
assert.equal(initialWaveFrame[0]?.search(/\S/), HUSH_LOADER_INDENT);
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

// Activity updates reuse the mounted widget and timer, preserving animation state.
animationHost.setActivityText("Thinking…");
assert.deepEqual(resumedWaveWidget.render(30), advancedWaveFrame);
animationHost.apply(hostUi, {
  enabled: true,
  animationId: "wave",
  activityTextEnabled: true,
});
const activityWaveWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.ok(activityWaveWidget);
assert.equal(activityWaveWidget, resumedWaveWidget);
assert.equal(intervalCallbacks.size, 1);
assert.equal(activityWaveWidget.render(40)[0]?.includes("Thinking…"), true);
assert.equal(activityWaveWidget.render(14)[0], " Thinking…");
const rendersBeforeActivityUpdate = hostRenderRequests;
animationHost.setActivityText("Running read…");
assert.equal(hostWidget, activityWaveWidget);
assert.equal(intervalCallbacks.size, 1);
assert.equal(hostRenderRequests, rendersBeforeActivityUpdate + 1);
assert.equal(activityWaveWidget.render(40)[0]?.includes("Running read…"), true);

// Activity keeps 24 columns ahead of even a 100%-width animation.
animationHost.apply(hostUi, {
  enabled: true,
  animationId: "shooting-star",
  activityTextEnabled: true,
});
const shootingStarWidget = (():
  | (Component & { dispose?(): void })
  | undefined => hostWidget)();
assert.ok(shootingStarWidget);
const shootingStarActivityLine = shootingStarWidget.render(40)[0] ?? "";
assert.equal(visibleWidth(shootingStarActivityLine), 30);
assert.equal(shootingStarActivityLine.includes("Running read…"), true);
animationHost.apply(hostUi, {
  enabled: true,
  animationId: "shooting-star",
  activityTextEnabled: false,
});
assert.equal(hostWidget, shootingStarWidget);
assert.equal(intervalCallbacks.size, 1);
assert.equal(visibleWidth(shootingStarWidget.render(40)[0] ?? ""), 40);

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
  HUSH_BARS_MAX_HEIGHT,
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
performance.now = realPerformanceNow;

// --- compact accent waveform ---
const plainPalette = {
  accent: (text: string) => text,
  secondary: (text: string) => text,
  tertiary: (text: string) => text,
  highlight: (text: string) => text,
  muted: (text: string) => text,
};
assert.equal(renderHushWaveCells(0, 0), "");
for (const width of [1, 3, HUSH_WAVE_WIDTH]) {
  const frame = renderHushWaveCells(width, 0);
  assert.equal(visibleWidth(frame), width);
  assert.equal(
    Array.from(frame).every((glyph) => {
      const codePoint = glyph.codePointAt(0) ?? 0;
      return codePoint >= 0x2800 && codePoint <= 0x28ff;
    }),
    true,
  );
}
const highFrequencyWave = Array.from(
  renderHushWaveCells(HUSH_WAVE_WIDTH, 0),
);
const waveCellsPerCycle = HUSH_WAVE_WAVELENGTH / 2;
assert.deepEqual(
  highFrequencyWave.slice(0, waveCellsPerCycle),
  highFrequencyWave.slice(waveCellsPerCycle, waveCellsPerCycle * 2),
);
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
    new HushAnimationRegistry([
      { ...testAnimation, id: "bad-width", width: { ratio: 2 } },
    ]),
  /Invalid width/,
);
const waveAtStart = renderHushAnimation(
  HUSH_WAVE_ANIMATION,
  {
    frame: 0,
    width: HUSH_WAVE_WIDTH,
    viewportWidth: 80,
  },
  plainPalette,
);
const waveLater = renderHushAnimation(
  HUSH_WAVE_ANIMATION,
  {
    frame: 4,
    width: HUSH_WAVE_WIDTH,
    viewportWidth: 80,
  },
  plainPalette,
);
assert.equal(waveAtStart.length, 1);
assert.equal(visibleWidth(waveAtStart[0] ?? ""), HUSH_WAVE_WIDTH);
assert.notDeepEqual(waveAtStart, waveLater);
assert.notDeepEqual(
  renderHushWave({
    frame: 0,
    width: HUSH_WAVE_WIDTH,
    viewportWidth: 80,
  }),
  renderHushWave({
    frame: 4,
    width: HUSH_WAVE_WIDTH,
    viewportWidth: 80,
  }),
);
for (const width of [1, 2, 8]) {
  const lines = renderHushAnimation(
    HUSH_WAVE_ANIMATION,
    { frame: 2, width, viewportWidth: width },
    plainPalette,
  );
  assert.equal(lines.every((line) => visibleWidth(line) <= width), true);
}

// --- compact accent equalizer bars ---
const barCharacters = new Set(Array.from("▁▂▃▄▅▆▇█"));
const barsAtStart = renderHushBarCells(10, 0);
const barsLater = renderHushBarCells(10, 3);
assert.equal(visibleWidth(barsAtStart), 10);
assert.equal(Array.from(barsAtStart).every((bar) => barCharacters.has(bar)), true);
assert.notEqual(barsAtStart, barsLater);
const renderedBars = renderHushAnimation(
  HUSH_BARS_ANIMATION,
  { frame: 0, width: 10, viewportWidth: 80 },
  plainPalette,
);
assert.equal(renderedBars.length, HUSH_BARS_MAX_HEIGHT);
assert.equal(visibleWidth(renderedBars[0] ?? ""), 10);
assert.ok(
  "segments" in
    renderHushBars({
      frame: 0,
      width: 10,
      viewportWidth: 80,
    }),
);
for (const width of [1, 2, 8]) {
  const lines = renderHushAnimation(
    HUSH_BARS_ANIMATION,
    { frame: 2, width, viewportWidth: width },
    plainPalette,
  );
  assert.equal(lines.every((line) => visibleWidth(line) <= width), true);
}

// --- compact orbit ---
const orbitAtStart = renderHushAnimation(
  HUSH_ORBIT_ANIMATION,
  { frame: 0, width: 9, viewportWidth: 40 },
  plainPalette,
);
const orbitQuarterTurn = renderHushAnimation(
  HUSH_ORBIT_ANIMATION,
  { frame: 4, width: 9, viewportWidth: 40 },
  plainPalette,
);
assert.equal(visibleWidth(orbitAtStart[0] ?? ""), 9);
assert.notDeepEqual(orbitAtStart, orbitQuarterTurn);
assert.deepEqual(
  renderHushOrbit({ frame: 4, width: 9, viewportWidth: 40 }),
  renderHushOrbit({ frame: 4, width: 9, viewportWidth: 40 }),
);
const themedOrbit = renderHushAnimation(
  HUSH_ORBIT_ANIMATION,
  { frame: 0, width: 9, viewportWidth: 40 },
  taggedPalette,
)[0] ?? "";
assert.equal(themedOrbit.includes("<accent>"), true);
assert.equal(themedOrbit.includes("<highlight>"), true);
for (const width of [1, 4, 9]) {
  const line = renderHushAnimation(
    HUSH_ORBIT_ANIMATION,
    { frame: 3, width, viewportWidth: width },
    plainPalette,
  )[0] ?? "";
  assert.equal(visibleWidth(line), width);
}

// --- compact travelling bounce ---
assert.deepEqual(HUSH_JUMPING_DOT_LEVELS, ["°", "°", "o", "ₒ", "ₒ", "o"]);
for (const glyph of new Set(HUSH_JUMPING_DOT_LEVELS)) {
  assert.equal(visibleWidth(glyph), 1);
}
const jumpingDotsAtStart = renderHushAnimation(
  HUSH_JUMPING_DOTS_ANIMATION,
  { frame: 0, width: HUSH_JUMPING_DOTS_WIDTH, viewportWidth: 40 },
  plainPalette,
)[0] ?? "";
assert.equal(jumpingDotsAtStart, "° ₒ o");
assert.equal(
  renderHushAnimation(
    HUSH_JUMPING_DOTS_ANIMATION,
    { frame: 2, width: HUSH_JUMPING_DOTS_WIDTH, viewportWidth: 40 },
    plainPalette,
  )[0],
  "o ° ₒ",
);
assert.equal(
  renderHushAnimation(
    HUSH_JUMPING_DOTS_ANIMATION,
    { frame: 4, width: HUSH_JUMPING_DOTS_WIDTH, viewportWidth: 40 },
    plainPalette,
  )[0],
  "ₒ o °",
);
assert.deepEqual(
  renderHushJumpingDots({
    frame: 3,
    width: HUSH_JUMPING_DOTS_WIDTH,
    viewportWidth: 40,
  }),
  renderHushJumpingDots({
    frame: 3,
    width: HUSH_JUMPING_DOTS_WIDTH,
    viewportWidth: 40,
  }),
);
for (const width of [1, 2, HUSH_JUMPING_DOTS_WIDTH]) {
  const line = renderHushAnimation(
    HUSH_JUMPING_DOTS_ANIMATION,
    { frame: 2, width, viewportWidth: width },
    plainPalette,
  )[0] ?? "";
  assert.equal(visibleWidth(line), width);
}

// --- ratio:1 shooting-star reference ---
assert.deepEqual(HUSH_SHOOTING_STAR_ANIMATION.width, { ratio: 1 });
const shootingStarAtStart = renderHushAnimation(
  HUSH_SHOOTING_STAR_ANIMATION,
  { frame: 0, width: 20, viewportWidth: 20 },
  plainPalette,
);
const shootingStarLater = renderHushAnimation(
  HUSH_SHOOTING_STAR_ANIMATION,
  { frame: 5, width: 20, viewportWidth: 20 },
  plainPalette,
);
assert.notDeepEqual(shootingStarAtStart, shootingStarLater);
assert.deepEqual(
  renderHushShootingStar({ frame: 5, width: 20, viewportWidth: 20 }),
  renderHushShootingStar({ frame: 5, width: 20, viewportWidth: 20 }),
);
for (const width of [1, 8, 40]) {
  const line = renderHushAnimation(
    HUSH_SHOOTING_STAR_ANIMATION,
    { frame: 5, width, viewportWidth: width },
    plainPalette,
  )[0] ?? "";
  assert.equal(visibleWidth(line), width);
}

// Keep the existing entrypoint running the focused behavior suites too.
await import("./responsive-animation-check.ts");
await import("./fish-check.ts");
await import("./flock-check.ts");

console.log("pi-hush self-check: ok");
