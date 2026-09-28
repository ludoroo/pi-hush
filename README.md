# pi-hush

A quieter way to read [Pi](https://github.com/badlogic/pi-mono) while it works.

**pi-hush** keeps the conversation and a configurable working animation easy to follow, while quietly tucking away tool chatter and optional thinking. It changes only what you see in the terminal—tool execution, model context, and session data stay untouched.

## What stays visible

Hush is **on by default**, with the **flock animation and live activity text on its left**:

| Stays visible | Quietly hidden (presentation only) |
| --- | --- |
| Genuine user prompts | Thinking / CoT blocks (unless `/hush thinking`) |
| Genuine assistant text | All tool shells (built-in and user-defined) |
| Your selected activity animation, plus optional live status text | Marked or configured-prefix operational user rows |

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

From this directory, install the runtime dependencies before registering the local package:

```sh
npm install --ignore-scripts
pi install /absolute/path/to/pi-hush
```

Or install as a path package from anywhere:

```sh
npm install --prefix ./path/to/pi-hush --ignore-scripts
pi install ./path/to/pi-hush
```

### Option D — Global extension copy

```sh
mkdir -p ~/.pi/agent/extensions
cp -R extensions/hush ~/.pi/agent/extensions/hush
npm install --prefix ~/.pi/agent/extensions/hush --no-save --no-package-lock \
  smol-toml@1.9.0 toml-eslint-parser@0.10.0
```

The TOML dependencies are required for manual copies. Git/npm package installs install them automatically.

### Option E — One-shot test

```sh
npm install --ignore-scripts
pi -e ./extensions/hush/index.ts
```

Restart Pi (or `/reload`) after install. Project-local installs require project trust.

## Usage

```text
/hush on                  # Hush on, thinking hidden
/hush thinking            # Hush on, toggle thinking / CoT
/hush activity            # Hush on, toggle live activity text
/hush activity left       # place activity text before the animation (default)
/hush activity right      # place activity text after the animation
/hush animation           # choose an animation
/hush animation wave      # organic Braille swells and ripples
/hush animation bars      # compact equalizer bars
/hush animation jumping-dots # three hollow dots passing a bounce
/hush animation shooting-star # shimmering tail; gently falls in taller panes
/hush animation flock     # fine-dot migrating birds; at most two rows (default)
/hush animation fish-loop # responsive fish; at most three rows
/hush animation cat-ball  # a cat chasing and playing with a ball; at most three rows
/hush width 28            # set this animation's drawing area to 28 columns
/hush width 60%           # use 60% of the remaining animation space
/hush width auto          # remove this animation's width override
/hush off                 # restore ordinary transcript
```

Pi provides nested argument completion after typing `/hush `. Selecting an animation also enables Hush; `/hush off` preserves the animation and activity-text selections for the next `/hush on`. Width commands change only the currently selected animation: they do not enable Hush or toggle activity text. Bare `/hush width` reports that animation's current override or built-in default.

A width is the animation's **drawing area**, not terminal-character zoom. Fixed values are columns; percentages use the animation space remaining after the one-column inset and any activity-text reservation. An override replaces that animation's built-in preferred width and min/max bounds, then the host clamps it to the remaining space. `/hush width auto` removes only the selected animation's override.

Activity text is **on by default**, to the **left** of the animation. The same row adds a concise, dim summary such as `Working…`, `Thinking…`, `Responding…`, or `Running read…`. Use `/hush activity` to toggle it; `/hush activity left|right` changes its side without enabling activity text or Hush. Parallel work keeps deterministic start order and adds a count, for example `Running read +2…`. Tool names are sanitized before display. While activity is enabled, it gets a stable reservation of up to 24 columns—even if its label is temporarily absent; the animation is resolved against the remaining width and shrinks or disappears first on narrow terminals. Text is clipped rather than wrapped. With text on the left, the reserved column is padded on every animation row so changing labels cannot shift the drawing. Width and position changes update the live widget without restarting playback; the existing height budget still applies.

Labels distinguish Pi's reported activity automatically—there is no extra setting:

| Label | When it appears |
| --- | --- |
| `Thinking…` | Pi is streaming an explicit thinking block |
| `Working…` | Waiting, preparing tool arguments, between streaming phases, or settling |
| `Running read…` / `Running read +2…` | Tools are executing; this takes precedence over streaming labels |
| `Responding…` | Pi is streaming reply text |

If a provider does not report thinking events, Hush uses `Working…` rather than guessing. These labels do not expose thinking content or change the separate `/hush thinking` visibility preference.

The built-in `wave`, `bars`, and `jumping-dots` loaders use one temporary, single-row widget with a one-column inset aligned to Pi's conversation text. Wave blends moving swells, uneven crest spacing, and smaller counter-moving ripples instead of repeating a fixed sine curve. High crests brighten and quieter stretches soften, using only the current theme's colours. Its default remains 30 columns and one row; resizing reveals more of the same evolving surface rather than stretching it.

`shooting-star` fills the available animation width with a bright text star and a short, shimmering Braille tail on a clear background. With at least 12 animation columns and room for two rows, it follows a shallow falling path. Short or narrow panes keep a straight, single-row rendition. The tail flickers through small density changes without leaving a background track, and the last spark stays visible until the next pass begins.

The opt-in `fish-loop` and `cat-ball` use at most three rows. In Cat & Ball, a bouncing ball settles near the middle, a cat catches up and paws at it, then sends it off-screen and follows. The scene repeats on a fixed clock without restarting on resize, and simplifies in small panes. `flock` draws fine-dot wing silhouettes in at most two rows and uses 100% of the available animation width by default (after reserving activity text). New formations enter as the outgoing flock's last bird reaches the far edge, without circling back. Spacing follows the allocated width; a fixed pass clock preserves progress when resizing, adjusting flight speed to the new distance. Width overrides still take priority. Fish and flock also fall back to one row in small panes; below ten animation columns, `flock` keeps a single bird flapping in place. None of these layout changes restarts playback. Activity text sits beside the middle row. Their multi-tone palette comes entirely from the active Pi theme (`accent`, `syntaxVariable`, `syntaxFunction`, `warning`, and `muted`) and updates with theme changes. The widget is mounted only while Pi works, so it leaves no idle reservation or residual blank rows. Animations use terminal text only, without sprites, image protocols, or background processes. The loader replaces Pi's visible `Working... (esc to interrupt)` message while active; Escape still interrupts normally. Hush off restores Pi's native spinner and message.

There are intentionally no bare `/hush`, `/hush thinking off`, or alias forms.

## Configuration

All preferences live in **one TOML 1.0 file**, outside the installed package so updates preserve them:

```text
~/.pi/agent/hush/config.toml
```

Override its location with `PI_HUSH_CONFIG_PATH`. Fields are optional; this example shows the global defaults and two optional width overrides:

```toml
version = 1
enabled = true
thinking = false
animation = "flock"

[activity]
enabled = true
position = "left"

[transcript]
hidden_input_prefixes = []

# Optional drawing widths, keyed by animation ID.
[animations.wave]
width = 28

[animations.flock]
width = "60%"
```

- `/hush` commands update **this same file**. They reread it before each edit, preserve unrelated values, unknown animation IDs, and comments, then save atomically. Width and activity-position commands still change only their own settings and preserve playback.
- Widths accept positive integer columns, percentage strings such as `"60%"`, or `"auto"` to follow authored defaults. Advanced bounded widths also accept inline tables such as `{ ratio = 0.6, minColumns = 12, maxColumns = 48 }`.
- A missing file or omitted fields use defaults: Hush on, thinking hidden, `flock`, activity text on/left, no width overrides or custom prefixes. Loading Hush or running a no-op command does not create the file; an actual setting change through `/hush` creates it.
- Malformed, invalid, unreadable, or newer-version configuration produces a warning and uses defaults, including **no custom prefix hiding**. Commands refuse to overwrite it or change active settings on a failed save. Fix the file and run `/reload`.
- Preferences are restored on every `session_start`. Startup and `/reload` read the file during extension loading, before restored transcript rows are drawn. Edit the file and run `/reload` to apply manual changes everywhere.

Only `config.toml` is read or written. Older preference files and their environment overrides are ignored, with no migration or fallback. Saving preserves valid config-file symlinks.

## Operational rows (optional)

The built-in `U+2063HUSH_HIDE: <body>` envelope hides a text-only user row while Hush is on. It requires a nonblank body; the invisible separator is part of the marker. Other extensions can opt in without any integration-specific code:

```ts
import { encodeHushHideInput } from "./extensions/hush/lib/operational-input.ts";

pi.sendUserMessage(encodeHushHideInput("watcher: task finished"), {
  deliverAs: "followUp",
});
```

### Configurable hidden-input prefixes

To hide another integration's operational user rows, add literal prefixes under `[transcript]` in the same `config.toml`, then run `/reload`:

```toml
[transcript]
hidden_input_prefixes = ["[automation] "]
```

Edit an existing `[transcript]` section rather than creating a duplicate. This global presentation setting is independent of animation selection.

- Matching is **case-sensitive and starts at the beginning** of the message. Neither the prefix nor the message is trimmed or normalised. Regex syntax has no special meaning; a message equal to a configured prefix also matches. Choose distinctive prefixes: matching text you type yourself will also be hidden.
- Only **text-only user messages** are eligible. Image-bearing messages, assistant replies, custom messages, and custom entries are not hidden by these rules. Quoted or embedded prefixes do not match unless they actually start the text.
- An omitted setting or `[]` means **no custom prefixes**. Every entry must be a nonblank string. An invalid entry, malformed TOML, a non-array value, or an unreadable file disables the entire custom list and produces a warning. Invalid configuration is never rewritten. The built-in Hush envelope still works.
- Rules load at extension startup and `/reload`, before restored messages are drawn. Add, change, or remove prefixes in the same file as your other preferences.

Hush off restores these rows, and exports retain their original content. Hidden messages still reach the model and remain in session history: this is not redaction or an execution filter.

### Firstmate recipe (opt-in)

**Firstmate markers are no longer hidden automatically.** To opt in, use these prefixes in the same settings file:

```toml
[transcript]
hidden_input_prefixes = [
  "\u2063FIRSTMATE_OP: v1 ",
  "[fm-from-firstmate]\u2063",
]
```

TOML double-quoted strings decode `\u2063` to the invisible separator (single-quoted literal strings do not); it must be present in the message for these prefixes to match. The broad `FIRSTMATE_OP: v1 ` prefix includes every kind under that header, including future kinds. Use a narrower prefix such as `"\u2063FIRSTMATE_OP: v1 watcher: "` to hide only watcher inputs. No Firstmate kind list, encoder, or separate adapter is built into Hush.

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
    config.ts                # optional TOML settings, defaults, atomic writes
    toml-edit.ts              # targeted TOML edits preserving comments/unknown data
    visibility.ts            # presentation policy + preference
    operational-input.ts     # Hush envelope + literal prefix configuration/classification
    assistant-layout.ts      # thinking/CoT presentation adapter
    tool-execution-layout.ts # all tool-row zero-height adapter
    operational-user-layout.ts  # operational user-row zero-height adapter
    animation-preference.ts  # animation ID resolution
    animation-settings.ts    # per-animation width values and updates
    animation-loader.ts      # global/project drop-in discovery
    activity.ts              # live status preference and lifecycle tracker
    animation.ts             # widget contract, registry, and lifecycle host
    animations.ts            # built-in animation registry
    animation-cells.ts       # grouped semantic-colour cell frames
    wave.ts                  # organic Braille swells and ripples
    bars.ts                  # compact equalizer bars
    jumping-dots.ts          # three-dot travelling bounce
    shooting-star.ts         # full-width, shimmering star with a shallow falling path
    flock.ts                 # compact two-row migrating formations
    fish-loop.ts             # responsive three-row fish adaptation
    cat-ball.ts              # a responsive cat-and-ball play sequence
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

Prefer predictable single-column glyphs in animation contracts. Emoji, variation selectors, zero-width joiners, combining marks, and East Asian ambiguous symbols can render at inconsistent widths across terminals. ASCII glyphs such as `.`, `o`, `O`, `@`, `*`, and `-` are safest. Built-ins that intentionally use Braille, blocks, circles, or neutral-width text stars cover them with visible-width tests. Font appearance and ambiguous character widths can still vary between terminals.

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
