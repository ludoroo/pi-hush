import { BUILT_IN_HUSH_ANIMATIONS } from "../../extensions/hush/animations/index.ts";
import type {
  HushAnimationFrame,
  HushAnimationRow,
  HushWorkingAnimation,
} from "../../extensions/hush/lib/animation.ts";
import {
  resolveHushAnimationHeight,
  resolveHushAnimationWidth,
  resolveHushWidgetLayout,
} from "../../extensions/hush/lib/animation.ts";
import type { HushActivityPlacement } from "../../extensions/hush/lib/activity.ts";

type Cell = { text: string; color: string };
type LayoutConfig = {
  columns: number;
  rows: number;
  widthMode: string;
  activity: "off" | HushActivityPlacement;
  activityLabel: string;
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing gallery element: ${id}`);
  return found as T;
}

const controls = {
  play: element<HTMLButtonElement>("play"),
  restart: element<HTMLButtonElement>("restart"),
  timeline: element<HTMLInputElement>("timeline"),
  clock: element<HTMLOutputElement>("clock"),
  speed: element<HTMLSelectElement>("speed"),
  columns: element<HTMLInputElement>("columns"),
  columnNumber: element<HTMLInputElement>("columns-number"),
  rows: element<HTMLSelectElement>("rows"),
  widthMode: element<HTMLSelectElement>("width-mode"),
  activity: element<HTMLSelectElement>("activity"),
  activityLabel: element<HTMLSelectElement>("activity-label"),
  theme: element<HTMLSelectElement>("theme"),
  fontSize: element<HTMLSelectElement>("font-size"),
  summary: element<HTMLElement>("layout-summary"),
  gallery: element<HTMLElement>("gallery"),
  motionNote: element<HTMLElement>("motion-note"),
};
const config: LayoutConfig = {
  columns: 54,
  rows: 3,
  widthMode: "auto",
  activity: "status",
  activityLabel: "Working",
};
const roles = new Set(["accent", "secondary", "tertiary", "highlight", "muted"]);
const blank = (): Cell => ({ text: " ", color: "muted" });
const spaces = (count: number): Cell[] => Array.from({ length: Math.max(0, count) }, blank);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let elapsedMs = 0;
let playing = !reducedMotion;
let speed = 1;
let lastWall = performance.now();
let lastClock = "";
let layoutVersion = 0;
let expandedId: string | null = null;
let animationRequest = 0;

function plainCells(text: string, color = "muted"): Cell[] {
  return Array.from(text, (character) => ({ text: character, color }));
}

function normalizeRow(row: HushAnimationRow | undefined, width: number): Cell[] {
  const segments = !row ? [] : "segments" in row ? row.segments : [row];
  const cells = segments
    .flatMap((segment) => {
      const color = segment.color ?? "accent";
      if (!roles.has(color)) throw new Error("Unsupported semantic colour");
      if (/[\p{Cc}\p{Cf}\p{M}]/u.test(segment.text)) {
        throw new Error("Non-printable animation text");
      }
      return plainCells(segment.text, color);
    })
    .slice(0, width);
  return [...cells, ...spaces(width - cells.length)];
}

/** Compose the exact Hush widget; status placement remains Pi-owned. */
function composeRow(
  cells: Cell[],
  row: number,
  layout: ReturnType<typeof resolveHushWidgetLayout>,
): Cell[] {
  const activity = [
    ...plainCells(config.activityLabel, "muted").slice(0, layout.activityWidth),
  ];
  activity.push(...spaces(layout.activityWidth - activity.length));
  const activityCell = row === 0 ? activity : spaces(layout.activityWidth);
  const gap = spaces(layout.gapWidth);
  const body = config.activity === "widget-left"
    ? [...activityCell, ...gap, ...cells]
    : config.activity === "widget-right"
      ? [...cells, ...gap, ...activityCell]
      : cells;
  const line = [...spaces(layout.indent), ...body].slice(0, config.columns);
  return [...line, ...spaces(config.columns - line.length)];
}

function drawLines(container: HTMLElement, lines: Cell[][]): void {
  const fragment = document.createDocumentFragment();
  for (const cells of lines) {
    const line = document.createElement("span");
    line.className = "line";
    for (const cell of cells) {
      const span = document.createElement("span");
      span.className = `cell ${cell.color}`;
      span.textContent = cell.text;
      line.append(span);
    }
    fragment.append(line);
  }
  container.replaceChildren(fragment);
}

function preferredWidth(animation: HushWorkingAnimation): string {
  if (typeof animation.width === "number") return `${animation.width} cols by default`;
  const { ratio, minColumns, maxColumns } = animation.width;
  const bound = maxColumns
    ? ` · max ${maxColumns}`
    : minColumns
      ? ` · min ${minColumns}`
      : "";
  return `${Math.round(ratio * 100)}% available${bound}`;
}

const records = BUILT_IN_HUSH_ANIMATIONS.map((animation: HushWorkingAnimation) => {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.animation = animation.id;

  const head = document.createElement("div");
  head.className = "card-head";
  const intro = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = animation.label;
  const description = document.createElement("p");
  description.className = "description";
  description.textContent = animation.description;
  intro.append(title, description);
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "expand";
  expand.textContent = "Expand";
  expand.setAttribute("aria-expanded", "false");
  expand.setAttribute("aria-label", `Expand ${animation.label} preview`);
  head.append(intro, expand);

  const theatre = document.createElement("div");
  theatre.className = "theatre";
  const drawing = document.createElement("div");
  drawing.className = "drawing";
  drawing.setAttribute("role", "img");
  drawing.setAttribute("aria-label", `${animation.label} animation preview`);
  theatre.append(drawing);
  const nativeStatus = document.createElement("div");
  nativeStatus.className = "native-status";
  nativeStatus.hidden = true;

  const foot = document.createElement("div");
  foot.className = "card-foot";
  const meta = document.createElement("span");
  meta.className = "meta";
  const command = document.createElement("code");
  command.className = "command";
  command.textContent = `/hush animation ${animation.id}`;
  foot.append(meta, command);
  card.append(head, theatre, nativeStatus, foot);
  controls.gallery.append(card);

  const record = {
    animation,
    card,
    drawing,
    theatre,
    nativeStatus,
    meta,
    expand,
    lastKey: "",
    fitKey: "",
    snapshot: null as unknown,
  };
  expand.onclick = () => {
    expandedId = expandedId === animation.id ? null : animation.id;
    syncExpanded();
    if (expandedId) {
      requestAnimationFrame(() => {
        if (expandedId !== animation.id) return;
        const controlsHeight = document.querySelector(".controls")!.getBoundingClientRect().height;
        const top = card.getBoundingClientRect().top + window.scrollY - controlsHeight - 24;
        window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
      });
    }
  };
  return record;
});

/** Fit the display only: renderer columns, rows, and playback remain unchanged. */
function fitDrawings(): void {
  const requestedSize = getComputedStyle(document.documentElement).getPropertyValue("--font-size");
  for (const record of records) {
    const style = getComputedStyle(record.theatre);
    const available = record.theatre.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (available <= 0) continue;
    const key = `${available}/${requestedSize}/${config.columns}/${expandedId === record.animation.id}/${document.body.className}`;
    if (record.fitKey === key) continue;
    record.fitKey = key;
    record.drawing.style.removeProperty("font-size");
    const fontSize = parseFloat(getComputedStyle(record.drawing).fontSize);
    const naturalWidth = record.drawing.getBoundingClientRect().width;
    if (naturalWidth > available) {
      // Keep a pixel of rounding slack so fallback fonts cannot clip the last cell.
      record.drawing.style.fontSize = `${fontSize * Math.max(0, available - 1) / naturalWidth}px`;
    }
  }
}

function syncExpanded(): void {
  for (const record of records) {
    const expanded = expandedId === record.animation.id;
    record.card.classList.toggle("focused", expanded);
    record.expand.textContent = expanded ? "Collapse" : "Expand";
    record.expand.setAttribute("aria-expanded", String(expanded));
    record.expand.setAttribute(
      "aria-label",
      `${expanded ? "Collapse" : "Expand"} ${record.animation.label} preview`,
    );
  }
  fitDrawings();
}

function render(force = false): void {
  const activityEnabled = config.activity !== "off";
  const activityPlacement = config.activity === "off" ? "status" : config.activity;
  const layout = resolveHushWidgetLayout(
    config.columns,
    activityEnabled,
    activityPlacement,
  );
  for (const record of records) {
    const { animation } = record;
    record.nativeStatus.hidden = config.activity !== "status";
    record.nativeStatus.textContent = config.activityLabel;
    const frame = Math.floor(elapsedMs / animation.intervalMs);
    const key = `${frame}/${layoutVersion}`;
    if (!force && key === record.lastKey) continue;
    record.lastKey = key;
    const width = resolveHushAnimationWidth(
      config.widthMode === "full" ? { ratio: 1 } : animation.width,
      layout.animationAvailableWidth,
    );
    const height = resolveHushAnimationHeight(animation, width, config.rows * 8);
    const sampledMs = frame * animation.intervalMs;
    try {
      const raw: HushAnimationFrame =
        width === 0
          ? { text: "" }
          : animation.kind === "frames"
            ? animation.frames[frame % animation.frames.length]!
            : animation.renderFrame({
                frame,
                width,
                height,
                viewportWidth: config.columns,
                elapsedMs: sampledMs,
              });
      const rawRows = "rows" in raw ? raw.rows : [raw];
      const drawing = Array.from({ length: height }, (_, row) =>
        normalizeRow(rawRows[row], width),
      );
      const lines = drawing.map((cells, row) => composeRow(cells, row, layout));
      drawLines(record.drawing, lines);
      record.meta.textContent =
        `${width} × ${height} canvas` +
        ` · ${animation.intervalMs} ms · ` +
        (config.widthMode === "full" ? "full-width override" : preferredWidth(animation));
      record.snapshot = {
        id: animation.id,
        width,
        height,
        frame,
        elapsedMs: sampledMs,
        rows: lines.map((line) => line.map((cell) => cell.text).join("")),
        error: null,
      };
    } catch (error) {
      record.drawing.classList.add("error");
      record.drawing.textContent = error instanceof Error ? error.message : String(error);
      record.meta.textContent = "Renderer error";
      record.snapshot = {
        id: animation.id,
        width,
        height,
        frame,
        elapsedMs: sampledMs,
        rows: [],
        error: String(error),
      };
    }
  }

  if (force) fitDrawings();
  const seconds = Math.floor(elapsedMs / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${Math.floor((elapsedMs % 1000) / 100)}`;
  if (clock !== lastClock || force) {
    lastClock = clock;
    controls.clock.textContent = clock;
    const max = Math.max(60_000, Math.ceil(elapsedMs / 60_000) * 60_000);
    controls.timeline.max = String(max);
    controls.timeline.value = String(elapsedMs);
    controls.timeline.setAttribute("aria-valuetext", clock);
  }
}

