import type {
  ExtensionUIContext,
  Theme,
  WidgetPlacement,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

export const HUSH_ANIMATION_WIDGET_KEY = "pi-hush:working-animation";
export const HUSH_ANIMATION_DISCOVERY_EVENT = "pi-hush:discover-animations";
export const HUSH_ANIMATION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const HUSH_ANIMATION_MAX_HEIGHT = 10;
export const HUSH_LOADER_INDENT = 2;

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
  /** Complete widget width before Hush applies its standard indent. */
  readonly viewportWidth: number;
  readonly palette: HushAnimationPalette;
};

/**
 * A temporary working animation rendered through Pi's widget API.
 *
 * Keeping every animation on this single surface lets compact loaders evolve
 * into richer companions without a second lifecycle or rendering contract.
 */
export type HushWorkingAnimation = {
  /** Stable preference and command identifier. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly intervalMs: number;
  /** Fixed columns, or a viewport ratio with optional column bounds. */
  readonly width: HushAnimationWidth;
  /** Maximum active rows; renderFrame may return fewer on narrow terminals. */
  readonly maxHeight: number;
  readonly placement?: WidgetPlacement;
  renderFrame(context: HushAnimationFrameContext): readonly string[];
};

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
export class HushWorkingAnimationRegistry {
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
      animation.description.trim() === "" ||
      typeof animation.renderFrame !== "function"
    ) {
      throw new Error(`Invalid Hush animation contract: ${animation.id}`);
    }
    if (this.#animations.has(animation.id)) {
      throw new Error(`Duplicate Hush animation id: ${animation.id}`);
    }
    if (!Number.isFinite(animation.intervalMs) || animation.intervalMs <= 0) {
      throw new Error(`Invalid interval for Hush animation: ${animation.id}`);
    }
    validateHushAnimationWidth(animation.width, animation.id);
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

/** Resolve a fixed or proportional width against space left after indentation. */
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

/** Enforce the widget contract: at most maxHeight rows, none wider than width. */
export function normalizeHushWidgetFrame(
  lines: readonly string[],
  width: number,
  maxHeight: number,
): string[] {
  const safeWidth = Math.max(0, Math.floor(width));
  return lines
    .slice(0, Math.max(0, maxHeight))
    .map((line) => truncateToWidth(line, safeWidth, ""));
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
};

class HushAnimationWidget implements Component {
  readonly #tui: TUI;
  readonly #theme: Theme;
  readonly #animation: HushWorkingAnimation;
  readonly #state: HushWidgetAnimationState;
  readonly #onRenderError: (error: unknown) => void;
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
    onRenderError: (error: unknown) => void,
  ) {
    this.#tui = tui;
    this.#theme = theme;
    this.#animation = animation;
    this.#state = state;
    this.#onRenderError = onRenderError;
    this.#timer = setInterval(() => {
      if (this.#disposed) return;
      this.#state.frame += 1;
      this.#tui.requestRender();
    }, this.#animation.intervalMs);
    this.#timer.unref?.();
  }

  render(width: number): string[] {
    if (this.#disposed) return [];
    try {
      const viewportWidth = Math.max(0, Math.floor(width));
      if (viewportWidth === 0) return [];
      const indent = Math.min(HUSH_LOADER_INDENT, viewportWidth - 1);
      const contentWidth = resolveHushAnimationWidth(
        this.#animation.width,
        viewportWidth - indent,
      );
      if (contentWidth === 0) return [];
      const lines = this.#animation.renderFrame({
        frame: this.#state.frame,
        width: contentWidth,
        viewportWidth,
        palette: animationPalette(this.#theme),
      });
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
      const normalized = normalizeHushWidgetFrame(
        lines,
        contentWidth,
        this.#animation.maxHeight,
      );
      const prefix = " ".repeat(indent);
      return normalized.map((line) => `${prefix}${line}`);
    } catch (error) {
      if (!this.#renderErrorReported) {
        this.#renderErrorReported = true;
        this.dispose();
        queueMicrotask(() => this.#onRenderError(error));
      }
      return [];
    }
  }

  invalidate(): void {
    // Theme is read for every frame, so there is no themed render cache to clear.
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#state.frame = this.#state.lastRenderedFrame;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

/** Owns the temporary widget and all working-animation lifecycle. */
export class HushWorkingAnimationHost {
  readonly #registry: HushWorkingAnimationRegistry;
  readonly #defaultAnimationId: string;
  #animationId: string;
  #enabled = false;
  #working = false;
  #widgetsEnabled = true;
  #ui: ExtensionUIContext | undefined;
  #widget: HushAnimationWidget | undefined;
  readonly #widgetStates = new Map<string, HushWidgetAnimationState>();
  readonly #failedAnimationIds = new Set<string>();

  constructor(
    registry: HushWorkingAnimationRegistry,
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
    },
  ): void {
    const animationId = this.#registry.get(options.animationId)
      ? options.animationId
      : this.#defaultAnimationId;
    const widgetsEnabled = options.widgetsEnabled ?? true;
    if (
      this.#ui === ui &&
      this.#enabled === options.enabled &&
      this.#animationId === animationId &&
      this.#widgetsEnabled === widgetsEnabled
    ) {
      return;
    }

    this.#ui = ui;
    this.#enabled = options.enabled;
    this.#widgetsEnabled = widgetsEnabled;
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
