import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  HUSH_ANIMATION_DISCOVERY_EVENT,
  type HushAnimationDiscovery,
  type HushWorkingAnimation,
} from "./extensions/hush/lib/animation.ts";

export {
  HUSH_ANIMATION_DISCOVERY_EVENT,
  HUSH_ANIMATION_ID_PATTERN,
  HUSH_ANIMATION_MAX_HEIGHT,
  HUSH_ANIMATION_ROW_BUDGET,
  HUSH_LOADER_INDENT,
  defineHushWorkingAnimation,
  resolveHushAnimationWidth,
  resolveHushAnimationHeight,
  type HushAnimationColor,
  type HushAnimationDiscovery,
  type HushAnimationFrame,
  type HushAnimationFrameContext,
  type HushAnimationRenderContext,
  type HushAnimationRow,
  type HushAnimationFrameSegment,
  type HushAnimationPalette,
  type HushAnimationWidth,
  type HushFrameAnimation,
  type HushProceduralAnimation,
  type HushWorkingAnimation,
} from "./extensions/hush/lib/animation.ts";

/** Adapt one contract into a publishable Pi extension entrypoint. */
export function createHushAnimationExtension(
  animation: HushWorkingAnimation,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.events.on(HUSH_ANIMATION_DISCOVERY_EVENT, (data) => {
      const discovery = data as HushAnimationDiscovery;
      if (discovery.apiVersion === 1) discovery.register(animation);
    });
  };
}
