import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  HUSH_ANIMATION_DISCOVERY_EVENT,
  type HushAnimationDiscovery,
  type HushWorkingAnimation,
} from "./extensions/hush/lib/working-animation.ts";

export {
  HUSH_ANIMATION_DISCOVERY_EVENT,
  HUSH_ANIMATION_ID_PATTERN,
  HUSH_ANIMATION_MAX_HEIGHT,
  HUSH_LOADER_INDENT,
  defineHushWorkingAnimation,
  resolveHushAnimationWidth,
  type HushAnimationDiscovery,
  type HushAnimationFrameContext,
  type HushAnimationPalette,
  type HushAnimationWidth,
  type HushWorkingAnimation,
} from "./extensions/hush/lib/working-animation.ts";

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