function advance(now = performance.now()): void {
  if (playing) elapsedMs += Math.max(0, now - lastWall) * speed;
  lastWall = now;
}

function stopFrame(): void {
  if (animationRequest) cancelAnimationFrame(animationRequest);
  animationRequest = 0;
}

function setPlaying(value: boolean): void {
  advance();
  playing = value;
  controls.play.textContent = playing ? "Pause" : "Play";
  controls.play.setAttribute("aria-label", playing ? "Pause all animations" : "Play all animations");
  render();
  if (playing) queueFrame();
  else stopFrame();
}

function setTime(time: number): void {
  playing = false;
  stopFrame();
  elapsedMs = Number.isFinite(time) ? Math.max(0, time) : 0;
  lastWall = performance.now();
  controls.play.textContent = "Play";
  controls.play.setAttribute("aria-label", "Play all animations");
  render(true);
}

function updateLayout(): void {
  const entered = controls.columnNumber.value.trim() === ""
    ? Number.NaN
    : Number(controls.columnNumber.value);
  config.columns = Number.isFinite(entered)
    ? Math.max(2, Math.min(120, Math.round(entered)))
    : config.columns;
  controls.columns.value = controls.columnNumber.value = String(config.columns);
  config.rows = Number(controls.rows.value);
  config.activity = controls.activity.value as LayoutConfig["activity"];
  config.activityLabel = controls.activityLabel.value;
  config.widthMode = controls.widthMode.value;
  const activitySummary = config.activity === "off"
    ? "activity off"
    : `${config.activity}: ${config.activityLabel}`;
  controls.summary.textContent =
    `· ${config.columns} columns · up to ${config.rows} rows · ${activitySummary}`;
  layoutVersion += 1;
  render(true);
}

