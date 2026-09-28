import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "smol-toml";
import {
  DEFAULT_HUSH_ACTIVITY_POSITION,
  DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED,
  type HushActivityPosition,
} from "./activity.ts";
import {
  createHushAnimationSettings,
  parseHushWidthArgument,
  updateHushAnimationWidthOverride,
  type HushAnimationSettings,
} from "./animation-settings.ts";
import {
  HUSH_ANIMATION_ID_PATTERN,
  type HushAnimationWidth,
} from "./animation.ts";
import { DEFAULT_HUSH_ANIMATION_ID } from "./animations.ts";
import { parseHiddenInputPrefixes } from "./operational-input.ts";
import { updateTomlValues } from "./toml-edit.ts";
import {
  DEFAULT_HUSH_PREFERENCE,
  type HushPreference,
} from "./visibility.ts";

const HUSH_CONFIG_VERSION = 1;

export type HushConfig = {
  preference: HushPreference;
  animationId: string;
  activityTextEnabled: boolean;
  activityTextPosition: HushActivityPosition;
  hiddenInputPrefixes: readonly string[];
  animationSettings: HushAnimationSettings;
};

export type HushConfigPatch = {
  enabled?: boolean;
  thinking?: boolean;
  animation?: string;
  activity?: {
    enabled?: boolean;
    position?: "left" | "right";
  };
  /** An undefined value authors `auto`; it does not delete unrelated settings. */
  width?: {
    animationId: string;
    value: HushAnimationWidth | undefined;
  };
};

type StoreOptions = {
  path: string;
};

type CurrentConfig = {
  config: HushConfig;
  source?: string;
  writePath?: string;
};

type TomlUpdate = {
  path: readonly string[];
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultConfig(): HushConfig {
  return {
    preference: { ...DEFAULT_HUSH_PREFERENCE },
    animationId: DEFAULT_HUSH_ANIMATION_ID,
    activityTextEnabled: DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED,
    activityTextPosition: DEFAULT_HUSH_ACTIVITY_POSITION,
    hiddenInputPrefixes: [],
    animationSettings: createHushAnimationSettings(),
  };
}

function requireBoolean(
  table: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = table[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`Malformed Hush config: ${key} must be a boolean`);
  }
  return value;
}

