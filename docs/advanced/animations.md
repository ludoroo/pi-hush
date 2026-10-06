# Custom working animations

A Hush animation is one default-exported JavaScript or TypeScript object. Hush owns discovery, selection, timing, theme colors, clipping, resizing, widget lifecycle, and cleanup; the animation only describes or computes semantic text frames.

Use a drop-in file for a personal or project animation. Use the public package adapter when publishing an animation as a separate Pi package.

## Drop-in discovery

Put a module in either location:

```text
~/.pi/agent/hush/animations/*.ts       # available in every project
<project>/.pi/hush/animations/*.ts     # available only in a trusted project
```

Hush accepts `.ts`, `.mts`, `.js`, and `.mjs`. It also discovers one-level modules such as `animations/comet/index.ts`, which can keep relative helpers or assets beside their entrypoint. Hidden files and deeper directory layouts are ignored.

Run `/hush animation` to rescan and choose the animation, or run `/reload`. A project-local module executes code, so Hush scans that location only when Pi trusts the project.

## Minimal frame animation

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

No Hush import, renderer registration, timer, widget, or Pi API call is required. For multiple colors in one row, return segments:

```ts
{
  segments: [
    { text: "·", color: "muted" },
    { text: "•", color: "secondary" },
    { text: "●", color: "highlight" },
  ],
}
```

Recorded frames advance in array order and loop. An omitted segment `color` means `accent`.

## Procedural animation

Use `kind: "procedural"` and `renderFrame()` when artwork depends on width, height, or playback time:

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

`renderFrame()` receives this context:

| Field | Meaning |
| --- | --- |
| `width` | Allocated drawing columns after proportional sizing, bounds, inset, and activity reservation. |
| `height` | Allocated drawing rows after animation and terminal limits. |
| `viewportWidth` | Full widget width before the one-column inset and activity reservation. |
| `elapsedMs` | Active mounted playback time, sampled on timer ticks. |
| `frame` | `floor(elapsedMs / intervalMs)`. |

Return the same semantic frame shapes accepted by recorded animations: one row, one segmented row, or a `rows` object.

## Multi-row frames

Both animation kinds can return rows:

```ts
{
  rows: [
    { text: "   .", color: "muted" },
    {
      segments: [
        { text: "><", color: "secondary" },
        { text: "(o)>", color: "accent" },
      ],
    },
    { text: "" }, // an explicit blank row retains its position
  ],
}
```

Set `maxHeight` to the preferred canvas height. Contracts may declare from 1 through 10 rows, but playback has a strict three-row cap and additionally budgets at most `max(1, floor(terminalRows / 8))`. For example, a three-row animation receives only one row in a seven-row terminal and at most two in a 16-row terminal.

Set `minWidthForMultiRow` to a positive column count when narrow layouts should request a one-row rendition. A procedural renderer should actively draw a smaller variant when space is tight rather than depending on clipping.

The optional `placement` field accepts `"aboveEditor"` or `"belowEditor"`; omission places the widget above the editor.

Hush top-left clips overflow, pads every allocated row and column, and keeps the canvas height stable so short frames cannot make the editor jump. Recorded frames are not trimmed or recentered per frame.

## Width contract

A fixed width requests content columns:

```ts
width: 12
```

A proportional width is resolved against available animation space:

```ts
width: { ratio: 0.35, minColumns: 8, maxColumns: 32 }
```

`ratio` must be greater than 0 and at most 1. Optional bounds must be positive integer columns, and the minimum cannot exceed the maximum. Use `{ ratio: 1 }` to consume all available animation columns.