controls.play.onclick = () => setPlaying(!playing);
controls.restart.onclick = () => {
  elapsedMs = 0;
  lastWall = performance.now();
  render(true);
};
controls.timeline.oninput = () => setTime(Number(controls.timeline.value));
controls.speed.onchange = () => {
  advance();
  speed = Number(controls.speed.value);
};
controls.columns.oninput = () => {
  controls.columnNumber.value = controls.columns.value;
  updateLayout();
};
controls.columnNumber.oninput = () => {
  const value = controls.columnNumber.valueAsNumber;
  // Allow intermediate input (for example the first "1" in "100") before clamping.
  if (Number.isInteger(value) && value >= 2 && value <= 120) updateLayout();
};
controls.columnNumber.onchange = updateLayout;
for (const select of [
  controls.rows,
  controls.activity,
  controls.activityLabel,
  controls.widthMode,
]) {
  select.onchange = updateLayout;
}
controls.theme.onchange = () => {
  document.documentElement.dataset.theme = controls.theme.value;
};
controls.fontSize.onchange = () => {
  document.documentElement.style.setProperty("--font-size", `${controls.fontSize.value}px`);
  fitDrawings();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && expandedId) {
    expandedId = null;
    syncExpanded();
  }
  if (
    event.code === "Space" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !(event.target instanceof HTMLElement &&
      event.target.closest("input,select,button,summary,textarea,[contenteditable]"))
  ) {
    event.preventDefault();
    setPlaying(!playing);
  }
});

