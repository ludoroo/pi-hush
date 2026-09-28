import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import installHush, {
  getHushArgumentCompletions,
} from "../extensions/hush/index.ts";
import {
  HUSH_PRESENTATION_EVENT,
  type HushPresentationState,
} from "../extensions/hush/lib/visibility.ts";
import {
  createHushAnimationSettings,
  getHushAnimationWidthOverride,
  parseHushWidthArgument,
  updateHushAnimationWidthOverride,
  type HushAnimationSettings,
} from "../extensions/hush/lib/animation-settings.ts";

// Command values accept safe fixed columns, bounded decimal percentages, and reset.
assert.equal(parseHushWidthArgument("28"), 28);
assert.deepEqual(parseHushWidthArgument("60%"), { ratio: 0.6 });
assert.deepEqual(parseHushWidthArgument(".5%"), { ratio: 0.005 });
assert.deepEqual(parseHushWidthArgument("100.0%"), { ratio: 1 });
assert.equal(parseHushWidthArgument(" AUTO "), "auto");
for (const invalid of [
  "",
  "0",
  "-1",
  "+2",
  "2.5",
  "01",
  "1e2",
  `${Number.MAX_SAFE_INTEGER + 1}`,
  "0%",
  "100.01%",
  "NaN%",
  "Infinity%",
  "1e2%",
  "12%junk",
  `${"9".repeat(100)}%`,
]) {
  assert.equal(parseHushWidthArgument(invalid), undefined, invalid);
}

// Settings are indexed by stable animation id and retain unrelated data.
const parsedSettings: HushAnimationSettings = {
  version: 1,
  owner: "keep",
  animations: {
    wave: { width: 28, note: "keep" },
    "fish-loop": { width: { ratio: 0.6 } },
    "future-animation": { width: 7, custom: { keep: true } },
  },
};
assert.equal(getHushAnimationWidthOverride(parsedSettings, "wave"), 28);
assert.deepEqual(
  getHushAnimationWidthOverride(parsedSettings, "fish-loop"),
  { ratio: 0.6 },
);
assert.equal(
  getHushAnimationWidthOverride(parsedSettings, "missing"),
  undefined,
);
const updatedSettings = updateHushAnimationWidthOverride(
  parsedSettings,
  "wave",
  { ratio: 0.75 },
);
assert.deepEqual(updatedSettings.animations.wave, {
  width: { ratio: 0.75 },
  note: "keep",
});
assert.deepEqual(updatedSettings.animations["future-animation"], {
  width: 7,
  custom: { keep: true },
});
assert.equal(updatedSettings.owner, "keep");
const resetSettings = updateHushAnimationWidthOverride(
  updatedSettings,
  "fish-loop",
  undefined,
);
assert.equal("width" in resetSettings.animations["fish-loop"]!, false);
assert.deepEqual(getHushAnimationWidthOverride(resetSettings, "wave"), {
  ratio: 0.75,
});
assert.deepEqual(createHushAnimationSettings(), {
  version: 1,
  animations: {},
});

assert.deepEqual(
  getHushArgumentCompletions("")?.map((item) => item.value),
  ["on", "thinking", "activity", "animation", "width", "off"],
);
assert.deepEqual(
  getHushArgumentCompletions("width ")?.map((item) => item.value),
  ["width auto", "width 25%", "width 50%", "width 75%", "width 100%"],
);
assert.deepEqual(
  getHushArgumentCompletions("width a")?.map((item) => item.value),
  ["width auto"],
);

// Exercise the public command seam against the unified TOML configuration.
const root = mkdtempSync(join(tmpdir(), "pi-hush-animation-settings-"));
const paths = {
  agent: join(root, "agent"),
  config: join(root, "override-config.toml"),
  preference: join(root, "legacy-preference"),
  animation: join(root, "legacy-selected-animation"),
  activity: join(root, "legacy-activity-text"),
  activityPosition: join(root, "legacy-activity-position"),
  settings: join(root, "legacy-animation-settings.json"),
  prefixes: join(root, "legacy-hidden-input-prefixes.json"),
};
mkdirSync(paths.agent, { recursive: true });

