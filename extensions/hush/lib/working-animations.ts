import {
  HushWorkingAnimationRegistry,
  type HushWorkingAnimation,
} from "./working-animation.ts";
import { HUSH_WORKING_BARS_ANIMATION } from "./working-bars.ts";
import { HUSH_WORKING_WAVE_ANIMATION } from "./working-wave.ts";

export const DEFAULT_HUSH_WORKING_ANIMATION_ID =
  HUSH_WORKING_WAVE_ANIMATION.id;

export const BUILT_IN_HUSH_WORKING_ANIMATIONS = [
  HUSH_WORKING_WAVE_ANIMATION,
  HUSH_WORKING_BARS_ANIMATION,
] as const satisfies readonly HushWorkingAnimation[];

/** Create a registry so hosts/tests can add contracts without mutating a singleton. */
export function createHushWorkingAnimationRegistry(
  additionalAnimations: Iterable<HushWorkingAnimation> = [],
): HushWorkingAnimationRegistry {
  return new HushWorkingAnimationRegistry([
    ...BUILT_IN_HUSH_WORKING_ANIMATIONS,
    ...additionalAnimations,
  ]);
}
