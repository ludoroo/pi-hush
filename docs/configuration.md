# Configuration

Hush works without a configuration file. Every setting is optional, and omitted settings use the defaults below.

## File location

The default path is:

```text
~/.pi/agent/hush/config.toml
```

Set `PI_HUSH_CONFIG_PATH` before starting Pi to use a different file:

```sh
PI_HUSH_CONFIG_PATH=/absolute/path/to/hush.toml pi
```

Hush reads one TOML 1.0 document. After editing it by hand, run `/reload` so the extension and restored transcript use the new settings.

## Complete schema

This example shows every day-to-day setting. The optional schema version is described below and deliberately omitted:

```toml
enabled = true
thinking = false
animation = "flock"

[activity]
enabled = true
placement = "status"

[transcript]
hidden_input_prefixes = []

# Width overrides are keyed by animation ID.
[animations.wave]
width = 28

[animations.flock]
width = "60%"

[animations.shooting-star]
width = { ratio = 1.0, minColumns = 12, maxColumns = 72 }
```

Available settings:

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | integer | `1` | Configuration schema version. Omission means version 1. |
| `enabled` | boolean | `true` | Whether Hush presentation is active. |
| `thinking` | boolean | `false` | Whether thinking/CoT is shown while Hush is active. |
| `animation` | string | `"flock"` | Selected animation ID. IDs start with a lowercase letter or digit and then contain lowercase letters, digits, `_`, or `-`. |
| `activity.enabled` | boolean | `true` | Show concise live activity text. |
| `activity.placement` | `"status"`, `"widget-left"`, or `"widget-right"` | `"status"` | Render activity in Pi's working status or beside the widget animation. |
| `transcript.hidden_input_prefixes` | array of nonblank strings | `[]` | Literal prefixes whose text-only user rows Hush may hide. See [Message prefixes](advanced/message-prefixes.md). |
| `animations.<id>.width` | width value | authored animation default | Override one animation's drawing width. |

Unknown animation IDs and unrelated values are retained when a command edits a known setting. A configured animation that is not currently available falls back to `flock` for that session.

## Activity layout

`activity.placement = "status"` sends the live label to Pi's native working message. Pi renders it in the editor's top divider while Hush's widget remains animation-only and can use the full available animation width.

`"widget-left"` and `"widget-right"` hide Pi's working row and render the label on that side of Hush's animation. Widget text is stripped of terminal/control sequences, restricted to one line, and truncated with an ellipsis in a responsive activity column of at most 24 cells. When fewer than eight cells are available, Hush gives the full line to the animation instead of showing an unreadable fragment. The column's size depends only on terminal width—not label content—so transitions such as **Working** to **Running read +2** preserve widget geometry, animation playback, and editor position.

Disabling activity text hides Pi's entire working-status row while Hush's animation runs; turning Hush off restores Pi's default working presentation. Custom editor extensions that do not support Pi's embedded working status may render `status` as a separate status row instead.

Use the same values from the command line:

```text
/hush activity status
/hush activity widget-left
/hush activity widget-right
```

A placement command changes only placement; it does not enable activity text or Hush. The former `activity.position` key and `/hush activity left|right` commands are not part of this schema. If an old `position` key is present, Hush treats it as an unrelated unknown value and preserves it when editing known settings.

## Width values

A width controls the animation's **drawing area**; it does not zoom terminal characters.

Use one of these forms:

```toml
[animations.wave]
width = 28                                  # fixed terminal columns

[animations.flock]
width = "60%"                               # proportion of available animation space

[animations.cat-ball]
width = { ratio = 0.6, minColumns = 12, maxColumns = 48 }

[animations.bars]
width = "auto"                              # use the animation's authored width
```

The rules are:

- Fixed widths are positive integer columns.
- Percentages are greater than `0%` and at most `100%`.
- In a bounded width, `ratio` is greater than `0` and at most `1`; `minColumns` and `maxColumns`, when present, are positive integers, with the minimum no greater than the maximum.
- Available animation space is what remains after Hush's one-column inset and, for widget activity, its stable activity column and one-cell gap. The host finally clamps the result to the space that actually remains.
- An override replaces the animation's authored preferred width and bounds. `"auto"` removes that override and follows the authored width again.

The equivalent commands apply only to the currently selected animation:

```text
/hush width 28
/hush width 60%
/hush width auto
```

Bare `/hush width` reports the selected animation's current override or authored default. Width commands do not enable Hush or activity text.

## How commands save

`/hush` commands and manual configuration share this one file.

- Before an edit, Hush rereads the current file and changes only the requested fields.
- Existing comments, formatting around untouched values, unrelated values, and settings for unknown animation IDs are preserved.
- A real change is written atomically. Parent directories are created when needed, and a newly created file is private to the user (`0600`).
- Reading a missing file, loading Hush, and commands that make no effective change do not create a file.
- A valid configuration symlink remains a symlink: Hush atomically updates its resolved target. A dangling symlink is treated as an unreadable configuration, not as a missing file.

Some commands intentionally affect only their own setting. For example, changing activity placement does not turn activity text on, and changing width does not change Hush, thinking, or activity state.

## Invalid files and failed saves

If the file is malformed, unreadable, has an unsupported version, or contains an invalid value, Hush:

1. warns with the file path and error,
2. uses all defaults for that load, including no custom hidden-input prefixes, and
3. leaves the file untouched.

Commands refuse to overwrite an invalid file. If reading or saving fails, the command leaves the active setting unchanged and reports a warning. Fix the file, then run `/reload`.

Hush reads configuration while the extension loads, before a restored transcript is drawn, and applies it again at `session_start`. Use `/reload` after any manual edit; a running session does not watch the file for changes.
