import type {
  ExtensionUIContext,
  Theme,
  WidgetPlacement,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { sanitizeHushActivityText } from "./activity.ts";

export const HUSH_ANIMATION_WIDGET_KEY = "pi-hush:animation";
export const HUSH_ANIMATION_DISCOVERY_EVENT = "pi-hush:discover-animations";
export const HUSH_ANIMATION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const HUSH_ANIMATION_MAX_HEIGHT = 10;
/** Playback never consumes more than three terminal rows, even for taller assets. */
export const HUSH_ANIMATION_ROW_BUDGET = 3;
/** Align Hush output with Pi's conversation text using a compact inset. */
export const HUSH_LOADER_INDENT = 1;
const HUSH_ACTIVITY_RESERVE_WIDTH = 24;

export type HushAnimationPalette = {
  /** Pi's primary accent token. */
  readonly accent: (text: string) => string;
  /** Theme-authored complementary colour, mapped from syntaxVariable. */
  readonly secondary: (text: string) => string;
  /** Theme-authored complementary colour, mapped from syntaxFunction. */
  readonly tertiary: (text: string) => string;
  /** Sparse peak highlight, mapped from warning. */
  readonly highlight: (text: string) => string;
  readonly muted: (text: string) => string;
};

export type HushAnimationWidth =
  | number
  | {
      /** Fraction of the available viewport, from greater than 0 through 1. */
      readonly ratio: number;
      readonly minColumns?: number;
      readonly maxColumns?: number;
    };

export type HushAnimationFrameContext = {
  /** Zero-based frame number. */
  readonly frame: number;
  /** Resolved content width after proportional sizing and bounds. */
  readonly width: number;
  /** Complete widget width. */
  readonly viewportWidth: number;
};

/** Host-supplied render area and playback position; resizes never reset time. */
export type HushAnimationRenderContext = HushAnimationFrameContext & {
  /** Allocated rows, bounded by the terminal budget and the animation's maxHeight. */
  readonly height: number;
  /** Active playback time sampled on timer ticks, excluding unmounted time. */
  readonly elapsedMs: number;
};

export type HushAnimationColor = keyof HushAnimationPalette;

export type HushAnimationFrameSegment = {
  readonly text: string;
  /** Defaults to accent. */
  readonly color?: HushAnimationColor;
};

export type HushAnimationRow =
  | HushAnimationFrameSegment
  | {
      /** Segments allow multiple theme colours within one row. */
      readonly segments: readonly HushAnimationFrameSegment[];
    };

/** Existing single-row frames remain valid shorthand. Empty rows retain position. */
export type HushAnimationFrame =
  | HushAnimationRow
  | { readonly rows: readonly HushAnimationRow[] };

type HushAnimationBase = {
  /** Stable preference and command identifier. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly intervalMs: number;
  /** Fixed columns, or a viewport ratio with optional column bounds. */
  readonly width: HushAnimationWidth;
  /** Preferred canvas height; playback clamps this to the host's strict row budget. */
  readonly maxHeight: number;
  /** Below this allocated width, request a single-row rendition instead. */
  readonly minWidthForMultiRow?: number;
  readonly placement?: WidgetPlacement;
};

/** Simple theme-like animation: Hush owns frame selection and colour painting. */
export type HushFrameAnimation = HushAnimationBase & {
  readonly kind: "frames";
  readonly frames: readonly HushAnimationFrame[];
  readonly renderFrame?: never;
};

/** Advanced animation that computes the same semantic frame object at runtime. */
export type HushProceduralAnimation = HushAnimationBase & {
  readonly kind?: "procedural";
  readonly frames?: never;
  renderFrame(context: HushAnimationRenderContext): HushAnimationFrame;
};

/** A temporary working animation rendered through Pi's widget API. */
export type HushWorkingAnimation =
  | HushFrameAnimation
  | HushProceduralAnimation;

/** Synchronous discovery request shared with other Pi extensions. */
export type HushAnimationDiscovery = {
  readonly apiVersion: 1;
  register(animation: HushWorkingAnimation): void;
};

/** Preserve literal fields while checking that an animation implements the contract. */
export function defineHushWorkingAnimation<T extends HushWorkingAnimation>(
  animation: T,
): T {
  return animation;
}

/** Registry boundary: adding an animation does not require changing the host. */
export class HushAnimationRegistry {
  readonly #animations = new Map<string, HushWorkingAnimation>();

  constructor(animations: Iterable<HushWorkingAnimation> = []) {
    for (const animation of animations) this.register(animation);
  }

  register(animation: HushWorkingAnimation): void {
    if (
      typeof animation.id !== "string" ||
      !HUSH_ANIMATION_ID_PATTERN.test(animation.id)
    ) {
      throw new Error(`Invalid Hush animation id: ${animation.id}`);
    }
    if (
      typeof animation.label !== "string" ||
      animation.label.trim() === "" ||
      typeof animation.description !== "string" ||
      animation.description.trim() === ""
    ) {
      throw new Error(`Invalid Hush animation contract: ${animation.id}`);
    }
    validateHushAnimationRenderer(animation);
    if (this.#animations.has(animation.id)) {
      throw new Error(`Duplicate Hush animation id: ${animation.id}`);
    }
    if (!Number.isFinite(animation.intervalMs) || animation.intervalMs <= 0) {
      throw new Error(`Invalid interval for Hush animation: ${animation.id}`);
    }
    validateHushAnimationWidth(animation.width, animation.id);
    if (!positiveColumns(animation.minWidthForMultiRow)) {
      throw new Error(`Invalid multi-row minimum width: ${animation.id}`);
    }
    if (
      !Number.isInteger(animation.maxHeight) ||
      animation.maxHeight <= 0 ||
      animation.maxHeight > HUSH_ANIMATION_MAX_HEIGHT
    ) {
      throw new Error(`Invalid height for Hush animation: ${animation.id}`);
    }
    this.#animations.set(animation.id, animation);
  }

  /** Replace registry contents while preserving the host's registry reference. */
  reset(animations: Iterable<HushWorkingAnimation>): void {
    this.#animations.clear();
    for (const animation of animations) this.register(animation);
  }

  get(id: string): HushWorkingAnimation | undefined {
    return this.#animations.get(id);
  }

  list(): HushWorkingAnimation[] {
    return [...this.#animations.values()];
  }
}

const HUSH_ANIMATION_COLORS = new Set<HushAnimationColor>([
  "accent",
  "secondary",
  "tertiary",
  "highlight",
  "muted",
]);

function validFrameSegment(value: unknown): value is HushAnimationFrameSegment {
  if (!value || typeof value !== "object") return false;
  const segment = value as Partial<HushAnimationFrameSegment>;
  return (
    typeof segment.text === "string" &&
    // Frames are semantic text, never terminal commands or styled ANSI strings.
    !/[\u0000-\u001f\u007f-\u009f\u061c\u2028-\u202e\u2066-\u2069]/.test(segment.text) &&
    (segment.color === undefined || HUSH_ANIMATION_COLORS.has(segment.color))
  );
}

function validHushAnimationRow(value: unknown): value is HushAnimationRow {
  if (!value || typeof value !== "object" || "rows" in value) return false;
  if (!("segments" in value)) return validFrameSegment(value);
  return Array.isArray(value.segments) && value.segments.every(validFrameSegment);
}

function validHushAnimationFrame(
  value: unknown,
  maxHeight: number,
): value is HushAnimationFrame {
  if (!value || typeof value !== "object") return false;
  if (!("rows" in value)) return validHushAnimationRow(value);
  return (
    Array.isArray(value.rows) &&
    value.rows.length > 0 &&
    value.rows.length <= maxHeight &&
    value.rows.every(validHushAnimationRow)
  );
}

function validateHushAnimationRenderer(animation: HushWorkingAnimation): void {
  const animationId = animation.id;
  if (animation.kind === "frames") {
    if (
      typeof animation.renderFrame === "function" ||
      !Array.isArray(animation.frames) ||
      animation.frames.length === 0 ||
      !animation.frames.every((frame) =>
        validHushAnimationFrame(frame, animation.maxHeight),
      )
    ) {
      throw new Error(`Invalid frames for Hush animation: ${animationId}`);
    }
    return;
  }
  if (animation.kind !== undefined && animation.kind !== "procedural") {
    throw new Error(`Invalid Hush animation kind: ${animationId}`);
  }
  if (typeof animation.renderFrame !== "function") {
    throw new Error(`Invalid Hush animation renderer: ${animationId}`);
  }
}

function positiveColumns(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value > 0);
}

function validateHushAnimationWidth(
  width: HushAnimationWidth,
  animationId: string,
): void {
  if (typeof width === "number") {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`Invalid width for Hush animation: ${animationId}`);
    }
    return;
  }
  if (
    !width ||
    !Number.isFinite(width.ratio) ||
    width.ratio <= 0 ||
    width.ratio > 1 ||
    !positiveColumns(width.minColumns) ||
    !positiveColumns(width.maxColumns) ||
    (width.minColumns !== undefined &&
      width.maxColumns !== undefined &&
      width.minColumns > width.maxColumns)
  ) {
    throw new Error(`Invalid width for Hush animation: ${animationId}`);
  }
}