function requireAnimationId(value: unknown, field: string): string {
  if (typeof value !== "string" || !HUSH_ANIMATION_ID_PATTERN.test(value)) {
    throw new Error(
      `Malformed Hush config: ${field} must be a valid animation id`,
    );
  }
  return value;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function normalizeWidth(
  value: unknown,
  animationId: string,
): HushAnimationWidth | undefined {
  if (typeof value === "number") {
    if (positiveInteger(value)) return value;
    throw new Error(`Malformed Hush animation width for ${animationId}`);
  }
  if (typeof value === "string") {
    if (value === "auto") return undefined;
    const parsed = parseHushWidthArgument(value);
    if (parsed !== undefined && parsed !== "auto") return parsed;
    throw new Error(`Malformed Hush animation width for ${animationId}`);
  }
  if (!isRecord(value)) {
    throw new Error(`Malformed Hush animation width for ${animationId}`);
  }

  // Validate known fields while retaining untouched metadata in the document.
  const ratio = value.ratio;
  if (
    typeof ratio !== "number" ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    ratio > 1
  ) {
    throw new Error(`Malformed Hush animation width for ${animationId}`);
  }
  if (value.minColumns !== undefined && !positiveInteger(value.minColumns)) {
    throw new Error(`Malformed Hush animation width for ${animationId}`);
  }
  if (value.maxColumns !== undefined && !positiveInteger(value.maxColumns)) {
    throw new Error(`Malformed Hush animation width for ${animationId}`);
  }
  if (
    typeof value.minColumns === "number" &&
    typeof value.maxColumns === "number" &&
    value.minColumns > value.maxColumns
  ) {
    throw new Error(`Malformed Hush animation width for ${animationId}`);
  }
  return {
    ratio,
    ...(value.minColumns === undefined
      ? {}
      : { minColumns: value.minColumns as number }),
    ...(value.maxColumns === undefined
      ? {}
      : { maxColumns: value.maxColumns as number }),
  };
}

function parseCurrentConfig(source: string): HushConfig {
  let document: Record<string, unknown>;
  try {
    // Read the same TOML dialect the surgical editor can safely update.
    updateTomlValues(source, []);
    const parsed = parse(source, { integersAsBigInt: "asNeeded" });
    if (!isRecord(parsed)) throw new Error("expected a TOML table");
    document = parsed;
  } catch (error) {
    throw new Error(`Malformed Hush config TOML: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  const version = document.version ?? HUSH_CONFIG_VERSION;
  if (version !== HUSH_CONFIG_VERSION) {
    if (
      (typeof version === "number" || typeof version === "bigint") &&
      version > HUSH_CONFIG_VERSION
    ) {
      throw new Error(`Hush config uses newer version ${String(version)}`);
    }
    throw new Error(`Unsupported Hush config version ${String(version)}`);
  }

  const enabled = requireBoolean(
    document,
    "enabled",
    DEFAULT_HUSH_PREFERENCE.active,
  );
  const thinking = requireBoolean(
    document,
    "thinking",
    DEFAULT_HUSH_PREFERENCE.thinking,
  );
  const animationId = document.animation === undefined
    ? DEFAULT_HUSH_ANIMATION_ID
    : requireAnimationId(document.animation, "animation");

  const activity = document.activity;
  if (activity !== undefined && !isRecord(activity)) {
    throw new Error("Malformed Hush config: activity must be a table");
  }
  const activityTable = activity ?? {};
  const activityTextEnabled = requireBoolean(
    activityTable,
    "enabled",
    DEFAULT_HUSH_ACTIVITY_TEXT_ENABLED,
  );
  const positionValue = activityTable.position;
  if (
    positionValue !== undefined &&
    positionValue !== "left" &&
    positionValue !== "right"
  ) {
    throw new Error(
      "Malformed Hush config: activity.position must be left or right",
    );
  }
  const activityTextPosition =
    (positionValue as HushActivityPosition | undefined) ??
    DEFAULT_HUSH_ACTIVITY_POSITION;

  const transcript = document.transcript;
  if (transcript !== undefined && !isRecord(transcript)) {
    throw new Error("Malformed Hush config: transcript must be a table");
  }
  const prefixValue = (transcript ?? {}).hidden_input_prefixes;
  let hiddenInputPrefixes: readonly string[] = [];
  if (prefixValue !== undefined) {
    try {
      hiddenInputPrefixes = parseHiddenInputPrefixes(prefixValue);
    } catch (error) {
      throw new Error(
        `Malformed Hush config hidden_input_prefixes: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  const animationsValue = document.animations;
  if (animationsValue !== undefined && !isRecord(animationsValue)) {
    throw new Error("Malformed Hush config: animations must be a table");
  }
  const animations: HushAnimationSettings["animations"] = {};
  for (const [animationName, value] of Object.entries(animationsValue ?? {})) {
    const validId = requireAnimationId(
      animationName,
      `animations.${animationName}`,
    );
    if (!isRecord(value)) {
      throw new Error(
        `Malformed Hush animation settings for ${validId}: expected a table`,
      );
    }
    const setting = { ...value };
    if (Object.prototype.hasOwnProperty.call(setting, "width")) {
      const width = normalizeWidth(setting.width, validId);
      if (width === undefined) delete setting.width;
      else setting.width = width;
    }
    animations[validId] = setting;
  }

  return {
    preference: { active: enabled, thinking },
    animationId,
    activityTextEnabled,
    activityTextPosition,
    hiddenInputPrefixes,
    animationSettings: {
      version: 1,
      animations,
    },
  };
}

function widthEqual(
  left: HushAnimationWidth | undefined,
  right: HushAnimationWidth | undefined,
): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object") return false;
  return (
    left.ratio === right.ratio &&
    left.minColumns === right.minColumns &&
    left.maxColumns === right.maxColumns
  );
}

function configDocument(config: HushConfig): Record<string, unknown> {
  return {
    version: HUSH_CONFIG_VERSION,
    enabled: config.preference.active,
    thinking: config.preference.thinking,
    animation: config.animationId,
    activity: {
      enabled: config.activityTextEnabled,
      position: config.activityTextPosition,
    },
    transcript: { hidden_input_prefixes: [...config.hiddenInputPrefixes] },
    animations: config.animationSettings.animations,
  };
}

/** Optional TOML configuration: missing files use defaults, changes save here. */
export class HushConfigStore {
  readonly #path: string;

  constructor(options: StoreOptions) {
    this.#path = options.path;
  }

  /** Best-effort startup read; invalid files are never repaired or overwritten. */
  load(): { config: HushConfig; warning?: string } {
    try {
      return { config: this.#readCurrent().config };
    } catch (error) {
      return {
        config: defaultConfig(),
        warning: `Could not load Hush config (${this.#path}); using defaults without modifying the file. ${errorMessage(error)}`,
      };
    }
  }

  /** Strict current read. Missing configuration uses defaults without writing. */
  read(): HushConfig {
    return this.#readCurrent().config;
  }

  /** Strict reload, field-level merge, and atomic persistence. */
  update(patch: HushConfigPatch): HushConfig {
    const current = this.#readCurrent();
    let config = current.config;
    const updates: TomlUpdate[] = [];

    if (
      patch.enabled !== undefined &&
      patch.enabled !== config.preference.active
    ) {
      if (typeof patch.enabled !== "boolean") {
        throw new TypeError("Hush enabled setting must be a boolean");
      }
      config = {
        ...config,
        preference: { ...config.preference, active: patch.enabled },
      };
      updates.push({ path: ["enabled"], value: patch.enabled });
    }
    if (
      patch.thinking !== undefined &&
      patch.thinking !== config.preference.thinking
    ) {
      if (typeof patch.thinking !== "boolean") {
        throw new TypeError("Hush thinking setting must be a boolean");
      }
      config = {
        ...config,
        preference: { ...config.preference, thinking: patch.thinking },
      };
      updates.push({ path: ["thinking"], value: patch.thinking });
    }
    if (patch.animation !== undefined && patch.animation !== config.animationId) {
      requireAnimationId(patch.animation, "animation");
      config = { ...config, animationId: patch.animation };
      updates.push({ path: ["animation"], value: patch.animation });
    }
    if (
      patch.activity?.enabled !== undefined &&
      patch.activity.enabled !== config.activityTextEnabled
    ) {
      if (typeof patch.activity.enabled !== "boolean") {
        throw new TypeError("Hush activity enabled setting must be a boolean");
      }
      config = { ...config, activityTextEnabled: patch.activity.enabled };
      updates.push({
        path: ["activity", "enabled"],
        value: patch.activity.enabled,
      });
    }
    if (
      patch.activity?.position !== undefined &&
      patch.activity.position !== config.activityTextPosition
    ) {
      if (
        patch.activity.position !== "left" &&
        patch.activity.position !== "right"
      ) {
        throw new TypeError("Hush activity position must be left or right");
      }
      config = { ...config, activityTextPosition: patch.activity.position };
      updates.push({
        path: ["activity", "position"],
        value: patch.activity.position,
      });
    }
    if (patch.width !== undefined) {
      const animationId = requireAnimationId(
        patch.width.animationId,
        "width.animationId",
      );
      const value = patch.width.value === undefined
        ? undefined
        : normalizeWidth(patch.width.value, animationId);
      const previous = config.animationSettings.animations[animationId]?.width;
      if (!widthEqual(previous, value)) {
        config = {
          ...config,
          animationSettings: updateHushAnimationWidthOverride(
            config.animationSettings,
            animationId,
            value,
          ),
        };
        updates.push({
          path: ["animations", animationId, "width"],
          value: value ?? "auto",
        });
      }
    }

    if (updates.length === 0) return config;
    const source = current.source === undefined
      ? stringify(configDocument(config))
      : updateTomlValues(current.source, updates);
    const updatedConfig = parseCurrentConfig(source);
    this.#writeAtomic(source, current.writePath ?? this.#path);
    return updatedConfig;
  }

  #readCurrent(): CurrentConfig {
    try {
      lstatSync(this.#path);
    } catch (error) {
      if (isMissingFile(error)) return { config: defaultConfig() };
      throw error;
    }
    // A dangling symlink is an unreadable existing config, not a missing file.
    // Valid symlinks keep their identity while their targets update atomically.
    const source = readFileSync(this.#path, "utf8");
    return {
      source,
      config: parseCurrentConfig(source),
      writePath: realpathSync(this.#path),
    };
  }

  #writeAtomic(source: string, path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, source, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}
