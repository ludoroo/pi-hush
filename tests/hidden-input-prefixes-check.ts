import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import installHush from "../extensions/hush/index.ts";
import { INVISIBLE_SEPARATOR } from "../extensions/hush/lib/operational-input.ts";
import {
  applyHushPreference,
  setHushStockExportRendering,
} from "../extensions/hush/lib/visibility.ts";

type Message = { role: string; content: unknown; [key: string]: unknown };
type DelegateCall = { message: Message; options: unknown };
type TestPresentation = {
  chatContainer: {
    children: unknown[];
    addChild(component: unknown): void;
  };
  editor: { history: string[]; addToHistory(text: string): void };
  delegateCalls: DelegateCall[];
  getMarkdownThemeWithSettings(): ReturnType<typeof PiCodingAgent.getMarkdownTheme>;
  getUserMessageText(message: Message): string;
  outputPad: number;
};

type Handler = (event: unknown, ctx: ExtensionCommandContext) => unknown;

const scenario = process.env.PI_HUSH_PREFIX_TEST_SCENARIO;

function createApi() {
  const handlers = new Map<string, Handler>();
  const api = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerCommand() {},
    events: { emit() {} },
  } as unknown as ExtensionAPI;
  return { api, handlers };
}

function createContext(hasUI: boolean) {
  const notifications: Array<{ message: string; level: string }> = [];
  let toolsExpanded = false;
  const ui = {
    notify(message: string, level: string) {
      notifications.push({ message, level });
    },
    setWorkingVisible() {},
    setHiddenThinkingLabel() {},
    setStatus() {},
    setWidget() {},
    getToolsExpanded: () => toolsExpanded,
    setToolsExpanded(value: boolean) {
      toolsExpanded = value;
    },
    onTerminalInput: () => () => {},
    getEditorText: () => "",
  } as unknown as ExtensionUIContext;
  const context = {
    cwd: process.cwd(),
    hasUI,
    mode: "rpc",
    ui,
    isIdle: () => true,
    isProjectTrusted: () => false,
  } as unknown as ExtensionCommandContext;
  return { context, notifications };
}