/** Resolve a fixed or proportional width against the available columns. */
export function resolveHushAnimationWidth(
  width: HushAnimationWidth,
  availableColumns: number,
): number {
  const available = Math.max(0, Math.floor(availableColumns));
  if (available === 0) return 0;
  if (typeof width === "number") return Math.min(width, available);
  let resolved = Math.max(1, Math.floor(available * width.ratio));
  if (width.minColumns !== undefined) {
    resolved = Math.max(resolved, width.minColumns);
  }
  if (width.maxColumns !== undefined) {
    resolved = Math.min(resolved, width.maxColumns);
  }
  return Math.min(resolved, available);
}

/** Budget at most 1/8 of terminal rows (at least one), capped at three. */
export function resolveHushAnimationHeight(
  animation: Pick<HushWorkingAnimation, "maxHeight" | "minWidthForMultiRow">,
  availableWidth: number,
  terminalRows: number,
): number {
  if (availableWidth <= 0) return 1;
  if (availableWidth < (animation.minWidthForMultiRow ?? 1)) return 1;
  const rows = Number.isFinite(terminalRows) ? terminalRows : 0;
  const budget = Math.max(1, Math.floor(rows / 8));
  return Math.min(animation.maxHeight, HUSH_ANIMATION_ROW_BUDGET, budget);
}

