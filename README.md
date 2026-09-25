# pi-hush

A quieter way to read [Pi](https://github.com/badlogic/pi-mono) while it works.

**pi-hush** keeps the conversation and a configurable working animation easy to follow, while quietly tucking away tool chatter and optional thinking. It changes only what you see in the terminal—tool execution, model context, and session data stay untouched.

## What stays visible

Hush is **on by default**:

| Stays visible | Quietly hidden (presentation only) |
| --- | --- |
| Genuine user prompts | Thinking / CoT blocks (unless `/hush thinking`) |
| Genuine assistant text | All tool shells (built-in and user-defined) |
| Your selected activity animation while Pi works | Operational user rows marked with `U+2063` envelopes |

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
/hush animation           # choose an animation
/hush animation wave      # compact Braille waveform (default)
/hush animation bars      # compact equalizer bars
/hush off                 # restore ordinary transcript
```

Pi provides nested argument completion after typing `/hush `. Selecting an animation also enables Hush; `/hush off` preserves the selection for the next `/hush on`.

The `wave` and `bars` loaders use one temporary, single-row widget with a small vanilla-like left indent. Their multi-tone palette comes entirely from the active Pi theme (`accent`, `syntaxVariable`, `syntaxFunction`, `warning`, and `muted`) and updates with theme changes. The widget is mounted only while Pi works, so it leaves no idle reservation or residual blank rows. This deliberately dependency-free first step tests the companion experience before introducing sprites, image protocols, or background processes. The loader replaces Pi's visible `Working... (esc to interrupt)` message while active; Escape still interrupts normally. Hush off restores Pi's native spinner and message.

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
    animation-loader.ts      # global/project drop-in discovery
    working-animation.ts     # widget contract, registry, and lifecycle host
    working-animations.ts    # built-in animation registry
    working-wave.ts          # compact Braille waveform loader
    working-bars.ts          # compact equalizer-bars loader
```

## Adding an animation

An animation is one default-exported TypeScript contract. Drop it into either location and run `/hush animation` (or `/reload`); Hush rescans and lists it immediately:

```text
~/.pi/agent/hush/animations/*.ts       # available everywhere
<project>/.pi/hush/animations/*.ts     # trusted project only
```

A one-level `<name>/index.ts` is also discovered, allowing an animation to carry relative modules or assets. JavaScript `.js`/`.mjs` and TypeScript `.ts`/`.mts` are accepted.

### Minimal proportional animation

```ts
// ~/.pi/agent/hush/animations/spark.ts
const FRAMES = ["·  ", " • ", "  ●", " • "] as const;

export default {
  id: "spark",
  label: "Spark",
  description: "A small travelling spark",
  intervalMs: 120,
  width: { ratio: 0.25, minColumns: 3, maxColumns: 20 },
  maxHeight: 1,

  renderFrame({ frame, width, palette }) {
    const source = FRAMES[frame % FRAMES.length];
    const visible = Array.from(source).slice(0, width).join("");
    return [palette.secondary(visible)];
  },
};
```

No Hush import, registry edit, timer, widget, or Pi API call is required. Hush owns the left indent, mount/unmount lifecycle, timer, clipping, frame continuity, theme updates, and cleanup.

### Width

Use a number for fixed content columns:

```ts
width: 12
```

Or size against the available viewport after Hush's indent:

```ts
width: { ratio: 0.35, minColumns: 8, maxColumns: 32 }
```

The host resolves and clamps the width before calling `renderFrame()`. Its context contains:

- `frame`: monotonically increasing frame number, frozen while idle.
- `width`: resolved content width the renderer may use.
- `viewportWidth`: complete widget width for advanced layouts.
- `palette`: active-theme painters (`accent`, `secondary`, `tertiary`, `highlight`, `muted`).

The registry rejects invalid IDs, intervals, widths, duplicate IDs, and heights outside 1–10. A broken file is reported and skipped without preventing other animations from loading. Project-local modules execute code and are therefore scanned only for trusted projects.

### Built-ins and published extensions

Repository built-ins still live in `working-animations.ts`. To publish an animation as its own Pi package, keep the same contract as `animation.ts` and use the public one-line adapter as the package extension entrypoint:

```ts
// index.ts
import animation from "./animation.ts";
import { createHushAnimationExtension } from "pi-hush/animation-api";
export default createHushAnimationExtension(animation);
```

Declare `pi-hush` as a dependency or peer dependency of the animation package so the `pi-hush/animation-api` import resolves within that package's module graph; installing Hush separately from Git does not expose its modules to unrelated packages. The adapter uses the versioned discovery event internally. Drop-in files, repository built-ins, and published packages all use the same contract and automatically participate in selection and persistence.

Test renderers as pure functions at fixed and proportional widths. Assert visible width and row count rather than ANSI byte length or implementation details.

## Inspiration and alternative

Hush was inspired by [pi-calm](https://github.com/JesseZhang97/pi-calm), which remains a good alternative if you prefer its original presentation model.