function createPresentation(): TestPresentation {
  const children: unknown[] = [];
  return {
    chatContainer: {
      children,
      addChild(component: unknown) {
        children.push(component);
      },
    },
    editor: {
      history: [],
      addToHistory(text: string) {
        this.history.push(text);
      },
    },
    delegateCalls: [],
    getMarkdownThemeWithSettings: PiCodingAgent.getMarkdownTheme,
    getUserMessageText(message: Message) {
      if (message.role !== "user") return "";
      if (typeof message.content === "string") return message.content;
      if (!Array.isArray(message.content)) return "";
      return message.content
        .filter(
          (block): block is { type: "text"; text: string } =>
            typeof block === "object" &&
            block !== null &&
            (block as { type?: unknown }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string",
        )
        .map((block) => block.text)
        .join("");
    },
    outputPad: 1,
  };
}

function addMessage(message: Message, options?: { populateHistory?: boolean }) {
  const presentation = createPresentation();
  const interactivePrototype = PiCodingAgent.InteractiveMode
    .prototype as unknown as {
    addMessageToChat(
      this: TestPresentation,
      message: Message,
      options?: { populateHistory?: boolean },
    ): void;
  };
  const addMessageToChat = interactivePrototype.addMessageToChat;
  addMessageToChat.call(presentation, message, options);
  return presentation;
}

function assertHidden(message: Message, label: string) {
  const presentation = addMessage(message);
  assert.equal(presentation.delegateCalls.length, 0, `${label}: delegated`);
  assert.equal(presentation.chatContainer.children.length, 1, `${label}: no row`);
  const component = presentation.chatContainer.children[0] as {
    render(width: number): string[];
  };
  assert.equal(
    component instanceof PiCodingAgent.UserMessageComponent,
    true,
    `${label}: not a user row`,
  );
  assert.deepEqual(component.render(80), [], `${label}: visible`);
  return component;
}

function assertDelegated(message: Message, label: string) {
  const presentation = addMessage(message);
  assert.equal(presentation.delegateCalls.length, 1, `${label}: not delegated`);
  assert.equal(presentation.delegateCalls[0]?.message, message);
  assert.equal(presentation.chatContainer.children.length, 0);
}

async function startSession(
  handlers: Map<string, Handler>,
  hasUI: boolean,
) {
  const { context, notifications } = createContext(hasUI);
  const handler = handlers.get("session_start");
  assert.ok(handler, "session_start was not registered");
  await handler({}, context);
  return notifications;
}

function install() {
  const harness = createApi();
  installHush(harness.api);
  return harness;
}

async function runCoreScenario() {
  const root = mkdtempSync(join(tmpdir(), "pi-hush-hidden-prefixes-"));
  const agentDir = join(root, "agent");
  const defaultPath = join(agentDir, "hush", "config.toml");
  const overridePath = join(root, "override-config.toml");
  const environment = {
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    PI_HUSH_CONFIG_PATH: process.env.PI_HUSH_CONFIG_PATH,
  };
  const prototype = PiCodingAgent.InteractiveMode.prototype as unknown as {
    addMessageToChat(
      this: TestPresentation,
      message: Message,
      options?: unknown,
    ): void;
  };
  const originalAddMessageToChat = prototype.addMessageToChat;
  const patchSymbol = Symbol.for("pi-hush:operational-user-layout:pi-0.85.1");
  const originalSymbol = Symbol.for(
    "pi-hush:operational-user-layout:original-addMessageToChat:v1",
  );
  const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
  const oldPatch = registry[patchSymbol];
  const oldOriginal = registry[originalSymbol];

  const configWithPrefixes = (prefixes: readonly string[]) =>
    `version = 1\nenabled = true\n\n[transcript]\nhidden_input_prefixes = ${JSON.stringify(prefixes)}\n`;

  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_HUSH_CONFIG_PATH = defaultPath;
    mkdirSync(join(agentDir, "hush"), { recursive: true });

    PiCodingAgent.initTheme(undefined, false);
    applyHushPreference({ active: true, thinking: false });
    setHushStockExportRendering(false);
    delete registry[patchSymbol];
    delete registry[originalSymbol];
    prototype.addMessageToChat = function (message, options) {
      this.delegateCalls.push({ message, options });
    };

    const firstmatePrefix = `${INVISIBLE_SEPARATOR}FIRSTMATE_OP: v1 `;
    writeFileSync(
      defaultPath,
      configWithPrefixes(["OPS: ", "  indented: ", firstmatePrefix]),
    );
    assert.deepEqual(
      (parseToml(readFileSync(defaultPath, "utf8")).transcript as {
        hidden_input_prefixes: string[];
      }).hidden_input_prefixes,
      ["OPS: ", "  indented: ", firstmatePrefix],
    );
    const initial = install();

    // Factory-time loading matters: Pi rebuilds restored rows before session_start.
    assertHidden({ role: "user", content: "OPS: restored" }, "factory startup");
    assert.equal((await startSession(initial.handlers, true)).length, 0);

    // A later session_start reloads controls and the matcher from the latest TOML.
    writeFileSync(defaultPath, configWithPrefixes(["SESSION: "]));
    assert.equal((await startSession(initial.handlers, true)).length, 0);
    assertDelegated({ role: "user", content: "OPS: reloaded" }, "session reload stale prefix");
    assertHidden({ role: "user", content: "SESSION: current" }, "session reload current prefix");

    // Restore the richer set for literal-matching and message-shape coverage.
    writeFileSync(
      defaultPath,
      configWithPrefixes(["OPS: ", "  indented: ", firstmatePrefix]),
    );
    install();

    // Matching is an exact, literal startsWith over ordinary ASCII or Unicode.
    for (const text of ["OPS: ", "OPS: done", "  indented: done"]) {
      assertHidden({ role: "user", content: text }, text);
    }
    for (const text of [
      "ops: done",
      " OPS: done",
      "OPS:done",
      "indented: done",
      'quote: "OPS: done"',
      "ordinary text with OPS: embedded",
    ]) {
      assertDelegated({ role: "user", content: text }, text);
    }

    // Firstmate remains explicit configuration; there is no implicit special case.
    assertHidden(
      { role: "user", content: `${firstmatePrefix}watcher: done` },
      "configured known Firstmate kind",
    );
    assertHidden(
      { role: "user", content: `${firstmatePrefix}future-kind: done` },
      "configured future Firstmate kind",
    );

    // Only text-only user rows are presentation candidates.
    const textBlocks = {
      role: "user",
      content: [
        { type: "text", text: "OPS: " },
        { type: "text", text: "block message" },
      ],
    };
    const before = structuredClone(textBlocks);
    const textPresentation = addMessage(textBlocks, { populateHistory: true });
    assert.deepEqual(textBlocks, before);
    assert.equal(textPresentation.delegateCalls.length, 0);
    assert.deepEqual(textPresentation.editor.history, ["OPS: block message"]);
    const textComponent = textPresentation.chatContainer.children[0] as {
      render(width: number): string[];
    };
    assert.deepEqual(textComponent.render(80), []);

    for (const message of [
      {
        role: "user",
        content: [
          { type: "text", text: "OPS: with image" },
          { type: "image", data: "unchanged", mimeType: "image/png" },
        ],
      },
      {
        role: "user",
        content: [{ type: "image", data: "OPS: bytes", mimeType: "image/png" }],
      },
      { role: "assistant", content: "OPS: assistant" },
      { role: "custom", content: "OPS: custom", customType: "test" },
    ]) {
      const snapshot = structuredClone(message);
      assertDelegated(message, `${message.role} non-text-only`);
      assert.deepEqual(message, snapshot);
    }

    // Hush-off and export render the same unmodified row and history content.
    const raw = "OPS: preserve exactly  ";
    const message = { role: "user", content: raw };
    const component = assertHidden(message, "raw row");
    assert.equal(message.content, raw);
    const stockLines = new PiCodingAgent.UserMessageComponent(
      raw, PiCodingAgent.getMarkdownTheme(), 1,
    ).render(80);
    applyHushPreference({ active: false, thinking: false });
    assert.deepEqual(component.render(80), stockLines, "Hush off must restore stock rendering");
    applyHushPreference({ active: true, thinking: false });
    setHushStockExportRendering(true);
    assert.deepEqual(component.render(80), stockLines, "Export must restore stock rendering");
    setHushStockExportRendering(false);

    // Reinstall synchronously replaces changed configuration.
    writeFileSync(defaultPath, configWithPrefixes(["NEXT: "]));
    install();
    assertDelegated({ role: "user", content: "OPS: stale" }, "stale reload prefix");
    assert.deepEqual(component.render(80), stockLines, "Removed rules cannot keep an existing row hidden");
    assertHidden({ role: "user", content: "NEXT: current" }, "changed reload prefix");

    // No TOML means defaults stay in memory, with no file created.
    rmSync(defaultPath);
    const removed = install();
    assertDelegated({ role: "user", content: "NEXT: removed" }, "removed config");
    assertDelegated(
      { role: "user", content: `${firstmatePrefix}watcher: default pass-through` },
      "default Firstmate pass-through",
    );
    assertHidden(
      { role: "user", content: `${INVISIBLE_SEPARATOR}HUSH_HIDE: generic` },
      "generic Hush marker",
    );
    assert.equal((await startSession(removed.handlers, true)).length, 0);
    assert.equal(existsSync(defaultPath), false);

    // PI_HUSH_CONFIG_PATH wins over the default agent-directory path.
    writeFileSync(defaultPath, configWithPrefixes(["DEFAULT: "]));
    writeFileSync(overridePath, configWithPrefixes(["OVERRIDE: "]));
    process.env.PI_HUSH_CONFIG_PATH = overridePath;
    const overridden = install();
    assertDelegated({ role: "user", content: "DEFAULT: ignored" }, "override precedence");
    assertHidden({ role: "user", content: "OVERRIDE: active" }, "override prefix");
    assert.equal((await startSession(overridden.handlers, true)).length, 0);

    // Malformed TOML or invalid prefix fields disable the whole custom list and
    // warn without repairing or rewriting the authoritative source.
    const invalidCases: Array<{ name: string; prepare(): void; unchanged(): void }> = [
      {
        name: "invalid TOML",
        prepare() {
          writeFileSync(overridePath, "[transcript\nhidden_input_prefixes = [\"VALID: \"]\n");
        },
        unchanged() {
          assert.equal(
            readFileSync(overridePath, "utf8"),
            "[transcript\nhidden_input_prefixes = [\"VALID: \"]\n",
          );
        },
      },
      {
        name: "invalid field type",
        prepare() {
          writeFileSync(overridePath, '[transcript]\nhidden_input_prefixes = "VALID: "\n');
        },
        unchanged() {
          assert.equal(
            readFileSync(overridePath, "utf8"),
            '[transcript]\nhidden_input_prefixes = "VALID: "\n',
          );
        },
      },
      ...["", "  \n", " \n\t "].map((prefix) => ({
        name: "empty prefix entry",
        prepare() {
          writeFileSync(overridePath, configWithPrefixes(["VALID: ", prefix]));
        },
        unchanged() {
          assert.deepEqual(
            (parseToml(readFileSync(overridePath, "utf8")).transcript as {
              hidden_input_prefixes: string[];
            }).hidden_input_prefixes,
            ["VALID: ", prefix],
          );
        },
      })),
      {
        name: "read failure",
        prepare() {
          rmSync(overridePath, { force: true });
          mkdirSync(overridePath);
        },
        unchanged() {
          assert.equal(statSync(overridePath).isDirectory(), true);
        },
      },
    ];

    for (const invalid of invalidCases) {
      rmSync(overridePath, { recursive: true, force: true });
      invalid.prepare();
      const invalidHarness = install();
      assertDelegated(
        { role: "user", content: "VALID: must not partially match" },
        invalid.name,
      );
      assertHidden(
        { role: "user", content: `${INVISIBLE_SEPARATOR}HUSH_HIDE: still generic` },
        `${invalid.name} generic marker`,
      );
      const notifications = await startSession(invalidHarness.handlers, true);
      assert.equal(notifications.length, 1, `${invalid.name}: warning count`);
      assert.equal(notifications[0]?.level, "warning");
      assert.match(notifications[0]?.message ?? "", /config|toml|prefix/i);
      invalid.unchanged();
    }

    // Empty TOML is valid defaults (unlike an old blank JSON prefixes file).
    rmSync(overridePath, { recursive: true, force: true });
    writeFileSync(overridePath, "");
    const emptyToml = install();
    assertDelegated({ role: "user", content: "VALID: default" }, "empty TOML defaults");
    assert.equal((await startSession(emptyToml.handlers, true)).length, 0);
    assert.equal(readFileSync(overridePath, "utf8"), "");

    // Headless sessions report the same recoverable error to the console.
    writeFileSync(overridePath, '[transcript]\nhidden_input_prefixes = ["VALID: ", 1]\n');
    const headless = install();
    const errors: string[] = [];
    const oldConsoleError = console.error;
    console.error = (...values: unknown[]) => errors.push(values.map(String).join(" "));
    try {
      await startSession(headless.handlers, false);
    } finally {
      console.error = oldConsoleError;
    }
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /pi-hush:.*(?:config|prefix)/i);
    assert.equal(
      readFileSync(overridePath, "utf8"),
      '[transcript]\nhidden_input_prefixes = ["VALID: ", 1]\n',
    );

    // A later valid reinstall recovers immediately and carries no stale warning.
    writeFileSync(overridePath, configWithPrefixes(["RECOVERED: "]));
    const recovered = install();
    assertHidden({ role: "user", content: "RECOVERED: now" }, "invalid recovery");
    assert.equal((await startSession(recovered.handlers, true)).length, 0);

    writeFileSync(overridePath, configWithPrefixes([]));
    const cleared = install();
    assertDelegated({ role: "user", content: "RECOVERED: cleared" }, "empty-list reset");
    assert.equal((await startSession(cleared.handlers, true)).length, 0);
    assert.deepEqual(
      (parseToml(readFileSync(overridePath, "utf8")).transcript as {
        hidden_input_prefixes: string[];
      }).hidden_input_prefixes,
      [],
    );

    console.log("hidden-input-prefix core scenario passed");
  } finally {
    prototype.addMessageToChat = originalAddMessageToChat;
    if (oldPatch === undefined) delete registry[patchSymbol];
    else registry[patchSymbol] = oldPatch;
    if (oldOriginal === undefined) delete registry[originalSymbol];
    else registry[originalSymbol] = oldOriginal;
    applyHushPreference({ active: true, thinking: false });
    setHushStockExportRendering(false);
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

async function runLegacyUpgradeScenario() {
  const root = mkdtempSync(join(tmpdir(), "pi-hush-prefix-upgrade-"));
  const agentDir = join(root, "agent");
  const configPath = join(root, "config.toml");
  const prototype = PiCodingAgent.InteractiveMode.prototype as unknown as {
    addMessageToChat(this: TestPresentation, message: Message, options?: unknown): void;
  };
  const baseDelegate = prototype.addMessageToChat;
  const patchSymbol = Symbol.for("pi-hush:operational-user-layout:pi-0.85.1");
  const originalSymbol = Symbol.for(
    "pi-hush:operational-user-layout:original-addMessageToChat:v1",
  );
  const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
  const oldPatchValue = registry[patchSymbol];
  const oldOriginalValue = registry[originalSymbol];
  const environment = {
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    PI_HUSH_CONFIG_PATH: process.env.PI_HUSH_CONFIG_PATH,
  };

  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_HUSH_CONFIG_PATH = configPath;
    PiCodingAgent.initTheme(undefined, false);
    applyHushPreference({ active: true, thinking: false });
    setHushStockExportRendering(false);
    writeFileSync(
      configPath,
      'version = 1\n[transcript]\nhidden_input_prefixes = ["ASCII_OP: "]\n',
    );

    const firstmatePrefix = `${INVISIBLE_SEPARATOR}FIRSTMATE_OP: v1 `;
    const legacyPatch = {
      hidesOperationalInput: () => true,
      isOperationalInput: (text: string) =>
        text.startsWith(`${firstmatePrefix}watcher: `),
    };
    let legacyCalls = 0;
    const legacyDelegate = function (
      this: TestPresentation,
      message: Message,
      options?: unknown,
    ) {
      legacyCalls += 1;
      const text = this.getUserMessageText(message);
      if (
        message.role === "user" &&
        text.includes(INVISIBLE_SEPARATOR) &&
        legacyPatch.isOperationalInput(text)
      ) {
        this.chatContainer.addChild({ render: () => [] });
        return;
      }
      this.delegateCalls.push({ message, options });
    };

    delete registry[originalSymbol];
    registry[patchSymbol] = legacyPatch;
    prototype.addMessageToChat = legacyDelegate;

    install();
    assertHidden(
      { role: "user", content: "ASCII_OP: restored before session_start" },
      "upgrade removes legacy invisible-marker guard",
    );
    assertDelegated(
      { role: "user", content: `${firstmatePrefix}watcher: old implicit default` },
      "upgrade updates legacy patch callback",
    );
    assert.equal(
      legacyPatch.isOperationalInput(`${firstmatePrefix}watcher: old implicit default`),
      false,
      "legacy global callback retained implicit Firstmate behavior",
    );

    // Reinstall must keep another extension's later wrapper, while replacing
    // our matching rules and delegating each non-match through the chain once.
    const hushDelegate = prototype.addMessageToChat;
    let observerCalls = 0;
    prototype.addMessageToChat = function (message, options) {
      observerCalls += 1;
      hushDelegate.call(this, message, options);
    };
    const previousLegacyCalls = legacyCalls;
    writeFileSync(
      configPath,
      'version = 1\n[transcript]\nhidden_input_prefixes = ["NEWER_OP: "]\n',
    );
    install();
    assertDelegated({ role: "user", content: "ASCII_OP: removed" }, "second reload removes rule");
    assert.equal(observerCalls, 1, "Reinstall must preserve another extension's wrapper");
    assert.equal(legacyCalls, previousLegacyCalls + 1, "Legacy delegation must not accumulate");
    assertHidden({ role: "user", content: "NEWER_OP: current" }, "second reload updates matcher");
    assert.equal(observerCalls, 2);
    assert.equal(legacyCalls, previousLegacyCalls + 1);

    console.log("hidden-input-prefix legacy-upgrade scenario passed");
  } finally {
    prototype.addMessageToChat = baseDelegate;
    if (oldPatchValue === undefined) delete registry[patchSymbol];
    else registry[patchSymbol] = oldPatchValue;
    if (oldOriginalValue === undefined) delete registry[originalSymbol];
    else registry[originalSymbol] = oldOriginalValue;
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    applyHushPreference({ active: true, thinking: false });
    setHushStockExportRendering(false);
    rmSync(root, { recursive: true, force: true });
  }
}

if (scenario === "core") {
  await runCoreScenario();
} else if (scenario === "legacy-upgrade") {
  await runLegacyUpgradeScenario();
} else {
  const testFile = fileURLToPath(import.meta.url);
  for (const childScenario of ["core", "legacy-upgrade"]) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", testFile],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PI_HUSH_PREFIX_TEST_SCENARIO: childScenario,
        },
        encoding: "utf8",
      },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.equal(
      result.status,
      0,
      `hidden-input-prefix ${childScenario} scenario failed${
        result.signal ? ` (${result.signal})` : ""
      }`,
    );
  }
  console.log("hidden-input-prefix integration checks passed");
}
