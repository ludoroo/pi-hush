import {
  HushAnimationRegistry,
  type HushWorkingAnimation,
} from "./animation.ts";
import { HUSH_BARS_ANIMATION } from "./bars.ts";
import { HUSH_FISH_LOOP_ANIMATION } from "./fish-loop.ts";
import { HUSH_FLOCK_ANIMATION } from "./flock.ts";
import { HUSH_JUMPING_DOTS_ANIMATION } from "./jumping-dots.ts";
import { HUSH_SHOOTING_STAR_ANIMATION } from "./shooting-star.ts";
import { HUSH_WAVE_ANIMATION } from "./wave.ts";

export const DEFAULT_HUSH_ANIMATION_ID =
  HUSH_WAVE_ANIMATION.id;

export const BUILT_IN_HUSH_ANIMATIONS = [
  HUSH_WAVE_ANIMATION,
  HUSH_BARS_ANIMATION,
  HUSH_JUMPING_DOTS_ANIMATION,
  HUSH_SHOOTING_STAR_ANIMATION,
  HUSH_FLOCK_ANIMATION,
  HUSH_FISH_LOOP_ANIMATION,
] as const satisfies readonly HushWorkingAnimation[];

/** Create a registry so hosts/tests can add contracts without mutating a singleton. */
export function createHushAnimationRegistry(
  additionalAnimations: Iterable<HushWorkingAnimation> = [],
): HushAnimationRegistry {
  return new HushAnimationRegistry([
    ...BUILT_IN_HUSH_ANIMATIONS,
    ...additionalAnimations,
  ]);
}
