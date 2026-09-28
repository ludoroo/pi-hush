import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  HushConfigStore,
  type HushConfigPatch,
} from "../extensions/hush/lib/config.ts";
import { DEFAULT_HUSH_ACTIVITY_POSITION } from "../extensions/hush/lib/activity.ts";
import { DEFAULT_HUSH_ANIMATION_ID } from "../extensions/hush/animations/index.ts";
import { DEFAULT_HUSH_PREFERENCE } from "../extensions/hush/lib/visibility.ts";

const root = mkdtempSync(join(tmpdir(), "pi-hush-config-"));
let caseNumber = 0;

function createStore() {
  const directory = join(root, String(caseNumber++));
  const paths = { config: join(directory, "config.toml") };
  return {
    directory,
    paths,
    store: new HushConfigStore({ path: paths.config }),
  };
}

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function defaults() {
  return {
    preference: { ...DEFAULT_HUSH_PREFERENCE },
    animationId: DEFAULT_HUSH_ANIMATION_ID,
    activityTextEnabled: true,
    activityTextPosition: DEFAULT_HUSH_ACTIVITY_POSITION,
    hiddenInputPrefixes: [],
    animationSettings: { version: 1, animations: {} },
  };
}

try {
  // Missing configuration is side-effect free and uses the public defaults.
  {
    const { directory, paths, store } = createStore();
    assert.deepEqual(store.load(), { config: defaults() });
    assert.deepEqual(store.read(), defaults());
    assert.equal(existsSync(directory), false);
    assert.equal(existsSync(paths.config), false);

    const noChange: HushConfigPatch = {
      animation: "flock",
      activity: { enabled: true, position: "left" },
      width: { animationId: DEFAULT_HUSH_ANIMATION_ID, value: undefined },
    };
    assert.deepEqual(store.update(noChange), defaults());
    assert.equal(existsSync(directory), false);
  }

  // All schema width variants normalize to the established runtime shape.
  {
    const { paths, store } = createStore();
    write(paths.config, `
version = 1
enabled = false
thinking = true
animation = "third_party-animation"

[activity]
enabled = true
position = "left"

[transcript]
hidden_input_prefixes = ["  exact: ", "\u2063robot:"]

[animations.fixed]
width = 28
[animations.percent]
width = "60%"
[animations.automatic]
width = "auto"
[animations.bounded.width]
ratio = 0.6
minColumns = 12
maxColumns = 48
`);
    assert.deepEqual(store.read(), {
      preference: { active: false, thinking: true },
      animationId: "third_party-animation",
      activityTextEnabled: true,
      activityTextPosition: "left",
      hiddenInputPrefixes: ["  exact: ", "⁣robot:"],
      animationSettings: {
        version: 1,
        animations: {
          fixed: { width: 28 },
          percent: { width: { ratio: 0.6 } },
          automatic: {},
          bounded: {
            width: { ratio: 0.6, minColumns: 12, maxColumns: 48 },
          },
        },
      },
    });
  }

  // Missing fields default independently; explicit choices still win.
  for (const [source, overrides] of [
    ["[unknown]\nanswer = 42\n", {}],
    ['animation = "wave"\n', { animationId: "wave" }],
    ["[activity]\nenabled = false\n", { activityTextEnabled: false }],
    ['[activity]\nposition = "right"\n', { activityTextPosition: "right" }],
  ] as const) {
    const { paths, store } = createStore();
    write(paths.config, source);
    assert.deepEqual(store.read(), { ...defaults(), ...overrides });
    assert.equal(readFileSync(paths.config, "utf8"), source);
  }

  // Known fields are strict, including every prefix entry and animation id.
  for (const invalid of [
    "version = 2\n",
    'enabled = "yes"\n',
    "thinking = 1\n",
    'animation = "Not Valid"\n',
    "activity = true\n",
    "activity = 2026-09-28\n",
    "transcript = 2026-09-28\n",
    "animations = 2026-09-28\n",
    "[animations]\nwave = 2026-09-28\n",
    "[activity]\nenabled = 1\n",
    '[activity]\nposition = "middle"\n',
    '[transcript]\nhidden_input_prefixes = ["ok", " "]\n',
    "[transcript]\nhidden_input_prefixes = [1]\n",
    "[transcript]\nhidden_input_prefixes = [2026-09-28]\n",
    '[animations.wave]\nwidth = "101%"\n',
    "[animations.wave]\nwidth = 0\n",
    "[animations.wave.width]\nratio = 0\n",
    "[animations.wave.width]\nratio = 0.5\nminColumns = 20\nmaxColumns = 10\n",
    '[animations."bad id"]\nwidth = 2\n',
  ]) {
    const { paths, store } = createStore();
    write(paths.config, invalid);
    const before = readFileSync(paths.config, "utf8");
    assert.throws(() => store.read(), invalid);
    const loaded = store.load();
    assert.deepEqual(loaded.config, defaults(), invalid);
    assert.match(loaded.warning ?? "", /config|toml|version|hush/i, invalid);
    assert.equal(readFileSync(paths.config, "utf8"), before, invalid);
    assert.throws(() => store.update({ enabled: false }), invalid);
    assert.equal(readFileSync(paths.config, "utf8"), before, invalid);
  }

  // Updates reload disk, merge only requested values, and preserve source text.
  {
    const { paths, store } = createStore();
    const source = `# personal heading\nversion=1 # compact on purpose\nenabled = true\nthinking = false\nanimation = "wave"\ncustom = 9223372036854775807 # huge unknown integer\n\n[activity] # keep me\nenabled=false\nposition="right"\n\n[transcript]\nhidden_input_prefixes=["exact: "]\n\n[animations.wave]\nwidth = 28 # drawing size\nnote = "untouched"\n\n[plugin]\nvalue = { nested = true }\n`;
    write(paths.config, source);
    store.update({ activity: { position: "left" } });
    const edited = readFileSync(paths.config, "utf8");
    assert.match(edited, /# personal heading/);
    assert.match(edited, /version=1 # compact on purpose/);
    assert.match(edited, /custom = 9223372036854775807 # huge unknown integer/);
    assert.match(edited, /width = 28 # drawing size/);
    assert.match(edited, /note = "untouched"/);
    assert.match(edited, /value = \{ nested = true \}/);
    assert.match(edited, /position\s*=\s*"left"/);
    assert.equal(statSync(paths.config).mode & 0o777, 0o600);

    // A second session's edit is observed before this instance writes.
    const external = edited.replace("enabled = true", "enabled = false");
    writeFileSync(paths.config, external);
    const result = store.update({ thinking: true });
    assert.deepEqual(result.preference, { active: false, thinking: true });
    assert.match(readFileSync(paths.config, "utf8"), /enabled = false/);

    store.update({ width: { animationId: "wave", value: { ratio: 0.75 } } });
    assert.deepEqual(store.read().animationSettings.animations.wave?.width, {
      ratio: 0.75,
    });
    store.update({ width: { animationId: "wave", value: undefined } });
    assert.equal(
      store.read().animationSettings.animations.wave?.width,
      undefined,
    );
    assert.match(readFileSync(paths.config, "utf8"), /width\s*=\s*"auto"/);
  }

  // Percent widths created from defaults remain editable, including reset.
  {
    const { store } = createStore();
    store.update({ width: { animationId: "wave", value: { ratio: 0.6 } } });
    assert.deepEqual(store.read().animationSettings.animations.wave?.width, { ratio: 0.6 });
    store.update({ width: { animationId: "wave", value: 28 } });
    assert.equal(store.read().animationSettings.animations.wave?.width, 28);
    store.update({ width: { animationId: "wave", value: undefined } });
    assert.equal(store.read().animationSettings.animations.wave?.width, undefined);
  }

  // A semantic no-op does not rewrite an existing file.
  {
    const { paths, store } = createStore();
    const source = "# retain bytes\nenabled = true\n";
    write(paths.config, source);
    store.update({ enabled: true });
    store.update({ width: { animationId: "wave", value: undefined } });
    assert.equal(readFileSync(paths.config, "utf8"), source);
  }

  // Table-form widths remain editable without disturbing unknown settings.
  {
    const { paths, store } = createStore();
    write(paths.config, `
[animations.unknown-animation]
note = "preserve-field"
[animations.unknown-animation.width]
ratio = 0.6
minColumns = 8
maxColumns = 50
[animations.unknown-animation.future]
value = true
`);
    assert.deepEqual(store.read().animationSettings.animations["unknown-animation"]?.width,
      { ratio: 0.6, minColumns: 8, maxColumns: 50 });
    store.update({ width: { animationId: "unknown-animation", value: 30 } });
    assert.equal(store.read().animationSettings.animations["unknown-animation"]?.width, 30);
    store.update({ width: { animationId: "unknown-animation", value: undefined } });
    assert.equal(store.read().animationSettings.animations["unknown-animation"]?.width, undefined);
    const document = parse(readFileSync(paths.config, "utf8"));
    const saved = (document.animations as Record<string, Record<string, unknown>>)["unknown-animation"]!;
    assert.equal(saved.note, "preserve-field");
    assert.equal((saved.future as Record<string, unknown>).value, true);
  }

  // Startup is best effort for malformed and unreadable paths; strict APIs throw.
  {
    const { paths, store } = createStore();
    mkdirSync(paths.config, { recursive: true });
    assert.deepEqual(store.load().config, defaults());
    assert.ok(store.load().warning);
    assert.throws(() => store.read());
    assert.throws(() => store.update({ enabled: false }));
    assert.equal(statSync(paths.config).isDirectory(), true);
  }

  // Dotfile symlinks remain intact; a broken link must never be replaced.
  if (process.platform !== "win32") {
    const { paths, store } = createStore();
    const target = join(root, "managed-config.toml");
    write(target, '# dotfile manager\nenabled = true\n');
    mkdirSync(join(paths.config, ".."), { recursive: true });
    symlinkSync(target, paths.config);
    store.update({ enabled: false });
    assert.equal(lstatSync(paths.config).isSymbolicLink(), true);
    assert.match(readFileSync(target, "utf8"), /enabled = false/);
    assert.match(readFileSync(target, "utf8"), /# dotfile manager/);

    rmSync(target);
    assert.ok(store.load().warning);
    assert.throws(() => store.update({ enabled: false }));
    assert.equal(lstatSync(paths.config).isSymbolicLink(), true);
    assert.equal(existsSync(target), false);
  }

  // A failed write leaves the existing TOML intact.
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    const { paths, store } = createStore();
    const original = "enabled = true\n";
    write(paths.config, original);
    chmodSync(join(paths.config, ".."), 0o500);
    try {
      assert.throws(() => store.update({ enabled: false }));
      assert.equal(readFileSync(paths.config, "utf8"), original);
    } finally {
      chmodSync(join(paths.config, ".."), 0o700);
    }
  }
} finally {
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
}

console.log("pi-hush config check: ok");