const environment = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PI_HUSH_CONFIG_PATH: process.env.PI_HUSH_CONFIG_PATH,
  PI_HUSH_PREFERENCE_PATH: process.env.PI_HUSH_PREFERENCE_PATH,
  PI_HUSH_ANIMATION_PATH: process.env.PI_HUSH_ANIMATION_PATH,
  PI_HUSH_ACTIVITY_PATH: process.env.PI_HUSH_ACTIVITY_PATH,
  PI_HUSH_ACTIVITY_POSITION_PATH: process.env.PI_HUSH_ACTIVITY_POSITION_PATH,
  PI_HUSH_ANIMATION_SETTINGS_PATH:
    process.env.PI_HUSH_ANIMATION_SETTINGS_PATH,
  PI_HUSH_HIDDEN_INPUT_PREFIXES_PATH:
    process.env.PI_HUSH_HIDDEN_INPUT_PREFIXES_PATH,
};
process.env.PI_CODING_AGENT_DIR = paths.agent;
process.env.PI_HUSH_CONFIG_PATH = paths.config;
process.env.PI_HUSH_PREFERENCE_PATH = paths.preference;
process.env.PI_HUSH_ANIMATION_PATH = paths.animation;
process.env.PI_HUSH_ACTIVITY_PATH = paths.activity;
process.env.PI_HUSH_ACTIVITY_POSITION_PATH = paths.activityPosition;
process.env.PI_HUSH_ANIMATION_SETTINGS_PATH = paths.settings;
process.env.PI_HUSH_HIDDEN_INPUT_PREFIXES_PATH = paths.prefixes;

const obsoleteEnvironmentNames = [
  "PI_HUSH_PREFERENCE_PATH",
  "PI_HUSH_ANIMATION_PATH",
  "PI_HUSH_ACTIVITY_PATH",
  "PI_HUSH_ACTIVITY_POSITION_PATH",
  "PI_HUSH_ANIMATION_SETTINGS_PATH",
  "PI_HUSH_HIDDEN_INPUT_PREFIXES_PATH",
] as const;

function readConfig(): Record<string, unknown> {
  return parseToml(readFileSync(paths.config, "utf8"));
}

function configuredWidth(config: Record<string, unknown>, animationId: string): unknown {
  const animations = config.animations as Record<string, Record<string, unknown>> | undefined;
  return animations?.[animationId]?.width;
}

const harnesses: Array<{ close(): Promise<void> }> = [];

function createHarness(mode: "rpc" | "tui" = "rpc") {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const notifications: Array<{ message: string; level: string }> = [];
  const presentations: HushPresentationState[] = [];
  let widget: (Component & { dispose?(): void }) | undefined;
  let command:
    | {
        handler(
          args: string,
          ctx: ExtensionCommandContext,
        ): Promise<void> | void;
      }
    | undefined;
  let toolsExpanded = false;
  const ui = {
    notify(message: string, level: string) {
      notifications.push({ message, level });
    },
    setWorkingVisible() {},
    setHiddenThinkingLabel() {},
    setStatus() {},
    getToolsExpanded: () => toolsExpanded,
    setToolsExpanded(expanded: boolean) {
      toolsExpanded = expanded;
    },
    onTerminalInput: () => () => {},
    setWidget(
      _key: string,
      content:
        | undefined
        | ((tui: TUI, theme: Theme) => Component & { dispose?(): void }),
    ) {
      widget?.dispose?.();
      widget = typeof content === "function"
        ? content(
          {
            terminal: { rows: 24 },
            requestRender() {},
          } as unknown as TUI,
          { fg: (_color: string, text: string) => text } as unknown as Theme,
        )
        : undefined;
    },
  } as unknown as ExtensionUIContext;
  const context = {
    cwd: root,
    hasUI: true,
    mode,
    ui,
    isIdle: () => mode === "rpc",
    isProjectTrusted: () => false,
  } as unknown as ExtensionCommandContext;
  const api = {
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
    registerCommand(
      name: string,
      candidate: {
        handler(
          args: string,
          ctx: ExtensionCommandContext,
        ): Promise<void> | void;
      },
    ) {
      if (name === "hush") command = candidate;
    },
    events: {
      emit(event: string, value: unknown) {
        if (event === HUSH_PRESENTATION_EVENT) {
          presentations.push(value as HushPresentationState);
        }
      },
    },
  } as unknown as ExtensionAPI;
  installHush(api);

  const harness = {
    notifications,
    presentations,
    async close() {
      const shutdown = handlers.get("session_shutdown") as
        ((event: unknown, ctx: ExtensionCommandContext) => unknown) | undefined;
      await shutdown?.({}, context);
    },
    async start() {
      const start = handlers.get("session_start") as (
        event: unknown,
        ctx: ExtensionCommandContext,
      ) => Promise<void>;
      await start({}, context);
    },
    async run(argument: string) {
      assert.ok(command);
      await command.handler(argument, context);
    },
    async emit(eventName: string, event: unknown = {}) {
      const handler = handlers.get(eventName) as
        ((event: unknown, ctx: ExtensionCommandContext) => unknown) | undefined;
      assert.ok(handler, `Missing lifecycle handler: ${eventName}`);
      await handler(event, context);
    },
    renderedWidth(viewportWidth: number) {
      assert.ok(widget);
      return visibleWidth(widget.render(viewportWidth)[0] ?? "");
    },
    renderedLines(viewportWidth: number) {
      assert.ok(widget);
      return widget.render(viewportWidth);
    },
  };
  harnesses.push(harness);
  return harness;
}

