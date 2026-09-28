import type { HushAnimationWidth } from "./animation.ts";

export const HUSH_ANIMATION_SETTINGS_VERSION = 1;

export type HushAnimationSetting = {
  width?: HushAnimationWidth;
  [key: string]: unknown;
};

export type HushAnimationSettings = {
  version: 1;
  animations: Record<string, HushAnimationSetting>;
  [key: string]: unknown;
};

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** Parse the value accepted by `/hush width`. Invalid input returns undefined. */
export function parseHushWidthArgument(
  input: string,
): HushAnimationWidth | "auto" | undefined {
  const value = input.trim().toLowerCase();
  if (value === "auto") return "auto";

  if (/^[1-9]\d*$/.test(value) && value.length <= 16) {
    const columns = Number(value);
    return isPositiveSafeInteger(columns) ? columns : undefined;
  }

  if (value.length <= 32 && /^(?:\d+|\d+\.\d+|\.\d+)%$/.test(value)) {
    const percentage = Number(value.slice(0, -1));
    if (
      Number.isFinite(percentage) &&
      percentage > 0 &&
      percentage <= 100
    ) {
      return { ratio: percentage / 100 };
    }
  }
  return undefined;
}

export function createHushAnimationSettings(): HushAnimationSettings {
  return { version: HUSH_ANIMATION_SETTINGS_VERSION, animations: {} };
}

export function getHushAnimationWidthOverride(
  settings: HushAnimationSettings,
  animationId: string,
): HushAnimationWidth | undefined {
  return settings.animations[animationId]?.width;
}

/** Return a copy changing only one animation's width field. */
export function updateHushAnimationWidthOverride(
  settings: HushAnimationSettings,
  animationId: string,
  width: HushAnimationWidth | undefined,
): HushAnimationSettings {
  const current = settings.animations[animationId];
  if (width === undefined && !Object.prototype.hasOwnProperty.call(current ?? {}, "width")) {
    return settings;
  }

  const nextSetting: HushAnimationSetting = { ...(current ?? {}) };
  if (width === undefined) delete nextSetting.width;
  else nextSetting.width = width;

  return {
    ...settings,
    animations: {
      ...settings.animations,
      [animationId]: nextSetting,
    },
  };
}
