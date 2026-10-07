import type { HushActivityPlacement } from "./activity.ts";

/** Audited transcript classes Hush may control when Pi exposes a renderer. */
export const HUSH_TRANSCRIPT_CLASSES = [
  "genuine-user-prompt",
  "genuine-agent-response",
  "assistant-thinking",
  "assistant-tool-call",
  "tool-result",
  "tool-image",
  "user-bash",
  "skill-invocation",
  "custom-message",
  "custom-entry",
  "compaction-summary",
  "branch-summary",
  "working-status",
  "command-status",
  "system-notice",
  "cache-notice",
  "project-trust-warning",
  "synthetic-user",
  "synthetic-assistant",
  "unknown",
] as const;

export type HushTranscriptClass = (typeof HUSH_TRANSCRIPT_CLASSES)[number];

/** Classes that stay visible while Hush is active (thinking is optional). */
const HUSH_VISIBLE_CLASSES = new Set<HushTranscriptClass>([
  "genuine-user-prompt",
  "genuine-agent-response",
  "working-status",
]);

/** Cross-extension presentation state event. */
export const HUSH_PRESENTATION_EVENT = "pi-hush:presentation";

export type HushPresentationState = {
  active: boolean;
  /** When hush is on, whether thinking / CoT blocks are shown. */
  thinking: boolean;
  workingAnimationId: string;
  /** Whether concise live activity text is configured. */
  activityTextEnabled: boolean;
  /** Surface selected for activity text. */
  activityPlacement: HushActivityPlacement;
  /** Current visible activity text, when Hush and the option are active. */
  activityText?: string;
  stockExportRendering: boolean;
};

function sameHushPresentationState(
  left: HushPresentationState,
  right: HushPresentationState,
): boolean {
  return (
    left.active === right.active &&
    left.thinking === right.thinking &&
    left.workingAnimationId === right.workingAnimationId &&
    left.activityTextEnabled === right.activityTextEnabled &&
    left.activityPlacement === right.activityPlacement &&
    left.activityText === right.activityText &&
    left.stockExportRendering === right.stockExportRendering
  );
}

/** Suppress identical cross-extension state events, including token deltas. */
export class HushPresentationPublisher {
  #lastState: HushPresentationState | undefined;

  reset(): void {
    this.#lastState = undefined;
  }

  publish(
    state: HushPresentationState,
    emit: (state: HushPresentationState) => void,
  ): boolean {
    if (this.#lastState && sameHushPresentationState(this.#lastState, state)) {
      return false;
    }
    this.#lastState = { ...state };
    emit(state);
    return true;
  }
}

export type HushPreference = {
  active: boolean;
  thinking: boolean;
};

/** Default: Hush on, thinking hidden, compact working loader enabled. */
export const DEFAULT_HUSH_PREFERENCE: HushPreference = {
  active: true,
  thinking: false,
};

let hush = DEFAULT_HUSH_PREFERENCE.active;
let thinkingVisible = DEFAULT_HUSH_PREFERENCE.thinking;
let stockExportRendering = false;

export function hushTranscriptClassIsVisible(
  itemClass: HushTranscriptClass,
): boolean {
  if (itemClass === "assistant-thinking" && thinkingVisible) return true;
  return HUSH_VISIBLE_CLASSES.has(itemClass);
}

export function setHushPresentation(active: boolean): void {
  hush = active;
}

export function setHushThinkingVisible(visible: boolean): void {
  thinkingVisible = visible;
}

export function setHushStockExportRendering(active: boolean): void {
  stockExportRendering = active;
}

export function hushPresentationIsActive(): boolean {
  return hush;
}

export function hushThinkingIsVisible(): boolean {
  return thinkingVisible;
}

export function getHushPreference(): HushPreference {
  return { active: hush, thinking: thinkingVisible };
}

/**
 * Apply a full preference snapshot to the in-memory presentation flags.
 * Does not touch stockExportRendering.
 */
export function applyHushPreference(preference: HushPreference): void {
  hush = preference.active;
  thinkingVisible = preference.thinking;
}

export function hushPresentationHides(itemClass: HushTranscriptClass): boolean {
  return (
    hush && !stockExportRendering && !hushTranscriptClassIsVisible(itemClass)
  );
}
