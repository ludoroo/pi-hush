/**
 * pi-hush — conversation-only transcript presentation for the Pi coding agent.
 *
 * Hush is on by default. Preferences persist under the Pi agent directory.
 *
 * While active:
 *   - genuine user prompts stay visible
 *   - genuine assistant text stays visible
 *   - a pluggable theme-coloured widget animation shows working activity
 *   - thinking / CoT blocks are hidden by default; `/hush thinking` shows them
 *   - all tool shells (built-in and user-defined) are removed from the transcript
 *   - operational user rows marked with U+2063 envelopes render at zero height
 *
 * Presentation only. Delivery, tool execution, model context, session storage,
 * and /export /share content are unchanged. Export/share briefly restore stock
 * rendering for the serialization pass.
 *
 * Install:
 *   pi install /absolute/path/to/pi-hush
 *   # or copy extensions/hush → ~/.pi/agent/extensions/hush
 *   # or: pi -e ./extensions/hush/index.ts
 *
 * Usage:
 *   /hush on                  Hush on, thinking hidden
 *   /hush thinking            Hush on, toggle thinking / CoT
 *   /hush animation <name>    Select a working animation
 *   /hush off                 Hush off
 *
 * Verified against Pi 0.85.1. Adapters probe the exact APIs they patch
 * and degrade independently if a future Pi removes a seam.
 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  findHushAnimationFiles,
  loadHushAnimationFiles,
} from "./lib/animation-loader.ts";
import { getKeybindings, type AutocompleteItem } from "@earendil-works/pi-tui";
import {
  resolveHushAnimationPreference,
  serializeHushAnimationPreference,
} from "./lib/animation-preference.ts";
import { installHushAssistantLayout } from "./lib/assistant-layout.ts";
import { installHushOperationalUserLayout } from "./lib/operational-user-layout.ts";
import { installHushToolExecutionLayout } from "./lib/tool-execution-layout.ts";
import {
  HUSH_ANIMATION_DISCOVERY_EVENT,
  HushWorkingAnimationHost,
  type HushAnimationDiscovery,
} from "./lib/working-animation.ts";
import {
  BUILT_IN_HUSH_WORKING_ANIMATIONS,
  createHushWorkingAnimationRegistry,
  DEFAULT_HUSH_WORKING_ANIMATION_ID,
} from "./lib/working-animations.ts";
import {
  applyHushPreference,
  HUSH_PRESENTATION_EVENT,
  DEFAULT_HUSH_PREFERENCE,
  getHushPreference,
  parseHushPreference,
  serializeHushPreference,
  setHushStockExportRendering,
  type HushPreference,
} from "./lib/visibility.ts";

// Each presentation adapter probes the exact Pi API it patches. If a future Pi
// removes that API, only the affected adapter degrades.
function installHushPresentationAdapter(name: string, install: () => void): void {
  try {
    install();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `pi-hush: ${name} presentation adapter unavailable, skipping. ${reason}`,
    );
  }
}

function describeHushState(preference: HushPreference): string {
  if (!preference.active) return "Hush off — ordinary transcript restored";
  if (preference.thinking) {
    return "Hush on — tools hidden, thinking shown";
  }
  return "Hush on — tools and thinking hidden";
}

const hushWorkingAnimations = createHushWorkingAnimationRegistry();

const HUSH_COMMAND_ARGUMENTS: AutocompleteItem[] = [
  {
    value: "on",
    label: "on",
    description: "Enable Hush and hide thinking",
  },
  {
    value: "thinking",
    label: "thinking",
    description: "Keep Hush on and toggle thinking / CoT",
  },
  {
    value: "animation",
    label: "animation",
    description: "Select a working animation",
  },
  {
    value: "off",
    label: "off",
    description: "Disable Hush",
  },
];

export function getHushArgumentCompletions(
  argumentPrefix: string,
): AutocompleteItem[] | null {
  const prefix = argumentPrefix.trimStart().toLowerCase();
  const animationMatch = prefix.match(/^animation\s+([^\s]*)$/);
  if (animationMatch) {
    const animationPrefix = animationMatch[1];
    const matches = hushWorkingAnimations
      .list()
      .filter((animation) => animation.id.startsWith(animationPrefix))
      .map((animation) => ({
        value: `animation ${animation.id}`,
        label: animation.id,
        description: animation.description,
      }));
    return matches.length > 0 ? matches : null;
  }
  if (prefix.includes(" ")) return null;
  const matches = HUSH_COMMAND_ARGUMENTS.filter((item) =>
    item.value.startsWith(prefix),
  );
  return matches.length > 0 ? matches : null;
}

export default function (pi: ExtensionAPI) {
  installHushPresentationAdapter("collapsed-thinking", installHushAssistantLayout);
  installHushPresentationAdapter(
    "operational-user-row",
    installHushOperationalUserLayout,
  );
  // Hide every tool row regardless of which extension owns the tool.
  installHushPresentationAdapter("tool-row", installHushToolExecutionLayout);

  const workingAnimationHost = new HushWorkingAnimationHost(
    hushWorkingAnimations,
    DEFAULT_HUSH_WORKING_ANIMATION_ID,
  );
  let exportRendering = false;
  let workingAnimationId = DEFAULT_HUSH_WORKING_ANIMATION_ID;
  let widgetsEnabled = false;
  let removeTerminalInputHandler: (() => void) | undefined;

  const applyWorkingPresentation = (ui: ExtensionCommandContext["ui"]): void => {
    workingAnimationHost.apply(ui, {
      enabled: getHushPreference().active,
      animationId: workingAnimationId,
      widgetsEnabled,
    });
  };

  // Persist under the Pi agent dir so preferences survive sessions.
  const agentDir = getAgentDir();
  const hushDir = resolve(agentDir, "hush");
  const preferencePath =
    process.env.PI_HUSH_PREFERENCE_PATH ?? resolve(hushDir, "preference");
  const animationPreferencePath =
    process.env.PI_HUSH_ANIMATION_PATH ??
    resolve(hushDir, "selected-animation");

  const loadHushPreference = (): HushPreference => {
    try {
      return parseHushPreference(readFileSync(preferencePath, "utf8"));
    } catch {
      // Missing file → default on.
      return { ...DEFAULT_HUSH_PREFERENCE };
    }
  };

  const loadWorkingAnimationId = (): string => {
    try {
      return resolveHushAnimationPreference(
        readFileSync(animationPreferencePath, "utf8"),
        hushWorkingAnimations,
        DEFAULT_HUSH_WORKING_ANIMATION_ID,
      );
    } catch {
      return DEFAULT_HUSH_WORKING_ANIMATION_ID;
    }
  };

  const persistText = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  };

  const persistHushPreference = (preference: HushPreference): void => {
    persistText(preferencePath, serializeHushPreference(preference));
  };

  const persistWorkingAnimationId = (id: string): void => {
    persistText(animationPreferencePath, serializeHushAnimationPreference(id));
  };

  const refreshWorkingAnimations = async (
    ctx: Pick<
      ExtensionCommandContext,
      "cwd" | "hasUI" | "isProjectTrusted" | "ui"
    >,
  ) => {
    workingAnimationHost.retryFailedAnimations();
    hushWorkingAnimations.reset(BUILT_IN_HUSH_WORKING_ANIMATIONS);
    const discoveredIds = new Set(
      BUILT_IN_HUSH_WORKING_ANIMATIONS.map((animation) => animation.id),
    );
    const animationRoots = [resolve(hushDir, "animations")];
    if (ctx.isProjectTrusted()) {
      animationRoots.push(
        resolve(ctx.cwd, CONFIG_DIR_NAME, "hush", "animations"),
      );
    }
    for (const path of findHushAnimationFiles(animationRoots)) {
      try {
        const [{ animation }] = await loadHushAnimationFiles([path]);
        if (discoveredIds.has(animation.id)) {
          throw new Error(`Duplicate Hush animation id: ${animation.id}`);
        }
        hushWorkingAnimations.register(animation);
        discoveredIds.add(animation.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Could not load Hush animation: ${path}. ${reason}`,
            "warning",
          );
        } else {
          console.error(`pi-hush: could not load animation ${path}. ${reason}`);
        }
      }
    }

    const discovery: HushAnimationDiscovery = {
      apiVersion: 1,
      register: (animation) => {
        try {
          if (discoveredIds.has(animation.id)) {
            throw new Error(`Duplicate Hush animation id: ${animation.id}`);
          }
          hushWorkingAnimations.register(animation);
          discoveredIds.add(animation.id);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) {
            ctx.ui.notify(
              `Could not register Hush animation. ${reason}`,
              "warning",
            );
          } else {
            console.error(`pi-hush: could not register animation. ${reason}`);
          }
        }
      },
    };
    pi.events.emit(HUSH_ANIMATION_DISCOVERY_EVENT, discovery);
    if (!hushWorkingAnimations.get(workingAnimationId)) {
      workingAnimationId = DEFAULT_HUSH_WORKING_ANIMATION_ID;
    }
  };

  const publishPresentationState = (): void => {
    const preference = getHushPreference();
    const state = {
      active: preference.active,
      thinking: preference.thinking,
      workingAnimationId,
      stockExportRendering: exportRendering,
    };
    pi.events.emit(HUSH_PRESENTATION_EVENT, state);
  };

  const applyAndRefresh = (
    preference: HushPreference,
    ctx: ExtensionCommandContext | { ui: ExtensionCommandContext["ui"] },
  ): void => {
    applyHushPreference(preference);
    publishPresentationState();
    applyWorkingPresentation(ctx.ui);
    // When hush hides thinking we blank the collapsed label; otherwise restore
    // Pi's default so expanded CoT / labels render normally.
    // Toggle the label once so existing AssistantMessageComponent rows re-run
    // updateContent through the hush patch (setHiddenThinkingLabel re-renders).
    const hushQuietThinking = preference.active && !preference.thinking;
    ctx.ui.setHiddenThinkingLabel(hushQuietThinking ? undefined : "");
    ctx.ui.setHiddenThinkingLabel(hushQuietThinking ? "" : undefined);
    ctx.ui.setStatus("pi-hush", undefined);

    // Rebuild controllable rows, preserve Ctrl+O expansion state.
    const expanded = ctx.ui.getToolsExpanded();
    ctx.ui.setToolsExpanded(!expanded);
    ctx.ui.setToolsExpanded(expanded);
  };

  const setPreference = (
    preference: HushPreference,
    ctx: ExtensionCommandContext,
    notify = true,
  ): void => {
    persistHushPreference(preference);
    applyAndRefresh(preference, ctx);
    if (notify && ctx.hasUI) {
      ctx.ui.notify(describeHushState(preference), "info");
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    exportRendering = false;
    widgetsEnabled = ctx.mode === "tui";

    // Every extension factory is loaded before session_start, so event-based
    // registrations are independent of package load order.
    await refreshWorkingAnimations(ctx);
    workingAnimationId = loadWorkingAnimationId();
    setHushStockExportRendering(false);
    workingAnimationHost.setWorking(!ctx.isIdle());
    applyAndRefresh(loadHushPreference(), ctx);
    removeTerminalInputHandler?.();
    removeTerminalInputHandler = ctx.ui.onTerminalInput((data) => {
      if (!getKeybindings().matches(data, "tui.input.submit")) {
        return undefined;
      }

      const input = ctx.ui.getEditorText().trim();
      if (
        input !== "/share" &&
        input !== "/export" &&
        !input.startsWith("/export ")
      ) {
        return undefined;
      }

      // Briefly restore stock rendering so export/share capture full chrome.
      exportRendering = true;
      setHushStockExportRendering(true);
      publishPresentationState();
      setTimeout(() => {
        exportRendering = false;
        setHushStockExportRendering(false);
        publishPresentationState();
        // Force controllable rows to rebuild, then restore Ctrl+O state.
        const expanded = ctx.ui.getToolsExpanded();
        ctx.ui.setToolsExpanded(!expanded);
        ctx.ui.setToolsExpanded(expanded);
      }, 0);

      // Do not consume the submit key; Pi still needs to execute /share or /export.
      return undefined;
    });
  });

  pi.on("agent_start", () => {
    workingAnimationHost.setWorking(true);
  });

  pi.on("agent_settled", () => {
    workingAnimationHost.setWorking(false);
  });

  pi.on("session_shutdown", () => {
    removeTerminalInputHandler?.();
    removeTerminalInputHandler = undefined;
    workingAnimationHost.setWorking(false);
    workingAnimationHost.dispose({ restorePi: true });
  });

  pi.registerCommand("hush", {
    description:
      "Hush transcript and working animation: /hush on, thinking, animation <name>, or off.",
    getArgumentCompletions: getHushArgumentCompletions,
    handler: async (args, ctx) => {
      const argument = args.trim().toLowerCase();
      const current = getHushPreference();

      if (argument === "on") {
        // /hush on always means Hush on with thinking hidden.
        setPreference({ active: true, thinking: false }, ctx);
        return;
      }

      if (argument === "thinking") {
        // /hush thinking enables Hush and toggles CoT visibility.
        setPreference(
          {
            active: true,
            thinking: current.active ? !current.thinking : true,
          },
          ctx,
        );
        return;
      }

      const selectAnimation = (id: string): void => {
        const animation = hushWorkingAnimations.get(id);
        if (!animation) {
          if (ctx.hasUI) {
            ctx.ui.notify(`Unknown Hush animation: ${id}`, "warning");
          }
          return;
        }
        const latestPreference = getHushPreference();
        workingAnimationId = animation.id;
        persistWorkingAnimationId(animation.id);
        setPreference(
          {
            active: true,
            thinking: latestPreference.active
              ? latestPreference.thinking
              : false,
          },
          ctx,
          false,
        );
        if (ctx.hasUI) {
          ctx.ui.notify(`Hush animation: ${animation.label}`, "info");
        }
      };

      if (argument === "animation") {
        await refreshWorkingAnimations(ctx);
        if (!ctx.hasUI) return;
        const choices = hushWorkingAnimations.list().map((animation) => ({
          id: animation.id,
          option: `${animation.id} — ${animation.description}`,
        }));
        const selected = await ctx.ui.select(
          `Hush animation (current: ${workingAnimationId})`,
          choices.map((choice) => choice.option),
        );
        const selectedId = choices.find(
          (choice) => choice.option === selected,
        )?.id;
        if (selectedId) selectAnimation(selectedId);
        return;
      }

      const animationMatch = argument.match(/^animation\s+([^\s]+)$/);
      if (animationMatch) {
        await refreshWorkingAnimations(ctx);
        selectAnimation(animationMatch[1]);
        return;
      }

      if (argument === "off") {
        setPreference({ active: false, thinking: false }, ctx);
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          "Usage: /hush on | /hush thinking | /hush animation <name> | /hush off",
          "warning",
        );
      }
    },
  });
}
