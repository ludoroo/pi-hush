# pi-hush

**Keep the conversation. Quiet the tool chatter.**

Hush gives [Pi](https://pi.dev) a calmer terminal view: your prompts and the assistant's replies stay visible, while tool calls, tool results, and thinking blocks stay out of the way. A small, theme-aware animation and live activity label let you see that work is still happening.

![The seven Hush animations: flock, wave, bars, jumping dots, shooting star, fish loop, and cat and ball.](https://raw.githubusercontent.com/ludoroo/pi-hush/main/docs/assets/animations.gif)

- **Quiet, not disconnected.** See when Pi is working, thinking, responding, or running tools—without a screenful of tool output.
- **Made for the terminal.** Seven text-only animations use your Pi theme, adapt to narrow panes, and take at most three rows. No image protocols or background processes.
- **Firstmate compatibility.** [Opt in with message-prefix rules](https://github.com/ludoroo/pi-hush/blob/main/docs/advanced/message-prefixes.md#firstmate-recipe) to hide its operational user rows.
- **Presentation only.** Tools still run, the model still receives their results, and session history stays complete. `/hush off` restores the ordinary transcript; exports and shares retain the hidden content.

## Make it yours

Hush starts with **flock**, with **activity text on the left**. Choose an animation with `/hush animation`, or select one directly—for example, `/hush animation cat-ball`.

**Built-ins:** `flock` · `wave` · `bars` · `jumping-dots` · `shooting-star` · `fish-loop` · `cat-ball`.

### Activity on either side—or none

![Three flock layouts with activity text on the left, on the right, and switched off.](https://raw.githubusercontent.com/ludoroo/pi-hush/main/docs/assets/activity-layouts.gif)

```text
/hush activity left      # status before the animation (default)
/hush activity right     # status after the animation
/hush activity           # toggle status text
```

Labels follow what Pi reports: **Working…**, **Thinking…**, **Responding…**, or **Running read…**. Parallel tools get a compact summary such as **Running read +2…**. Thinking is shown only when the provider reports a thinking block; otherwise Hush says Working.

Activity text gets priority in narrow panes. The animation shrinks first, and changing the width or text position doesn't restart playback.

Want to try different widths, layouts, and colours? Open `docs/preview.html` from the installed package, or save the [gallery HTML](https://github.com/ludoroo/pi-hush/blob/main/docs/preview.html) and open it in your browser. It runs offline using Hush's actual renderers. Terminal fonts and your Pi theme may look a little different from the previews.

## Install

```sh
pi install npm:pi-hush
```

> The first npm release is being prepared; the package is not published yet.

Restart Pi or run `/reload`. Hush is on immediately—no configuration file required.

## Everyday controls

| Command | What it does |
| --- | --- |
| `/hush on` · `/hush off` | Use Hush or restore Pi's ordinary transcript |
| `/hush thinking` | Toggle visible thinking while keeping tool chatter hidden |
| `/hush animation` | Choose an animation |
| `/hush width 28` · `/hush width 60%` | Set the selected animation's drawing width |
| `/hush width auto` | Return that animation to its natural sizing |

Pi offers argument completion after `/hush `. Animation and thinking commands turn Hush on; `/hush activity` also turns Hush on when toggling text. Width and activity-position commands leave the on/off state alone.

Widths are drawing space, not zoom. A percentage uses the space left after the activity label. Width preferences are saved per animation; activity settings apply to all of them.

## Configuration

Use the commands above, or edit **`~/.pi/agent/hush/config.toml`**:

```toml
animation = "flock"

[activity]
enabled = true
position = "left"
```

Those are the defaults. **The file and every field are optional**, including `version`; you don't need to add it. Hush is on and thinking is hidden unless you choose otherwise.

Commands save changes to the same file while preserving comments and unrelated settings. Your preferences live outside the installed plugin, so updates leave them alone. After editing the file manually, run `/reload`.

See the [configuration reference](https://github.com/ludoroo/pi-hush/blob/main/docs/configuration.md) for all settings, width limits, and custom file locations.

## Good to know

Hush quiets conversation tool rows, not every possible Pi surface. User-bash output, summaries, system notices, and third-party custom messages can remain visible. Extensions that replace the same working indicator may conflict.

Hush changes display—not execution, model context, or stored messages. It is **not a redaction or privacy filter**.

## Go further

- [Create your own animation](https://github.com/ludoroo/pi-hush/blob/main/docs/advanced/animations.md)—frames, procedural renderers, and animation packages.
- [Hide operational message prefixes](https://github.com/ludoroo/pi-hush/blob/main/docs/advanced/message-prefixes.md)—custom headers, the Hush marker, and Firstmate configuration.
- [Development guide](https://github.com/ludoroo/pi-hush/blob/main/docs/development.md)—source layout, local testing, and preview generation.

## Inspiration

Inspired by [pi-calm](https://github.com/JesseZhang97/pi-calm), another way to make Pi's presentation quieter.