/** Select or compute one semantic frame, then paint it with the active theme. */
export function renderHushAnimation(
  animation: HushWorkingAnimation,
  context: HushAnimationFrameContext & Partial<Pick<HushAnimationRenderContext, "height" | "elapsedMs">>,
  palette: HushAnimationPalette,
): readonly string[] {
  // Legacy callers can still provide the original frame/width/viewport context.
  const renderContext: HushAnimationRenderContext = {
    ...context,
    height: context.height ?? Math.min(animation.maxHeight, HUSH_ANIMATION_ROW_BUDGET),
    elapsedMs: context.elapsedMs ?? context.frame * animation.intervalMs,
  };
  const frame: unknown =
    animation.kind === "frames"
      ? animation.frames[context.frame % animation.frames.length]
      : animation.renderFrame(renderContext);
  if (!validHushAnimationFrame(frame, animation.maxHeight)) {
    throw new Error(
      "renderFrame must return a frame containing valid rows, text and colour roles",
    );
  }
  const rows = "rows" in frame ? frame.rows : [frame];
  return rows.map((row) => {
    const segments = "segments" in row ? row.segments : [row];
    return segments.map(({ text, color = "accent" }) => palette[color](text)).join("");
  });
}

/** Pad to the allocated canvas so frame content cannot change widget height. */
export function normalizeHushWidgetFrame(
  lines: readonly string[],
  width: number,
  height: number,
): string[] {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  return Array.from({ length: safeHeight }, (_, row) => {
    const line = truncateToWidth(lines[row] ?? "", safeWidth, "");
    return line + " ".repeat(Math.max(0, safeWidth - visibleWidth(line)));
  });
}