element("count").textContent = `${records.length} built-ins · offline`;
controls.motionNote.textContent = reducedMotion
  ? "Reduced motion is on, so playback starts paused."
  : "One shared clock.";

// Deterministic inspection hooks used by the preview builder and parity checks.
const galleryApi = {
  setTime,
  setLayout(next: Partial<LayoutConfig>) {
    if (next.columns !== undefined) controls.columnNumber.value = String(next.columns);
    if (next.rows !== undefined) controls.rows.value = String(next.rows);
    if (next.activity !== undefined) controls.activity.value = next.activity;
    if (next.activityLabel !== undefined) controls.activityLabel.value = next.activityLabel;
    if (next.widthMode !== undefined) controls.widthMode.value = next.widthMode;
    updateLayout();
  },
  inspect: () => ({
    elapsedMs,
    playing,
    speed,
    config: { ...config },
    frames: records.map((record) => record.snapshot),
  }),
};

declare global {
  interface Window {
    hushGallery: typeof galleryApi;
  }
}
window.hushGallery = galleryApi;

function queueFrame(): void {
  if (playing && !animationRequest) animationRequest = requestAnimationFrame(animate);
}
function animate(now: number): void {
  animationRequest = 0;
  advance(now);
  render();
  queueFrame();
}

updateLayout();
const previewResize = new ResizeObserver(() => fitDrawings());
for (const record of records) previewResize.observe(record.theatre);
setPlaying(playing);
