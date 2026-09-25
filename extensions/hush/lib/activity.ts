export const DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED = false;
export const HUSH_ACTIVITY_TOOL_NAME_MAX_LENGTH = 80;

type HushAssistantPhase = "thinking" | "responding";

/** Parse the separate activity-text preference. Malformed input stays quiet. */
export function parseHushActivityPreference(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === "on") return true;
  if (normalized === "off") return false;
  return DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED;
}

export function serializeHushActivityPreference(enabled: boolean): string {
  return enabled ? "on\n" : "off\n";
}

/** Strip terminal sequences and control characters before single-row layout. */
export function sanitizeHushActivityText(text: string): string {
  const withoutOsc = text.replace(
    /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\|$)/g,
    " ",
  );
  const withoutAnsi = withoutOsc
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, " ")
    .replace(/\u009B[0-?]*[ -/]*[@-~]/g, " ");
  return withoutAnsi
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep model-provided tool names to harmless, compact, single-line text. */
export function sanitizeHushToolName(name: string): string {
  const normalized = sanitizeHushActivityText(name);
  if (!normalized) return "tool";
  return Array.from(normalized)
    .slice(0, HUSH_ACTIVITY_TOOL_NAME_MAX_LENGTH)
    .join("");
}

/**
 * Converts Pi's streaming and parallel-tool lifecycle into one concise label.
 * Tool execution always takes precedence over the assistant streaming phase.
 */
export class HushActivityTracker {
  #running = false;
  #phase: HushAssistantPhase = "thinking";
  readonly #activeTools = new Map<string, string>();

  get text(): string | undefined {
    if (!this.#running) return undefined;
    const firstTool = this.#activeTools.values().next().value as
      | string
      | undefined;
    if (firstTool !== undefined) {
      const additional = this.#activeTools.size - 1;
      return `Running ${firstTool}${additional > 0 ? ` +${additional}` : ""}…`;
    }
    return this.#phase === "responding" ? "Responding…" : "Thinking…";
  }

  startRun(): void {
    this.#activeTools.clear();
    this.#running = true;
    this.#phase = "thinking";
  }

  startTurn(): void {
    if (!this.#running) return;
    this.#phase = "thinking";
  }

  updateAssistant(eventType: string): void {
    if (!this.#running) return;
    if (
      eventType === "thinking_start" ||
      eventType === "thinking_delta" ||
      eventType === "toolcall_start"
    ) {
      this.#phase = "thinking";
    } else if (eventType === "text_start" || eventType === "text_delta") {
      this.#phase = "responding";
    }
  }

  startTool(toolCallId: string, toolName: string): void {
    if (!this.#running) return;
    if (!this.#activeTools.has(toolCallId)) {
      this.#activeTools.set(toolCallId, sanitizeHushToolName(toolName));
    }
  }

  endTool(toolCallId: string): void {
    this.#activeTools.delete(toolCallId);
    if (this.#activeTools.size === 0) this.#phase = "thinking";
  }

  /** Clear possibly incomplete tools while Pi finishes settling the run. */
  endRun(): void {
    this.#activeTools.clear();
    if (this.#running) this.#phase = "thinking";
  }

  reset(): void {
    this.#activeTools.clear();
    this.#running = false;
    this.#phase = "thinking";
  }
}