Hush resolves animation width against the widget's full available width; activity text is rendered separately through Pi's native working-status divider. A user's per-animation width setting replaces the animation's authored width and bounds. See [Configuration](../configuration.md#width-values).

[`shooting-star.ts`](../../extensions/hush/animations/shooting-star.ts) is a useful full-width, responsive example.

## Timing and resize behavior

`intervalMs` is a positive, uniform tick interval. Per-frame durations, editor-style layers, and grids are not part of the contract.

Hush tracks animation time with a monotonic clock. Missed timer ticks catch up rather than slowing playback, and resizing or theme changes do not advance or reset the phase. Playback pauses while the widget is unmounted and resumes from its last displayed position. Each animation ID retains its own playback state during the session.

Use `elapsedMs` for a fixed-duration procedural loop and `frame` for simple discrete motion. Resizing should choose a rendition for the new area while preserving the same phase.

## Theme colors

Animation text uses semantic roles, which Hush maps through the active Pi theme on every frame:

| Role | Pi theme token |
| --- | --- |
| `accent` | `accent` |
| `secondary` | `syntaxVariable` |
| `tertiary` | `syntaxFunction` |
| `highlight` | `warning` |
| `muted` | `muted` |

Procedural code does not receive the palette and should not emit ANSI or otherwise styled terminal strings. Return plain text plus semantic color names; Hush paints it and picks up theme changes automatically.

## Contract validation and terminal safety

Every animation needs:

- an ID matching `[a-z0-9][a-z0-9_-]*`, unique across discovered animations;
- nonblank `label` and `description` strings;
- a positive finite `intervalMs`, a valid width, and an integer `maxHeight` from 1 through 10; and
- either a nonempty valid `frames` array or a `renderFrame()` function.

Frames reject unsupported color roles, rows beyond the declared height, and terminal control or directional-formatting characters. A broken drop-in is reported and skipped without preventing other animations from loading. If a procedural renderer fails during playback, Hush reports it, uses a fallback, and allows a retry after an explicit rescan.

Prefer predictable single-column glyphs. ASCII such as `.`, `o`, `O`, `@`, `*`, and `-` is safest. Emoji, variation selectors, zero-width joiners, combining marks, and East Asian ambiguous-width symbols vary across terminals. Built-ins intentionally using Braille, blocks, circles, or neutral-width text stars are covered by visible-width tests, but font rendering can still differ.

The authoritative contract is [`lib/animation.ts`](../../extensions/hush/lib/animation.ts). Shared rendering helpers used by repository animations live under [`extensions/hush/lib/`](../../extensions/hush/lib/), while the built-in registry and implementations live under [`extensions/hush/animations/`](../../extensions/hush/animations/).

## Publish an animation package

A published animation uses the same object contract. Make the package's Pi extension entrypoint a one-line adapter around its animation:

```ts
// index.ts
import animation from "./animation.ts";
import { createHushAnimationExtension } from "pi-hush/animation-api";

export default createHushAnimationExtension(animation);
```

Register that entrypoint in the animation package's `package.json`:

```json
{
  "name": "pi-hush-pulse",
  "version": "0.1.0",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": { "extensions": ["./index.ts"] },
  "peerDependencies": { "pi-hush": "^0.2.0" }
}
```

Declare `pi-hush` as a dependency or peer dependency so `pi-hush/animation-api` resolves inside the animation package's module graph. Installing Hush separately is not a substitute for declaring this dependency in the animation package.

The public [`animation-api.ts`](../../animation-api.ts) exports the contract types, `defineHushWorkingAnimation`, width/height resolvers, constants, and `createHushAnimationExtension`. The adapter participates in Hush's versioned synchronous discovery event; package load order does not matter because Pi loads extension factories before `session_start`.

For typed authoring inside a package, `defineHushWorkingAnimation` preserves literal fields while checking the contract:

```ts
import { defineHushWorkingAnimation } from "pi-hush/animation-api";

export default defineHushWorkingAnimation({
  kind: "frames",
  id: "pulse",
  label: "Pulse",
  description: "A quiet two-frame pulse",
  intervalMs: 180,
  width: 1,
  maxHeight: 1,
  frames: [
    { text: "·", color: "muted" },
    { text: "•", color: "accent" },
  ],
});
```

Test frame order, semantic colors, visible terminal width, and row count—not ANSI byte length or private host implementation details.

## Built-in examples and fish artwork

The built-in registry is [`animations/index.ts`](../../extensions/hush/animations/index.ts). Its implementations demonstrate compact recorded frames, proportional widths, Braille sub-cells, fixed-time procedural loops, multi-row fallbacks, and semantic color grouping.

The fish is an original compact interpretation inspired by [CameronFoxly's Fish Loop](https://ascii-motion.app/community/project/424d1127-7ab4-449a-ac73-a543524a4141), not an import or scaled copy of its 60×30 artwork. See [`fish-loop.ts`](../../extensions/hush/animations/fish-loop.ts).
