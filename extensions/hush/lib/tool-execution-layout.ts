/**
 * Zero-height tool-row presentation adapter.
 *
 * registerTool() can lose to another extension under Pi's first-wins tool
 * ownership. This adapter patches ToolExecutionComponent.render so every
 * tool row—built-in or user-defined—stays hidden under Hush regardless of
 * which extension owns the tool definition.
 *
 * Presentation only. Execution, results, and session storage are unchanged.
 */
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { hushPresentationHides } from "./visibility.ts";

type ToolExecutionPresentation = {
  render(width: number): string[];
};

type HushToolExecutionLayoutPatch = {
  hidesTools: () => boolean;
};

const HUSH_TOOL_EXECUTION_LAYOUT_PATCH = Symbol.for(
  "pi-hush:tool-execution-layout:pi-0.85.1",
);

export function installHushToolExecutionLayout(): void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: HushToolExecutionLayoutPatch | undefined;
  };
  const hidesTools = (): boolean =>
    hushPresentationHides("assistant-tool-call");
  const installed = registry[HUSH_TOOL_EXECUTION_LAYOUT_PATCH];
  if (installed) {
    installed.hidesTools = hidesTools;
    return;
  }

  const patch: HushToolExecutionLayoutPatch = { hidesTools };
  const ToolExecutionComponent = (
    PiCodingAgent as typeof PiCodingAgent & {
      ToolExecutionComponent?: new (...args: never[]) => ToolExecutionPresentation;
    }
  ).ToolExecutionComponent;
  if (typeof ToolExecutionComponent !== "function") {
    throw new Error("pi-hush requires Pi ToolExecutionComponent");
  }

  const prototype = ToolExecutionComponent.prototype as ToolExecutionPresentation;
  const originalRender = prototype.render;
  if (typeof originalRender !== "function") {
    throw new Error("pi-hush requires Pi ToolExecutionComponent.render");
  }

  prototype.render = function (this: ToolExecutionPresentation, width: number): string[] {
    if (patch.hidesTools()) {
      return [];
    }
    return originalRender.call(this, width);
  };

  registry[HUSH_TOOL_EXECUTION_LAYOUT_PATCH] = patch;
}