/** Compose one non-wrapping row, giving activity text a bounded priority. */
export function composeHushWorkingLine(options: {
  animationLine: string;
  animationWidth: number;
  viewportWidth: number;
  activityText?: string;
  styleActivity?: (text: string) => string;
}): string {
  const viewportWidth = Math.max(0, Math.floor(options.viewportWidth));
  if (viewportWidth === 0) return "";
  const animationWidth = Math.min(
    Math.max(0, Math.floor(options.animationWidth)),
    viewportWidth,
  );
  const animationLine = truncateToWidth(
    options.animationLine,
    animationWidth,
    "",
  );
  const activityText = sanitizeHushActivityText(options.activityText ?? "");
  if (!activityText) return animationLine;

  const gapWidth = animationWidth > 0 ? 1 : 0;
  const activityWidth = Math.min(
    HUSH_ACTIVITY_RESERVE_WIDTH - gapWidth,
    viewportWidth - animationWidth - gapWidth,
  );
  if (activityWidth <= 0) return animationLine;
  const animationPadding = " ".repeat(
    Math.max(0, animationWidth - visibleWidth(animationLine)),
  );
  const activity = truncateToWidth(
    activityText,
    activityWidth,
    "…",
  ).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  if (visibleWidth(activity) === 0) return animationLine;
  const styledActivity = (options.styleActivity ?? ((text) => text))(activity);
  const gap = gapWidth === 0 ? "" : " ";
  return `${animationLine}${animationPadding}${gap}${styledActivity}`;
}

function animationPalette(theme: Theme): HushAnimationPalette {
  return {
    accent: (text) => theme.fg("accent", text),
    secondary: (text) => theme.fg("syntaxVariable", text),
    tertiary: (text) => theme.fg("syntaxFunction", text),
    highlight: (text) => theme.fg("warning", text),
    muted: (text) => theme.fg("muted", text),
  };
}

type HushWidgetAnimationState = {
  frame: number;
  lastRenderedFrame: number;
  elapsedMs: number;
  lastRenderedElapsedMs: number;
};

