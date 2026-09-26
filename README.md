# pi-hush

A quieter way to read [Pi](https://github.com/badlogic/pi-mono) while it works.

**pi-hush** keeps the conversation and a configurable working animation easy to follow, while quietly tucking away tool chatter and optional thinking. It changes only what you see in the terminal—tool execution, model context, and session data stay untouched.

## What stays visible

Hush is **on by default**:

| Stays visible | Quietly hidden (presentation only) |
| --- | --- |
| Genuine user prompts | Thinking / CoT blocks (unless `/hush thinking`) |
| Genuine assistant text | All tool shells (built-in and user-defined) |
| Your selected activity animation, plus optional live status text | Operational user rows marked with `U+2063` envelopes |

Hidden content remains in the session and comes back when you turn Hush off. `/export` and `/share` briefly restore Pi's normal rendering so exported content remains complete.

## Install

### Option A — GitHub package (recommended)

```sh
pi install git:github.com/ludoroo/pi-hush
```

The package is discoverable by Pi's package gallery/index through the
`pi-package` keyword in `package.json`.

### Option B — npm package

```sh
pi install npm:pi-hush
```

### Option C — Local path

From this directory:

```sh
pi install /absolute/path/to/pi-hush
```

Or install as a path package from anywhere:

```sh
pi install ./path/to/pi-hush
```

### Option D — Global extension copy

```sh
mkdir -p ~/.pi/agent/extensions
cp -R extensions/hush ~/.pi/agent/extensions/hush
```

### Option E — One-shot test

```sh
pi -e ./extensions/hush/index.ts
```

Restart Pi (or `/reload`) after install. Project-local installs require project trust.

## Usage

```text
/hush on                  # Hush on, thinking hidden
/hush thinking            # Hush on, toggle thinking / CoT
/hush activity            # Hush on, toggle live activity text
/hush activity left       # place activity text before the animation
/hush activity right      # place activity text after the animation (default)
/hush animation           # choose an animation
/hush animation wave      # higher-frequency Braille waveform (default)
/hush animation bars      # compact equalizer bars
/hush animation orbit     # satellite orbiting a central body
/hush animation jumping-dots # three hollow dots passing a bounce
/hush animation shooting-star # star crossing all available width
/hush animation flock     # fine-dot migrating birds; at most two rows
/hush animation fish-loop # responsive fish; at most three rows
/hush width 28            # set this animation's drawing area to 28 columns
/hush width 60%           # use 60% of the remaining animation space
/hush width auto          # remove this animation's width override
/hush off                 # restore ordinary transcript
```

Pi provides nested argument completion after typing `/hush `. Selecting an animation also enables Hush; `/hush off` preserves the animation and activity-text selections for the next `/hush on`. Width commands change only the currently selected animation: they do not enable Hush or toggle activity text. Bare `/hush width` reports that animation's current override or built-in default.

A width is the animation's **drawing area**, not terminal-character zoom. Fixed values are columns; percentages use the animation space remaining after the one-column inset and any activity-text reservation. An override replaces that animation's built-in preferred width and min/max bounds, then the host clamps it to the remaining space. `/hush width auto` removes only the selected animation's override.

Activity text is **off by default**. When enabled, the same row adds a concise, dim summary such as `Thinking…`, `Responding…`, or `Running read…`. It appears to the right of the animation by default; `/hush activity left|right` changes its side without enabling activity text or Hush. Parallel work keeps deterministic start order and adds a count, for example `Running read +2…`. Tool names are sanitized before display. While activity is enabled, it gets a stable reservation of up to 24 columns—even if its label is temporarily absent; the animation is resolved against the remaining width and shrinks or disappears first on narrow terminals. Text is clipped rather than wrapped. With text on the left, the reserved column is padded on every animation row so changing labels cannot shift the drawing. Width and position changes update the live widget without restarting playback; the existing height budget still applies.

The built-in `wave`, `bars`, `orbit`, `jumping-dots`, and `shooting-star` loaders use one temporary, single-row widget with a one-column inset aligned to Pi's conversation text. The opt-in `fish-loop` uses at most three rows. `flock` draws fine-dot wing silhouettes in at most two rows and uses 100% of the available animation width by default (after reserving activity text). New formations enter as the outgoing flock's last bird reaches the far edge, without circling back. Spacing follows the allocated width; a fixed pass clock preserves progress when resizing, adjusting flight speed to the new distance. Width overrides still take priority. Fish and flock also fall back to one row in small panes; below ten animation columns, `flock` keeps a single bird flapping in place. None of these layout changes restarts playback. Activity text sits beside the middle row. Their multi-tone palette comes entirely from the active Pi theme (`accent`, `syntaxVariable`, `syntaxFunction`, `warning`, and `muted`) and updates with theme changes. The widget is mounted only while Pi works, so it leaves no idle reservation or residual blank rows. This deliberately dependency-free first step tests the companion experience before introducing sprites, image protocols, or background processes. The loader replaces Pi's visible `Working... (esc to interrupt)` message while active; Escape still interrupts normally. Hush off restores Pi's native spinner and message.

There are intentionally no bare `/hush`, `/hush thinking off`, or alias forms.

Preference is written to:

```text
~/.pi/agent/hush/preference
```

Contents:

| File contents | Meaning |
| --- | --- |
| `on` | Hush on, thinking hidden (default) |
| `on thinking` | Hush on, thinking / CoT shown |
| `off` | Hush off |

Missing file → defaults to **on**. Override the path with `PI_HUSH_PREFERENCE_PATH`.

The selected animation is stored separately in `~/.pi/agent/hush/selected-animation`, keeping the main Hush preference simple. It defaults to `wave`; override its path with `PI_HUSH_ANIMATION_PATH`.

The activity-text option is stored in `~/.pi/agent/hush/activity-text` as `on` or `off`. A missing or malformed file defaults to `off`; override its path with `PI_HUSH_ACTIVITY_PATH`.

Its position is stored independently in `~/.pi/agent/hush/activity-position` as `left` or `right`, outside the installed package so updates preserve it. Missing or malformed data defaults to `right`; override its path with `PI_HUSH_ACTIVITY_POSITION_PATH`.

Per-animation width overrides are stored in the versioned JSON file `~/.pi/agent/hush/animation-settings.json`, indexed by stable animation ID. It also lives outside the installed package, so package updates preserve it; override its path with `PI_HUSH_ANIMATION_SETTINGS_PATH`. Hush preserves unknown animation IDs and unrelated JSON fields when changing one width. Unreadable, malformed, or newer-version settings produce a warning at startup; Hush uses animation defaults without changing the saved file. Width-setting commands also refuse to overwrite such files.

Preferences are restored on every `session_start` (startup, resume, new, fork, reload).

## Operational rows (optional)

Any text-only user message that begins with one of these envelopes can be zero-height under Hush:

```text
U+2063HUSH_HIDE: <body>                          # general
U+2063FIRSTMATE_OP: v1 <kind>: <body>            # firstmate-compatible
[fm-from-firstmate]U+2063<body>                  # firstmate routing carrier
```

Helpers:

```ts
import {
  encodeHushHideInput,
  encodeFirstmateOperationalInput,
  classifyOperationalText,
} from "./extensions/hush/lib/operational-input.ts";

// In another extension that injects follow-up / watcher text:
pi.sendUserMessage(encodeHushHideInput("watcher: task finished"), {
  deliverAs: "followUp",
});
```

Near misses stay visible (quoted markers, plain `FIRSTMATE_OP:` without `U+2063`, ordinary text before the marker, image-bearing messages).

## Supported limits

Pi has no global transcript filter. These stay visible even with Hush on:

- User-bash (`!` / `!!`)
- Skill / compaction / branch summary rows
- Custom messages and entries emitted by third-party extensions
- Generic system / cache / command notices

Pi does not expose ownership/getters for working-row visibility or widgets. If another extension changes the same visibility or widget surface, the last configuration wins. Hush does not reset another extension's custom working indicator or message.

Adapters probe the exact Pi APIs they patch (`AssistantMessageComponent.updateContent`, `ToolExecutionComponent.render`, and `InteractiveMode.addMessageToChat`). The `ToolExecutionComponent` patch blanks every tool row, including user-defined tools, even if another extension wins Pi's first-wins tool ownership (e.g. `pi-tool-display`). Working animations use `setWidget()` and hide the native working row while mounted. If a future Pi removes a patched seam, that adapter logs a diagnostic and skips; `/hush` and the rest keep working. No numeric version gate.

Verified against Pi **0.85.1**.

## Layout

```text
package.json                 # pi package manifest
extensions/hush/
  index.ts                   # /hush command, tool wrappers, preference
  lib/
    visibility.ts            # presentation policy + preference
    operational-input.ts     # pure TS marker encode/classify
    assistant-layout.ts      # thinking/CoT presentation adapter
    tool-execution-layout.ts # all tool-row zero-height adapter
    operational-user-layout.ts  # operational user-row zero-height adapter
    animation-preference.ts  # separate animation selection persistence
    animation-settings.ts    # versioned per-animation width overrides
    animation-loader.ts      # global/project drop-in discovery
    activity.ts              # live status preference and lifecycle tracker
    animation.ts             # widget contract, registry, and lifecycle host
    animations.ts            # built-in animation registry
    animation-cells.ts       # grouped semantic-colour cell frames
    wave.ts                  # higher-frequency Braille waveform
    bars.ts                  # compact equalizer bars
    orbit.ts                 # compact projected orbit
    jumping-dots.ts          # three-dot travelling bounce
    shooting-star.ts         # ratio:1 shooting-star reference
    flock.ts                 # compact two-row migrating formations
    fish-loop.ts             # responsive three-row fish adaptation
    braille.ts               # shared theme-coloured sub-cell rendering
```

## Adding an animation

An animation is one default-exported TypeScript contract. Drop it into either location and run `/hush animation` (or `/reload`); Hush rescans and lists it immediately:

```text
~/.pi/agent/hush/animations/*.ts       # available everywhere
<project>/.pi/hush/animations/*.ts     # trusted project only
```

A one-level `<name>/index.ts` is also discovered, allowing an animation to carry relative modules or assets. JavaScript `.js`/`.mjs` and TypeScript `.ts`/`.mts` are accepted.

### Minimal frame animation

```ts
// ~/.pi/agent/hush/animations/spark.ts
export default {
  kind: "frames",
  id: "spark",
  label: "Spark",
  description: "A small travelling spark",
  intervalMs: 120,
  width: 3,
  maxHeight: 1,

  frames: [
    { text: "·  ", color: "muted" },
    { text: " • ", color: "secondary" },
    { text: "  ●", color: "highlight" },
    { text: " • ", color: "accent" },
  ],
};
```

Each frame associates its text with a semantic Pi theme colour. For multiple colours in one frame, use segments:

```ts
{
  segments: [
    { text: "·", color: "muted" },
    { text: "•", color: "secondary" },
    { text: "●", color: "highlight" },
  ],
}
```

No Hush import, renderer, registry edit, timer, widget, or Pi API call is required. Hush selects and colours frames and owns alignment, mount/unmount lifecycle, timer, clipping, frame continuity, theme updates, and cleanup. An omitted `color` defaults to `accent`.

### Width

Use a number for fixed content columns:

```ts
width: 12
```

Or size against the available viewport (after the one-column inset and activity-text reservation):

```ts
width: { ratio: 0.35, minColumns: 8, maxColumns: 32 }
```

Use `width: { ratio: 1 }` to consume every available animation column. The built-in `shooting-star` animation is the reference implementation; activity text still receives its reservation first.

The host resolves and clamps width before painting and clipping the selected frame. Advanced phase- or width-dependent animations use the same frame object: `kind: "procedural"` replaces the `frames` array with a `renderFrame()` that returns `{ text, color }`, `{ segments }`, or `{ rows }`.

```ts
export default {
  kind: "procedural",
  id: "meter",
  label: "Meter",
  description: "A width-aware activity meter",
  intervalMs: 100,
  width: { ratio: 0.3, minColumns: 4, maxColumns: 20 },
  maxHeight: 1,

  renderFrame({ frame, width }) {
    return {
      segments: Array.from({ length: width }, (_, column) => ({
        text: column === frame % width ? "●" : "·",
        color: column === frame % width ? "highlight" : "muted",
      })),
    };
  },
};
```

### Responsive multi-row frames

Both recorded and procedural animations can return rows of semantic text segments. Existing single-row contracts still work unchanged:

```ts
{
  rows: [
    { text: "   .", color: "muted" },
    { segments: [{ text: "><", color: "secondary" }, { text: "(o)>", color: "accent" }] },
    { text: "" }, // explicit blank row, not trimmed away
  ],
}
```

Set `maxHeight: 3` for a three-row canvas. This is a preferred height, not permission to take over the pane: the host allocates **at most three rows**, further limited to `max(1, floor(terminalRows / 8))`. Short panes therefore receive one or two rows. An optional `minWidthForMultiRow` selects a one-row allocation below that many animation columns, after the activity reservation.

Procedural renderers receive `HushAnimationRenderContext`:

- `width` and `height`: the allocated drawing area, not the full terminal.
- `viewportWidth`: the complete widget width, before inset and activity reservation.
- `elapsedMs`: active playback time, sampled on timer ticks; resizing and theme changes never advance or restart it.
- `frame`: `floor(elapsedMs / intervalMs)`, retained for existing renderers.

Draw a smaller rendition when the area is too small, rather than scaling terminal characters or relying on cropping. For example, `fish-loop` adapts its path and drawing to the allocated area while keeping the same loop phase. The host clips overflow, pads blank rows and columns, and keeps the allocated height stable between resizes; short frames cannot make the editor jump. Recorded frames use top-left clipping when they do not fit (there is no per-frame trimming or recentering), so responsive artwork should use a procedural renderer to choose variants.

Playback pauses while unmounted and resumes from the last displayed frame. Missed timer ticks catch up using a monotonic clock rather than slowing the animation. Frame durations remain uniform via `intervalMs`; per-frame timing and editor-style grids/layers are not part of this contract.

The fish is an original compact interpretation inspired by [CameronFoxly's Fish Loop](https://ascii-motion.app/community/project/424d1127-7ab4-449a-ac73-a543524a4141), not an import or a scaled copy of its 60×30 artwork.

Procedural animation code never receives the theme palette and never emits styled terminal strings; Hush consumes and paints its semantic frame exactly like a declarative frame.

Prefer predictable single-column glyphs in animation contracts. Emoji, variation selectors, zero-width joiners, combining marks, and East Asian ambiguous symbols can render at inconsistent widths across terminals. ASCII glyphs such as `.`, `o`, `O`, `@`, `*`, and `-` are safest. Built-ins that intentionally use Braille, blocks, or circles cover them with visible-width tests. Font appearance and ambiguous character widths can still vary between terminals.

The registry rejects invalid IDs, intervals, widths, colours, frames, duplicate IDs, and declared heights outside 1–10. Playback still has a strict three-row cap. Frames reject terminal control sequences, and `{ rows }` must stay within the declared `maxHeight`. A broken file is reported and skipped without preventing other animations from loading. Project-local modules execute code and are therefore scanned only for trusted projects.

### Built-ins and published extensions

Repository built-ins still live in `animations.ts`. To publish an animation as its own Pi package, keep the same contract as `animation.ts` and use the public one-line adapter as the package extension entrypoint:

```ts
// index.ts
import animation from "./animation.ts";
import { createHushAnimationExtension } from "pi-hush/animation-api";
export default createHushAnimationExtension(animation);
```

Declare `pi-hush` as a dependency or peer dependency of the animation package so the `pi-hush/animation-api` import resolves within that package's module graph; installing Hush separately from Git does not expose its modules to unrelated packages. The adapter uses the versioned discovery event internally. Drop-in files, repository built-ins, and published packages all use the same contract and automatically participate in selection and persistence.

Test frame order, semantic colours, visible width, and row count rather than ANSI byte length or implementation details.

## Inspiration and alternative

Hush was inspired by [pi-calm](https://github.com/JesseZhang97/pi-calm), which remains a good alternative if you prefer its original presentation model.
