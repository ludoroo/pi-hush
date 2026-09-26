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
  createHushAnimationSettings,
  getHushAnimationWidthOverride,
  parseHushAnimationSettings,
  parseHushWidthArgument,
  serializeHushAnimationSettings,
  updateHushAnimationWidthOverride,
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

// Settings are indexed by stable animation id and retain unrelated JSON data.
const parsedSettings = parseHushAnimationSettings(
  JSON.stringify({
    version: 1,
    owner: "keep",
    animations: {
      wave: { width: 28, note: "keep" },
      "fish-loop": { width: { ratio: 0.6 } },
      "future-animation": { width: 7, custom: { keep: true } },
    },
  }),
);
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
assert.deepEqual(
  parseHushAnimationSettings(serializeHushAnimationSettings(resetSettings)),
  resetSettings,
);
assert.deepEqual(createHushAnimationSettings(), {
  version: 1,
  animations: {},
});
for (const malformed of [
  "not json",
  "null",
  "{}",
  '{"version":1,"animations":[]}',
  '{"version":1,"animations":{"wave":{"width":0}}}',
  '{"version":1,"animations":{"wave":{"width":{"ratio":2}}}}',
]) {
  assert.throws(() => parseHushAnimationSettings(malformed));
}
assert.throws(
  () => parseHushAnimationSettings('{"version":2,"animations":{}}'),
  /newer|version/i,
);

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

// Exercise the public command seam, including reloads and recoverable bad files.
const root = mkdtempSync(join(tmpdir(), "pi-hush-animation-settings-"));
const paths = {
  agent: join(root, "agent"),
  preference: join(root, "preference"),
  animation: join(root, "selected-animation"),
  activity: join(root, "activity-text"),
  activityPosition: join(root, "activity-position"),
  settings: join(root, "animation-settings.json"),
};
mkdirSync(paths.agent, { recursive: true });
writeFileSync(paths.preference, "off\n");
writeFileSync(paths.animation, "wave\n");
writeFileSync(paths.activity, "off\n");
writeFileSync(paths.activityPosition, "right\n");

const environment = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  PI_HUSH_PREFERENCE_PATH: process.env.PI_HUSH_PREFERENCE_PATH,
  PI_HUSH_ANIMATION_PATH: process.env.PI_HUSH_ANIMATION_PATH,
  PI_HUSH_ACTIVITY_PATH: process.env.PI_HUSH_ACTIVITY_PATH,
  PI_HUSH_ACTIVITY_POSITION_PATH: process.env.PI_HUSH_ACTIVITY_POSITION_PATH,
  PI_HUSH_ANIMATION_SETTINGS_PATH:
    process.env.PI_HUSH_ANIMATION_SETTINGS_PATH,
};
process.env.PI_CODING_AGENT_DIR = paths.agent;
process.env.PI_HUSH_PREFERENCE_PATH = paths.preference;
process.env.PI_HUSH_ANIMATION_PATH = paths.animation;
process.env.PI_HUSH_ACTIVITY_PATH = paths.activity;
process.env.PI_HUSH_ACTIVITY_POSITION_PATH = paths.activityPosition;
process.env.PI_HUSH_ANIMATION_SETTINGS_PATH = paths.settings;

const harnesses: Array<{ close(): Promise<void> }> = [];