class HushAnimationWidget implements Component {
  readonly #tui: TUI;
  readonly #theme: Theme;
  readonly #animation: HushWorkingAnimation;
  readonly #state: HushWidgetAnimationState;
  readonly #onRenderError: (error: unknown) => void;
  #activityText: string | undefined;
  #activityTextEnabled: boolean;
  #disposed = false;
  #renderErrorReported = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  get disposed(): boolean {
    return this.#disposed;
  }

  constructor(
    tui: TUI,
    theme: Theme,
    animation: HushWorkingAnimation,
    state: HushWidgetAnimationState,
    activityTextEnabled: boolean,
    activityText: string | undefined,
    onRenderError: (error: unknown) => void,
  ) {
    this.#tui = tui;
    this.#theme = theme;
    this.#animation = animation;
    this.#state = state;
    this.#activityTextEnabled = activityTextEnabled;
    this.#activityText = activityText;
    this.#onRenderError = onRenderError;
    const startedAt = performance.now();
    const resumedElapsedMs = this.#state.elapsedMs;
    this.#timer = setInterval(() => {
      if (this.#disposed) return;
      this.#state.elapsedMs = resumedElapsedMs + Math.max(0, performance.now() - startedAt);
      this.#state.frame = Math.floor(this.#state.elapsedMs / this.#animation.intervalMs);
      this.#tui.requestRender();
    }, this.#animation.intervalMs);
    this.#timer.unref?.();
  }

  render(width: number): string[] {
    if (this.#disposed) return [];
    try {
      const viewportWidth = Math.max(0, Math.floor(width));
      if (viewportWidth === 0) return [];
      const indent = Math.min(
        HUSH_LOADER_INDENT,
        Math.max(0, viewportWidth - 1),
      );
      const lineWidth = viewportWidth - indent;
      const prefix = " ".repeat(indent);
      const activityReserve = this.#activityTextEnabled
        ? Math.min(HUSH_ACTIVITY_RESERVE_WIDTH, lineWidth)
        : 0;
      const contentWidth = resolveHushAnimationWidth(
        this.#animation.width,
        lineWidth - activityReserve,
      );
      if (contentWidth === 0) {
        if (!this.#activityTextEnabled) return [];
        this.#state.lastRenderedFrame = this.#state.frame;
        this.#state.lastRenderedElapsedMs = this.#state.elapsedMs;
        return [
          prefix +
            composeHushWorkingLine({
              animationLine: "",
              animationWidth: 0,
              viewportWidth: lineWidth,
              activityText: this.#activityText,
              styleActivity: (text) => this.#theme.fg("muted", text),
            }),
        ];
      }
      const contentHeight = resolveHushAnimationHeight(
        this.#animation,
        contentWidth,
        this.#tui.terminal.rows,
      );
      const lines = renderHushAnimation(
        this.#animation,
        {
          frame: this.#state.frame,
          elapsedMs: this.#state.elapsedMs,
          width: contentWidth,
          height: contentHeight,
          viewportWidth,
        },
        animationPalette(this.#theme),
      );
      if (
        !Array.isArray(lines) ||
        !lines.every(
          (line) => typeof line === "string" && !/[\0\r\n]/.test(line),
        )
      ) {
        throw new Error(
          "renderFrame must return an array of single-line strings",
        );
      }
      this.#state.lastRenderedFrame = this.#state.frame;
      this.#state.lastRenderedElapsedMs = this.#state.elapsedMs;
      const normalized = normalizeHushWidgetFrame(
        lines,
        contentWidth,
        contentHeight,
      );
      return normalized.map(
        (line, index) =>
          prefix +
          composeHushWorkingLine({
            animationLine: line,
            animationWidth: contentWidth,
            viewportWidth: lineWidth,
            activityText: index === Math.floor(contentHeight / 2)
              ? this.#activityText
              : undefined,
            styleActivity: (text) => this.#theme.fg("muted", text),
          }),
      );
    } catch (error) {
      if (!this.#renderErrorReported) {
        this.#renderErrorReported = true;
        this.dispose();
        queueMicrotask(() => this.#onRenderError(error));
      }
      return [];
    }
  }

  setActivityText(text: string | undefined, enabled: boolean): void {
    if (this.#activityText === text && this.#activityTextEnabled === enabled) return;
    this.#activityText = text;
    this.#activityTextEnabled = enabled;
    this.#tui.requestRender();
  }

  invalidate(): void {
    // Theme is read for every frame, so there is no themed render cache to clear.
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#state.frame = this.#state.lastRenderedFrame;
    this.#state.elapsedMs = this.#state.lastRenderedElapsedMs;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

/** Owns the temporary widget and animation lifecycle. */
export class HushAnimationHost {
  readonly #registry: HushAnimationRegistry;
  readonly #defaultAnimationId: string;
  #animationId: string;
  #enabled = false;
  #working = false;
  #widgetsEnabled = true;
  #activityTextEnabled = false;
  #activityText: string | undefined;
  #ui: ExtensionUIContext | undefined;
  #widget: HushAnimationWidget | undefined;
  readonly #widgetStates = new Map<string, HushWidgetAnimationState>();
  readonly #failedAnimationIds = new Set<string>();

  constructor(
    registry: HushAnimationRegistry,
    defaultAnimationId: string,
  ) {
    if (!registry.get(defaultAnimationId)) {
      throw new Error(`Unknown default Hush animation: ${defaultAnimationId}`);
    }
    this.#registry = registry;
    this.#defaultAnimationId = defaultAnimationId;
    this.#animationId = defaultAnimationId;
  }

  get animationId(): string {
    return this.#animationId;
  }

  /** Allow repaired drop-ins to be retried after an explicit rescan. */
  retryFailedAnimations(): void {
    this.#failedAnimationIds.clear();
  }

  apply(
    ui: ExtensionUIContext,
    options: {
      enabled: boolean;
      animationId: string;
      widgetsEnabled?: boolean;
      activityTextEnabled?: boolean;
    },
  ): void {
    const animationId = this.#registry.get(options.animationId)
      ? options.animationId
      : this.#defaultAnimationId;
    const widgetsEnabled = options.widgetsEnabled ?? true;
    const activityTextEnabled = options.activityTextEnabled ?? false;
    const basePresentationUnchanged =
      this.#ui === ui &&
      this.#enabled === options.enabled &&
      this.#animationId === animationId &&
      this.#widgetsEnabled === widgetsEnabled;
    if (basePresentationUnchanged) {
      if (this.#activityTextEnabled === activityTextEnabled) return;
      this.#activityTextEnabled = activityTextEnabled;
      this.#widget?.setActivityText(
        activityTextEnabled ? this.#activityText : undefined,
        activityTextEnabled,
      );
      return;
    }

    this.#ui = ui;
    this.#enabled = options.enabled;
    this.#widgetsEnabled = widgetsEnabled;
    this.#activityTextEnabled = activityTextEnabled;
    this.#animationId = animationId;
    this.#renderPresentation();
  }

  setWorking(working: boolean): void {
    if (this.#working === working) return;
    this.#working = working;
    const ui = this.#ui;
    const animation = this.#resolveRenderableAnimation();
    if (ui && this.#enabled && this.#widgetsEnabled && animation) {
      this.#syncWidget(ui, animation);
    }
  }

  setActivityText(text: string | undefined): void {
    this.#activityText = text;
    this.#widget?.setActivityText(
      this.#activityTextEnabled ? this.#activityText : undefined,
      this.#activityTextEnabled,
    );
  }

  dispose(options: { restorePi?: boolean } = {}): void {
    this.#clearWidget();
    if (options.restorePi && this.#ui) this.#restorePiWorkingPresentation();
    this.#enabled = false;
    this.#working = false;
    this.#ui = undefined;
  }

  #renderPresentation(): void {
    const ui = this.#ui;
    if (!ui) return;

    this.#clearWidget();

    if (!this.#enabled || !this.#widgetsEnabled) {
      this.#restorePiWorkingPresentation();
      return;
    }

    const animation = this.#resolveRenderableAnimation();
    if (animation) {
      this.#syncWidget(ui, animation);
    } else {
      this.#restorePiWorkingPresentation();
    }
  }

  #resolveRenderableAnimation(): HushWorkingAnimation | undefined {
    const selected = this.#registry.get(this.#animationId);
    if (selected && !this.#failedAnimationIds.has(selected.id)) return selected;
    const fallback = this.#registry.get(this.#defaultAnimationId);
    return fallback && !this.#failedAnimationIds.has(fallback.id)
      ? fallback
      : undefined;
  }

  #syncWidget(
    ui: ExtensionUIContext,
    animation: HushWorkingAnimation,
  ): void {
    if (!this.#working) {
      this.#clearWidget();
      ui.setWorkingVisible(true);
      return;
    }
    if (this.#widget && !this.#widget.disposed) return;
    this.#widget = undefined;

    const state = this.#widgetStates.get(animation.id) ?? {
      frame: 0,
      lastRenderedFrame: 0,
      elapsedMs: 0,
      lastRenderedElapsedMs: 0,
    };
    this.#widgetStates.set(animation.id, state);
    ui.setWorkingVisible(false);
    ui.setWidget(
      HUSH_ANIMATION_WIDGET_KEY,
      (tui, theme) => {
        const widget = new HushAnimationWidget(
          tui,
          theme,
          animation,
          state,
          this.#activityTextEnabled,
          this.#activityTextEnabled ? this.#activityText : undefined,
          (error) => this.#handleRenderError(animation, error),
        );
        this.#widget = widget;
        return widget;
      },
      { placement: animation.placement ?? "aboveEditor" },
    );
  }

  #handleRenderError(animation: HushWorkingAnimation, error: unknown): void {
    if (this.#failedAnimationIds.has(animation.id)) return;
    this.#failedAnimationIds.add(animation.id);
    const reason = error instanceof Error ? error.message : String(error);
    this.#ui?.notify(
      `Hush animation ${animation.id} failed; using fallback. ${reason}`,
      "warning",
    );
    this.#clearWidget();
    const fallback = this.#resolveRenderableAnimation();
    if (this.#ui && this.#working && fallback) {
      this.#syncWidget(this.#ui, fallback);
    } else {
      this.#restorePiWorkingPresentation();
    }
  }

  #clearWidget(): void {
    if (!this.#widget) return;
    this.#ui?.setWidget(HUSH_ANIMATION_WIDGET_KEY, undefined);
    this.#widget = undefined;
  }

  #restorePiWorkingPresentation(): void {
    const ui = this.#ui;
    if (!ui) return;
    ui.setWorkingVisible(true);
  }
}
