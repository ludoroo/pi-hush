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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isHushAnimationWidth(value: unknown): value is HushAnimationWidth {
  if (typeof value === "number") return isPositiveSafeInteger(value);
  if (!isRecord(value)) return false;
  if (
    typeof value.ratio !== "number" ||
    !Number.isFinite(value.ratio) ||
    value.ratio <= 0 ||
    value.ratio > 1
  ) {
    return false;
  }
  if (
    value.minColumns !== undefined &&
    !isPositiveSafeInteger(value.minColumns)
  ) {
    return false;
  }
  if (
    value.maxColumns !== undefined &&
    !isPositiveSafeInteger(value.maxColumns)
  ) {
    return false;
  }
  return !(
    typeof value.minColumns === "number" &&
    typeof value.maxColumns === "number" &&
    value.minColumns > value.maxColumns
  );
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

/** Strict parser used before updates so corrupt or newer files are never replaced. */
export function parseHushAnimationSettings(
  content: string,
): HushAnimationSettings {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed Hush animation settings JSON: ${reason}`);
  }

  if (!isRecord(value)) {
    throw new Error("Malformed Hush animation settings: expected an object");
  }
  if (
    typeof value.version === "number" &&
    value.version > HUSH_ANIMATION_SETTINGS_VERSION
  ) {
    throw new Error(
      `Hush animation settings use newer version ${value.version}`,
    );
  }
  if (value.version !== HUSH_ANIMATION_SETTINGS_VERSION) {
    throw new Error("Unsupported Hush animation settings version");
  }
  if (!isRecord(value.animations)) {
    throw new Error(
      "Malformed Hush animation settings: animations must be an object",
    );
  }

  for (const [animationId, setting] of Object.entries(value.animations)) {
    if (!isRecord(setting)) {
      throw new Error(
        `Malformed Hush animation settings for ${animationId}: expected an object`,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(setting, "width") &&
      !isHushAnimationWidth(setting.width)
    ) {
      throw new Error(`Malformed Hush animation width for ${animationId}`);
    }
  }

  return value as HushAnimationSettings;
}

export function serializeHushAnimationSettings(
  settings: HushAnimationSettings,
): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
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
