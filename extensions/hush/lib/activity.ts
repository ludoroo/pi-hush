export type HushActivityPlacement =
  | "status"
  | "widget-left"
  | "widget-right";

export const DEFAULT_HUSH_ACTIVITY_PLACEMENT: HushActivityPlacement = "status";
export const DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED = true;
export const HUSH_ACTIVITY_TOOL_NAME_MAX_LENGTH = 80;

type HushAssistantPhase = "working" | "thinking" | "responding";

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
 * Thinking requires explicit thinking events; other busy periods are Working.
 * Tool execution always takes precedence over the assistant streaming phase.
 */
export class HushActivityTracker {
  #running = false;
  #phase: HushAssistantPhase = "working";
  readonly #activeTools = new Map<string, string>();

  get text(): string | undefined {
    if (!this.#running) return undefined;
    const firstTool = this.#activeTools.values().next().value as
      | string
      | undefined;
    if (firstTool !== undefined) {
      const additional = this.#activeTools.size - 1;
      return `Running ${firstTool}${additional > 0 ? ` +${additional}` : ""}`;
    }
    if (this.#phase === "thinking") return "Thinking";
    return this.#phase === "responding" ? "Responding" : "Working";
  }

  startRun(): void {
    this.#activeTools.clear();
    this.#running = true;
    this.#phase = "working";
  }

  startTurn(): void {
    if (!this.#running) return;
    this.#phase = "working";
  }

  updateAssistant(eventType: string): void {
    if (!this.#running) return;
    switch (eventType) {
      case "thinking_start":
      case "thinking_delta":
        this.#phase = "thinking";
        break;
      case "text_start":
      case "text_delta":
        this.#phase = "responding";
        break;
      case "thinking_end":
        if (this.#phase === "thinking") this.#phase = "working";
        break;
      case "text_end":
        if (this.#phase === "responding") this.#phase = "working";
        break;
      case "start":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
      case "done":
      case "error":
        this.#phase = "working";
        break;
    }
  }

  startTool(toolCallId: string, toolName: string): void {
    if (!this.#running) return;
    if (!this.#activeTools.has(toolCallId)) {
      this.#activeTools.set(toolCallId, sanitizeHushToolName(toolName));
    }
  }

  endTool(toolCallId: string): void {
    // Reveal the current assistant phase if streaming overlapped this tool.
    this.#activeTools.delete(toolCallId);
  }

  /** Clear possibly incomplete tools while Pi finishes settling the run. */
  endRun(): void {
    this.#activeTools.clear();
    if (this.#running) this.#phase = "working";
  }

  reset(): void {
    this.#activeTools.clear();
    this.#running = false;
    this.#phase = "working";
  }
}
