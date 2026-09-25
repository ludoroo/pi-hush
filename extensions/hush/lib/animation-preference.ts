import {
  HUSH_ANIMATION_ID_PATTERN,
  type HushWorkingAnimationRegistry,
} from "./working-animation.ts";

/** Parse one stable animation id without coupling persistence to built-ins. */
export function parseHushAnimationPreference(
  text: string,
): string | undefined {
  const id = text.trim().toLowerCase();
  return HUSH_ANIMATION_ID_PATTERN.test(id) ? id : undefined;
}

/** Resolve malformed and no-longer-registered ids to the caller's default. */
export function resolveHushAnimationPreference(
  text: string,
  registry: HushWorkingAnimationRegistry,
  defaultId: string,
): string {
  const id = parseHushAnimationPreference(text);
  return id && registry.get(id) ? id : defaultId;
}

export function serializeHushAnimationPreference(id: string): string {
  if (!HUSH_ANIMATION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid Hush animation id: ${id}`);
  }
  return `${id}\n`;
}
