import type { HushAnimationRegistry } from "./animation.ts";

/** Resolve no-longer-registered ids to the caller's default. */
export function resolveHushAnimationPreference(
  id: string,
  registry: HushAnimationRegistry,
  defaultId: string,
): string {
  return registry.get(id) ? id : defaultId;
}