function createHarness(mode: "rpc" | "tui" = "rpc") {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const notifications: Array<{ message: string; level: string }> = [];
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
    events: { emit() {} },
  } as unknown as ExtensionAPI;
  installHush(api);

  const harness = {
    notifications,
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

try {
  const first = createHarness();
  await first.start();
  assert.equal(existsSync(paths.settings), false);
  await first.run("width auto");
  assert.equal(existsSync(paths.settings), false); // no override, nothing to persist
  await first.run("width 28");
  assert.equal(readFileSync(paths.preference, "utf8"), "off\n");
  assert.equal(readFileSync(paths.activity, "utf8"), "off\n");
  assert.equal(
    getHushAnimationWidthOverride(
      parseHushAnimationSettings(readFileSync(paths.settings, "utf8")),
      "wave",
    ),
    28,
  );

  // A new factory/session restores the selected animation's override.
  const reloaded = createHarness();
  await reloaded.start();
  await reloaded.run("width");
  assert.match(reloaded.notifications.at(-1)?.message ?? "", /wave.*28 columns/i);

  // Each command reloads before writing, preserving another session's changes.
  const external = parseHushAnimationSettings(readFileSync(paths.settings, "utf8"));
  const withExternalChanges = updateHushAnimationWidthOverride(
    external,
    "fish-loop",
    { ratio: 0.6 },
  );
  withExternalChanges.owner = "keep";
  withExternalChanges.animations["unknown-animation"] = {
    width: 9,
    custom: "keep",
  };
  writeFileSync(paths.settings, serializeHushAnimationSettings(withExternalChanges));

  // The factory passes the override for whichever animation is selected.
  const rendering = createHarness("tui");
  await rendering.start();
  await rendering.run("animation wave");
  assert.equal(rendering.renderedWidth(100), 29); // inset + 28 drawing columns
  const beforeExternalWidth = readFileSync(paths.settings, "utf8");
  writeFileSync(paths.settings, serializeHushAnimationSettings(
    updateHushAnimationWidthOverride(parseHushAnimationSettings(beforeExternalWidth), "wave", 26),
  ));
  await rendering.run("width");
  assert.equal(rendering.renderedWidth(100), 27); // reported settings also reach the live widget
  writeFileSync(paths.settings, beforeExternalWidth);
  await rendering.run("width");
  assert.equal(rendering.renderedWidth(100), 29);
  await rendering.run("animation flock");
  await rendering.run("width");
  assert.match(rendering.notifications.at(-1)?.message ?? "", /auto.*100%.*remaining animation space/i);
  await rendering.run("animation fish-loop");
  assert.equal(rendering.renderedWidth(100), 60); // inset + floor(99 * 60%)

  await first.run("width 30");
  let stored = parseHushAnimationSettings(readFileSync(paths.settings, "utf8"));
  assert.equal(getHushAnimationWidthOverride(stored, "wave"), 30);
  assert.deepEqual(getHushAnimationWidthOverride(stored, "fish-loop"), {
    ratio: 0.6,
  });
  assert.deepEqual(stored.animations["unknown-animation"], {
    width: 9,
    custom: "keep",
  });
  assert.equal(stored.owner, "keep");

  // Switching animations reports and changes the setting for that selection only.
  await first.run("animation fish-loop");
  await first.run("width");
  assert.match(
    first.notifications.at(-1)?.message ?? "",
    /fish-loop.*60%/i,
  );
  await first.run("width auto");
  stored = parseHushAnimationSettings(readFileSync(paths.settings, "utf8"));
  assert.equal(getHushAnimationWidthOverride(stored, "fish-loop"), undefined);
  assert.equal(getHushAnimationWidthOverride(stored, "wave"), 30);
  assert.ok(stored.animations["unknown-animation"]);

  const beforeInvalid = readFileSync(paths.settings, "utf8");
  await first.run("width 1e2");
  assert.equal(readFileSync(paths.settings, "utf8"), beforeInvalid);
  assert.match(first.notifications.at(-1)?.message ?? "", /invalid.*width/i);

  for (const badContent of [
    "{ definitely corrupt",
    '{"version":99,"animations":{}}',
  ]) {
    writeFileSync(paths.settings, badContent);
    const badReload = createHarness();
    await badReload.start();
    assert.match(badReload.notifications.at(-1)?.message ?? "", /using animation defaults/i);
    assert.equal(readFileSync(paths.settings, "utf8"), badContent);
    await first.run("width 20");
    assert.equal(readFileSync(paths.settings, "utf8"), badContent);
    assert.equal(first.notifications.at(-1)?.level, "warning");
    assert.match(
      first.notifications.at(-1)?.message ?? "",
      /could not update.*width/i,
    );
  }

  // A failed position write must not change the running preference or the file.
  await rendering.run("activity left");
  assert.equal(readFileSync(paths.activityPosition, "utf8"), "left\n");
  await rendering.run("activity"); // Bare command still toggles text independently.
  assert.ok(rendering.renderedLines(100).some((line) => line.startsWith(" Thinking…")));
  rmSync(paths.activityPosition);
  mkdirSync(paths.activityPosition);
  await rendering.run("activity  right");
  assert.equal(statSync(paths.activityPosition).isDirectory(), true);
  assert.match(rendering.notifications.at(-1)?.message ?? "", /could not save.*position/i);
  assert.ok(rendering.renderedLines(100).some((line) => line.startsWith(" Thinking…")));

  rmSync(paths.settings);
  mkdirSync(paths.settings);
  await first.run("width 20");
  assert.equal(statSync(paths.settings).isDirectory(), true);
  assert.equal(first.notifications.at(-1)?.level, "warning");
} finally {
  for (const harness of harnesses.reverse()) await harness.close();
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(root, { recursive: true, force: true });
}

console.log("pi-hush animation settings check: ok");