const richConfig = `# preserve this top-level comment
version = 1
enabled = true
thinking = false
animation = "wave"
owner = "keep"

[activity]
enabled = false
position = "right"

[future]
value = "keep"

[animations.wave]
width = 28 # preserve this width comment
note = "keep wave metadata"

[animations.fish-loop]
width = "60%"
note = "keep fish metadata"

[animations.unknown-animation]
width = 9
custom = "keep"
`;

try {
  // Obsolete files and their path overrides are ignored even when TOML is
  // missing. Defaults remain in memory and only a real change creates TOML.
  const obsoleteContents = {
    preference: "off\n",
    animation: "bars\n",
    activity: "off\n",
    activityPosition: "right\n",
    settings: '{"version":1,"animations":{"wave":{"width":99}}}\n',
    prefixes: '["LEGACY: "]\n',
  };
  for (const [name, content] of Object.entries(obsoleteContents)) {
    writeFileSync(paths[name as keyof typeof obsoleteContents], content);
  }
  const first = createHarness("tui");
  await first.start();
  assert.equal(first.presentations.at(-1)?.active, true);
  assert.equal(first.presentations.at(-1)?.workingAnimationId, "flock");
  assert.equal(first.presentations.at(-1)?.activityTextEnabled, true);
  assert.equal(first.presentations.at(-1)?.activityTextPosition, "left");
  const defaultLines = first.renderedLines(100);
  assert.ok(defaultLines[Math.floor(defaultLines.length / 2)]?.startsWith(" Working…"));
  assert.equal(first.renderedWidth(100), 100);
  assert.equal(existsSync(paths.config), false);
  await first.run("width auto");
  await first.run("activity left");
  await first.run("animation flock");
  assert.equal(existsSync(paths.config), false);
  await first.run("width 28");
  assert.equal(configuredWidth(readConfig(), "flock"), 28);
  assert.equal(readConfig().animation, "flock");
  assert.deepEqual({ ...(readConfig().activity as Record<string, unknown>) },
    { enabled: true, position: "left" });
  await first.close();
  for (const [name, content] of Object.entries(obsoleteContents)) {
    assert.equal(
      readFileSync(paths[name as keyof typeof obsoleteContents], "utf8"),
      content,
    );
  }
  for (const name of obsoleteEnvironmentNames) delete process.env[name];

  // A TOML file is the only source of truth and command edits retain comments,
  // unknown fields, and every animation not targeted by the command.
  writeFileSync(paths.config, richConfig);

  const rendering = createHarness("tui");
  await rendering.start();
  assert.equal(rendering.presentations.at(-1)?.active, true);
  assert.equal(rendering.presentations.at(-1)?.workingAnimationId, "wave");
  assert.equal(rendering.presentations.at(-1)?.activityTextEnabled, false);
  assert.equal(rendering.presentations.at(-1)?.activityTextPosition, "right");
  assert.equal(rendering.renderedWidth(100), 29); // inset + 28 drawing columns

  // Query commands also reload the latest TOML into the live widget.
  const externallyChanged = readFileSync(paths.config, "utf8").replace(
    "width = 28 # preserve this width comment",
    "width = 26 # preserve this width comment",
  );
  writeFileSync(paths.config, externallyChanged);
  await rendering.run("width");
  assert.equal(rendering.renderedWidth(100), 27);
  assert.match(rendering.notifications.at(-1)?.message ?? "", /wave.*26 columns/i);

  await rendering.run("width 30");
  let stored = readConfig();
  assert.equal(configuredWidth(stored, "wave"), 30);
  assert.equal(configuredWidth(stored, "fish-loop"), "60%");
  assert.equal(configuredWidth(stored, "unknown-animation"), 9);
  assert.equal(stored.owner, "keep");
  assert.equal((stored.future as Record<string, unknown>).value, "keep");
  let rawStored = readFileSync(paths.config, "utf8");
  assert.match(rawStored, /preserve this top-level comment/);
  assert.match(rawStored, /preserve this width comment/);
  assert.match(rawStored, /keep fish metadata/);

  // Selection and width mutations read the newest file and touch only their field.
  const withExternalMetadata = rawStored.replace(
    'value = "keep"',
    'value = "changed externally"\nextra = 7',
  );
  writeFileSync(paths.config, withExternalMetadata);
  await rendering.run("animation fish-loop");
  stored = readConfig();
  assert.equal(stored.animation, "fish-loop");
  assert.equal(
    (stored.future as Record<string, unknown>).value,
    "changed externally",
  );
  assert.equal((stored.future as Record<string, unknown>).extra, 7);
  assert.equal(configuredWidth(stored, "wave"), 30);
  assert.equal(rendering.renderedWidth(100), 60); // floor(99 * 60%) + inset
  await rendering.run("width");
  assert.match(rendering.notifications.at(-1)?.message ?? "", /fish-loop.*60%/i);

  await rendering.run("width auto");
  stored = readConfig();
  const fishAuto = configuredWidth(stored, "fish-loop");
  assert.ok(fishAuto === undefined || fishAuto === "auto");
  assert.equal(configuredWidth(stored, "wave"), 30);
  assert.equal(configuredWidth(stored, "unknown-animation"), 9);
  assert.match(readFileSync(paths.config, "utf8"), /keep fish metadata/);
  const afterAuto = readFileSync(paths.config, "utf8");
  await rendering.run("width auto");
  assert.equal(
    readFileSync(paths.config, "utf8"),
    afterAuto,
    "an already-auto width must not rewrite TOML",
  );

  const beforeInvalid = readFileSync(paths.config, "utf8");
  await rendering.run("width 1e2");
  assert.equal(readFileSync(paths.config, "utf8"), beforeInvalid);
  assert.match(rendering.notifications.at(-1)?.message ?? "", /invalid.*width/i);

  // Real extension callbacks distinguish activity without changing the config
  // schema. Only transitions publish/render new labels, not every token event.
  const beforeActivity = readFileSync(paths.config, "utf8");
  const events = createHarness("tui");
  try {
    await events.start();
    await events.run("activity");
    const expectActivity = (label: string) => {
      assert.equal(events.presentations.at(-1)?.activityText, label);
      assert.ok(events.renderedLines(100).some((line) => line.includes(label)));
    };
    const update = (type: string) => events.emit("message_update", {
      assistantMessageEvent: { type },
    });
    const assistant = { role: "assistant" };
    expectActivity("Working…");
    await events.emit("message_start", { message: assistant });
    await update("thinking_start");
    expectActivity("Thinking…");
    const beforeRepeatedDelta = events.presentations.length;
    await update("thinking_delta");
    await update("thinking_delta");
    assert.equal(events.presentations.length, beforeRepeatedDelta);
    await events.emit("message_end", { message: { role: "toolResult" } });
    expectActivity("Thinking…");
    await update("thinking_end");
    expectActivity("Working…");
    await update("text_start");
    expectActivity("Responding…");
    await update("text_end");
    expectActivity("Working…");
    await update("toolcall_start");
    expectActivity("Working…");
    await events.emit("tool_execution_start", { toolCallId: "a", toolName: "read" });
    await events.emit("tool_execution_start", { toolCallId: "b", toolName: "bash" });
    expectActivity("Running read +1…");
    await events.emit("message_end", { message: assistant });
    expectActivity("Running read +1…");
    await events.emit("tool_execution_end", { toolCallId: "a" });
    expectActivity("Running bash…");
    await events.emit("tool_execution_end", { toolCallId: "b" });
    expectActivity("Working…");
    await update("thinking_delta");
    await events.emit("message_end", { message: { ...assistant, stopReason: "error" } });
    expectActivity("Working…");
    await update("text_delta");
    expectActivity("Responding…");
    await events.emit("message_start", { message: assistant });
    expectActivity("Working…");
    await update("thinking_start");
    await events.emit("agent_end");
    expectActivity("Working…");
    await events.emit("agent_settled");
    assert.equal(events.presentations.at(-1)?.activityText, undefined);
    await update("thinking_delta");
    assert.equal(events.presentations.at(-1)?.activityText, undefined);
    await events.emit("agent_start");
    expectActivity("Working…");
  } finally {
    await events.close();
    writeFileSync(paths.config, beforeActivity);
  }

  // Startup degrades to defaults for malformed/newer TOML without rewriting it;
  // strict command updates reject the same source and leave live state unchanged.
  for (const badContent of [
    "enabled = true\n[animations.wave\nwidth = 20\n",
    "version = 99\nenabled = false\n",
  ]) {
    writeFileSync(paths.config, badContent);
    const badReload = createHarness();
    await badReload.start();
    assert.equal(readFileSync(paths.config, "utf8"), badContent);
    assert.equal(badReload.presentations.at(-1)?.active, true);
    assert.equal(badReload.presentations.at(-1)?.workingAnimationId, "flock");
    assert.equal(badReload.presentations.at(-1)?.activityTextEnabled, true);
    assert.equal(badReload.presentations.at(-1)?.activityTextPosition, "left");
    assert.equal(badReload.notifications.at(-1)?.level, "warning");
    assert.match(badReload.notifications.at(-1)?.message ?? "", /config|toml|version/i);

    const liveBeforeFailure = rendering.presentations.at(-1);
    await rendering.run("width 20");
    assert.equal(readFileSync(paths.config, "utf8"), badContent);
    assert.deepEqual(rendering.presentations.at(-1), liveBeforeFailure);
    assert.equal(rendering.notifications.at(-1)?.level, "warning");
    assert.match(rendering.notifications.at(-1)?.message ?? "", /could not|invalid|newer|version/i);
  }

  // Unreadable config writes cannot partially apply activity placement or an
  // animation selection to the running UI.
  rmSync(paths.config, { force: true });
  mkdirSync(paths.config);
  const beforeFailedCommands = rendering.presentations.at(-1);
  await rendering.run("activity left");
  assert.equal(statSync(paths.config).isDirectory(), true);
  assert.deepEqual(rendering.presentations.at(-1), beforeFailedCommands);
  assert.equal(rendering.notifications.at(-1)?.level, "warning");
  await rendering.run("animation bars");
  assert.deepEqual(rendering.presentations.at(-1), beforeFailedCommands);
  assert.equal(rendering.notifications.at(-1)?.level, "warning");
  await rendering.run("width 20");
  assert.deepEqual(rendering.presentations.at(-1), beforeFailedCommands);
  assert.equal(rendering.notifications.at(-1)?.level, "warning");
} finally {
  for (const harness of harnesses.reverse()) await harness.close();
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(root, { recursive: true, force: true });
}

console.log("pi-hush animation settings check: ok");
