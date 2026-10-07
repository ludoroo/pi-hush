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
 *   - marked or configured-prefix user rows render at zero height
 *
 * Presentation only. Delivery, tool execution, model context, session storage,
 * and /export /share content are unchanged. Export/share briefly restore stock
 * rendering for the serialization pass.
 *
 * Install:
 *   pi install /absolute/path/to/pi-hush
 *   # or copy extensions/hush with its TOML dependencies (see README)
 *   # or: pi -e ./extensions/hush/index.ts
 *
 * Usage:
 *   /hush on                  Hush on, thinking hidden
 *   /hush thinking            Hush on, toggle thinking / CoT
 *   /hush activity            Hush on, toggle live activity text
 *   /hush activity <placement> Place text in status or either widget side
 *   /hush animation <name>    Select a working animation
 *   /hush width 28|60%|auto   Set this animation's drawing width
 *   /hush off                 Hush off
 *
 * Verified against Pi 0.85.1. Adapters probe the exact APIs they patch
 * and degrade independently if a future Pi removes a seam.
 */
import { resolve } from "node:path";
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
import { resolveHushAnimationPreference } from "./lib/animation-preference.ts";
import { HushConfigStore, type HushConfigPatch } from "./lib/config.ts";
import { installHushAssistantLayout } from "./lib/assistant-layout.ts";
import { installHushOperationalUserLayout } from "./lib/operational-user-layout.ts";
import { isOperationalInput } from "./lib/operational-input.ts";
import { installHushToolExecutionLayout } from "./lib/tool-execution-layout.ts";
import {
  DEFAULT_HUSH_ACTIVITY_PLACEMENT,
  DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED,
  HushActivityTracker,
  type HushActivityPlacement,
} from "./lib/activity.ts";
import {
  HUSH_ANIMATION_DISCOVERY_EVENT,
  HushAnimationHost,
  type HushAnimationDiscovery,
  type HushAnimationWidth,
} from "./lib/animation.ts";
import {
  createHushAnimationSettings,
  getHushAnimationWidthOverride,
  parseHushWidthArgument,
} from "./lib/animation-settings.ts";
import {
  BUILT_IN_HUSH_ANIMATIONS,
  createHushAnimationRegistry,
  DEFAULT_HUSH_ANIMATION_ID,
} from "./animations/index.ts";
import {
  applyHushPreference,
  HUSH_PRESENTATION_EVENT,
  HushPresentationPublisher,
  getHushPreference,
  setHushStockExportRendering,
  type HushPreference,
  type HushPresentationState,
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

const hushAnimations = createHushAnimationRegistry();

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
    value: "activity",
    label: "activity",
    description: "Keep Hush on and toggle live activity text",
  },
  {
    value: "animation",
    label: "animation",
    description: "Select an animation",
  },
  {
    value: "width",
    label: "width",
    description: "Set the selected animation's drawing width",
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
  const activityPlacementMatch = prefix.match(/^activity\s+([^\s]*)$/);
  if (activityPlacementMatch) {
    const placementPrefix = activityPlacementMatch[1];
    const matches = (
      ["status", "widget-left", "widget-right"] as const
    )
      .filter((placement) => placement.startsWith(placementPrefix))
      .map((placement) => ({
        value: `activity ${placement}`,
        label: placement,
        description: placement === "status"
          ? "Show activity in Pi's working status"
          : `Show activity on the widget's ${placement === "widget-left" ? "left" : "right"}`,
      }));
    return matches.length > 0 ? matches : null;
  }
  const widthMatch = prefix.match(/^width\s+([^\s]*)$/);
  if (widthMatch) {
    const widthPrefix = widthMatch[1];
    const matches = ["auto", "25%", "50%", "75%", "100%"]
      .filter((value) => value.startsWith(widthPrefix))
      .map((value) => ({
        value: `width ${value}`,
        label: value,
        description:
          value === "auto"
            ? "Use the animation's built-in width"
            : `${value} of the remaining animation space`,
      }));
    return matches.length > 0 ? matches : null;
  }
  const animationMatch = prefix.match(/^animation\s+([^\s]*)$/);
  if (animationMatch) {
    const animationPrefix = animationMatch[1];
    const matches = hushAnimations
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
  // Hide every tool row regardless of which extension owns the tool.
  installHushPresentationAdapter("tool-row", installHushToolExecutionLayout);

  const animationHost = new HushAnimationHost(
    hushAnimations,
    DEFAULT_HUSH_ANIMATION_ID,
  );
  const activity = new HushActivityTracker();
  const presentationPublisher = new HushPresentationPublisher();
  let exportRendering = false;
  let animationId = DEFAULT_HUSH_ANIMATION_ID;
  let activityTextEnabled = DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED;
  let activityPlacement = DEFAULT_HUSH_ACTIVITY_PLACEMENT;
  let animationSettings = createHushAnimationSettings();
  let widgetsEnabled = false;
  let removeTerminalInputHandler: (() => void) | undefined;

  const applyAnimationPresentation = (ui: ExtensionCommandContext["ui"]): void => {
    animationHost.apply(ui, {
      enabled: getHushPreference().active,
      animationId,
      widgetsEnabled,
      activityTextEnabled,
      activityPlacement,
      widthOverride: getHushAnimationWidthOverride(
        animationSettings,
        animationId,
      ),
    });
  };

  // One optional user-owned configuration outside the installed package.
  const agentDir = getAgentDir();
  const hushDir = resolve(agentDir, "hush");
  const configStore = new HushConfigStore({
    path: process.env.PI_HUSH_CONFIG_PATH ?? resolve(hushDir, "config.toml"),
  });

  // /reload restores chat before session_start. Apply configuration during the
  // factory and retain that exact snapshot through the first session_start.
  let pendingConfigLoad: ReturnType<HushConfigStore["load"]> | undefined = configStore.load();
  let hiddenInputPrefixes = pendingConfigLoad.config.hiddenInputPrefixes;
  applyHushPreference(pendingConfigLoad.config.preference);
  installHushPresentationAdapter("operational-user-row", () =>
    installHushOperationalUserLayout((text) =>
      isOperationalInput(text, hiddenInputPrefixes)),
  );

  const saveConfig = (
    patch: HushConfigPatch,
    ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
    failureMessage: string,
  ) => {
    try {
      return configStore.update(patch);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = `${failureMessage} ${reason}`;
      if (ctx.hasUI) ctx.ui.notify(message, "warning");
      else console.error(`pi-hush: ${message}`);
      return undefined;
    }
  };

  const describeWidth = (width: HushAnimationWidth): string => {
    if (typeof width === "number") return `${width} columns`;
    const bounds = [
      width.minColumns === undefined ? undefined : `min ${width.minColumns}`,
      width.maxColumns === undefined ? undefined : `max ${width.maxColumns}`,
    ].filter((bound) => bound !== undefined);
    const suffix = bounds.length === 0 ? "" : `, ${bounds.join(", ")} columns`;
    return `${Number((width.ratio * 100).toPrecision(12))}% of remaining animation space${suffix}`;
  };

  const describeCurrentAnimationWidth = (): string => {
    const override = getHushAnimationWidthOverride(
      animationSettings,
      animationId,
    );
    if (override !== undefined) return describeWidth(override);
    const builtIn = hushAnimations.get(animationId)?.width;
    return builtIn === undefined
      ? "auto"
      : `auto (animation default: ${describeWidth(builtIn)})`;
  };

  const refreshAnimations = async (
    ctx: Pick<
      ExtensionCommandContext,
      "cwd" | "hasUI" | "isProjectTrusted" | "ui"
    >,
  ) => {
    animationHost.retryFailedAnimations();
    hushAnimations.reset(BUILT_IN_HUSH_ANIMATIONS);
    const discoveredIds = new Set(
      BUILT_IN_HUSH_ANIMATIONS.map((animation) => animation.id),
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
        hushAnimations.register(animation);
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
          hushAnimations.register(animation);
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
    if (!hushAnimations.get(animationId)) {
      animationId = DEFAULT_HUSH_ANIMATION_ID;
    }
  };

  const currentActivityText = (): string | undefined =>
    getHushPreference().active && activityTextEnabled
      ? activity.text
      : undefined;

  const publishPresentationState = (): void => {
    const preference = getHushPreference();
    const activityText = currentActivityText();
    const state = {
      active: preference.active,
      thinking: preference.thinking,
      workingAnimationId: animationId,
      activityTextEnabled,
      activityPlacement,
      ...(activityText === undefined ? {} : { activityText }),
      stockExportRendering: exportRendering,
    } satisfies HushPresentationState;
    presentationPublisher.publish(state, (nextState) => {
      pi.events.emit(HUSH_PRESENTATION_EVENT, nextState);
    });
  };

  const syncActivity = (): void => {
    animationHost.setActivityText(currentActivityText());
    publishPresentationState();
  };

  const applyAndRefresh = (
    preference: HushPreference,
    ctx: ExtensionCommandContext | { ui: ExtensionCommandContext["ui"] },
  ): void => {
    applyHushPreference(preference);
    publishPresentationState();
    applyAnimationPresentation(ctx.ui);
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
  ): void => {
    if (!saveConfig(
      { enabled: preference.active, thinking: preference.thinking },
      ctx,
      "Could not save Hush preference.",
    )) return;
    applyAndRefresh(preference, ctx);
    if (ctx.hasUI) {
      ctx.ui.notify(describeHushState(preference), "info");
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const loaded = pendingConfigLoad ?? configStore.load();
    pendingConfigLoad = undefined;
    if (loaded.warning) {
      if (ctx.hasUI) ctx.ui.notify(loaded.warning, "warning");
      else console.error(`pi-hush: ${loaded.warning}`);
    }
    const config = loaded.config;
    hiddenInputPrefixes = config.hiddenInputPrefixes;
    presentationPublisher.reset();
    exportRendering = false;
    widgetsEnabled = ctx.mode === "tui";
    activityTextEnabled = config.activityTextEnabled;
    activityPlacement = config.activityPlacement;
    animationSettings = config.animationSettings;
    activity.reset();
    if (!ctx.isIdle()) activity.startRun();

    // Every extension factory is loaded before session_start, so event-based
    // registrations are independent of package load order.
    await refreshAnimations(ctx);
    animationId = resolveHushAnimationPreference(
      config.animationId, hushAnimations, DEFAULT_HUSH_ANIMATION_ID,
    );
    setHushStockExportRendering(false);
    animationHost.setWorking(!ctx.isIdle());
    applyAndRefresh(config.preference, ctx);
    syncActivity();
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
    activity.startRun();
    animationHost.setWorking(true);
    syncActivity();
  });

  pi.on("turn_start", () => {
    activity.startTurn();
    syncActivity();
  });

  pi.on("message_start", (event) => {
    if (event.message.role !== "assistant") return;
    activity.updateAssistant("start");
    syncActivity();
  });

  pi.on("message_update", (event) => {
    activity.updateAssistant(event.assistantMessageEvent.type);
    syncActivity();
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    // Pi delivers stream completion/failure through message_end, not necessarily
    // message_update. Do not leave a finished or aborted response as Thinking.
    activity.updateAssistant("done");
    syncActivity();
  });

  pi.on("tool_execution_start", (event) => {
    activity.startTool(event.toolCallId, event.toolName);
    syncActivity();
  });

  pi.on("tool_execution_end", (event) => {
    activity.endTool(event.toolCallId);
    syncActivity();
  });

  pi.on("agent_end", () => {
    activity.endRun();
    syncActivity();
  });

  pi.on("agent_settled", () => {
    activity.reset();
    syncActivity();
    animationHost.setWorking(false);
  });

  pi.on("session_shutdown", () => {
    removeTerminalInputHandler?.();
    removeTerminalInputHandler = undefined;
    activity.reset();
    animationHost.setActivityText(undefined);
    animationHost.setWorking(false);
    animationHost.dispose({ restorePi: true });
  });

  pi.registerCommand("hush", {
    description:
      "Hush transcript and working animation: /hush on, thinking, activity [status|widget-left|widget-right], animation <name>, width <columns|percent|auto>, or off.",
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

      if (argument === "activity") {
        const enabled = current.active ? !activityTextEnabled : true;
        const thinking = current.active ? current.thinking : false;
        if (!saveConfig(
          { enabled: true, thinking, activity: { enabled } },
          ctx,
          "Could not save Hush activity text.",
        )) return;
        activityTextEnabled = enabled;
        applyAndRefresh({ active: true, thinking }, ctx);
        syncActivity();
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Hush activity text: ${activityTextEnabled ? "on" : "off"}`,
            "info",
          );
        }
        return;
      }

      const activityPlacementMatch = argument.match(
        /^activity\s+(status|widget-left|widget-right)$/,
      );
      if (activityPlacementMatch) {
        const placement = activityPlacementMatch[1] as HushActivityPlacement;
        if (!saveConfig(
          { activity: { placement } },
          ctx,
          "Could not save Hush activity placement.",
        )) return;
        activityPlacement = placement;
        applyAnimationPresentation(ctx.ui);
        publishPresentationState();
        if (ctx.hasUI) {
          const enableHint = activityTextEnabled
            ? ""
            : "; activity text is off — use /hush activity to enable it";
          ctx.ui.notify(
            `Hush activity placement: ${activityPlacement}${enableHint}`,
            "info",
          );
        }
        return;
      }

      if (argument === "width") {
        try {
          animationSettings = configStore.read().animationSettings;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (ctx.hasUI) {
            ctx.ui.notify(
              `Could not read Hush width settings. ${reason}`,
              "warning",
            );
          } else {
            console.error(`pi-hush: could not read animation widths. ${reason}`);
          }
          return;
        }
        applyAnimationPresentation(ctx.ui);
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Hush width for ${animationId}: ${describeCurrentAnimationWidth()}. Usage: /hush width <columns|percent|auto>`,
            "info",
          );
        }
        return;
      }

      const widthMatch = argument.match(/^width\s+(.+)$/);
      if (widthMatch) {
        const requestedWidth = parseHushWidthArgument(widthMatch[1]);
        if (requestedWidth === undefined) {
          if (ctx.hasUI) {
            ctx.ui.notify(
              "Invalid Hush width. Use a positive safe integer, a percentage greater than 0 through 100%, or auto.",
              "warning",
            );
          }
          return;
        }

        // Read-before-write preserves the other settings, but this command only
        // applies widths to this session: it must not change Hush/activity state.
        const saved = saveConfig(
          { width: { animationId, value: requestedWidth === "auto" ? undefined : requestedWidth } },
          ctx,
          "Could not update Hush width; the configuration file was left untouched.",
        );
        if (!saved) return;
        animationSettings = saved.animationSettings;

        applyAnimationPresentation(ctx.ui);
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Hush width for ${animationId}: ${describeCurrentAnimationWidth()}`,
            "info",
          );
        }
        return;
      }

      const selectAnimation = (id: string): void => {
        const animation = hushAnimations.get(id);
        if (!animation) {
          if (ctx.hasUI) {
            ctx.ui.notify(`Unknown Hush animation: ${id}`, "warning");
          }
          return;
        }
        const latestPreference = getHushPreference();
        const thinking = latestPreference.active ? latestPreference.thinking : false;
        if (!saveConfig(
          { animation: animation.id, enabled: true, thinking },
          ctx,
          "Could not save Hush animation.",
        )) return;
        animationId = animation.id;
        applyAndRefresh({ active: true, thinking }, ctx);
        if (ctx.hasUI) {
          ctx.ui.notify(`Hush animation: ${animation.label}`, "info");
        }
      };

      if (argument === "animation") {
        await refreshAnimations(ctx);
        if (!ctx.hasUI) return;
        const choices = hushAnimations.list().map((animation) => ({
          id: animation.id,
          option: `${animation.id} — ${animation.description}`,
        }));
        const selected = await ctx.ui.select(
          `Hush animation (current: ${animationId})`,
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
        await refreshAnimations(ctx);
        selectAnimation(animationMatch[1]);
        return;
      }

      if (argument === "off") {
        setPreference({ active: false, thinking: false }, ctx);
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(
          "Usage: /hush on | /hush thinking | /hush activity [status|widget-left|widget-right] | /hush animation <name> | /hush width <columns|percent|auto> | /hush off",
          "warning",
        );
      }
    },
  });
}
