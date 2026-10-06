# Development

pi-hush is a Pi extension with a small public animation API. Runtime code is TypeScript loaded directly by Pi; there is no build step for ordinary local development.

## Repository layout

```text
animation-api.ts                  # public API for packaged animations
extensions/hush/
  index.ts                        # extension lifecycle and /hush command
  animations/
    index.ts                      # built-in registry and default selection
    wave.ts, bars.ts, ...          # built-in animation contracts/renderers
  lib/
    config.ts                     # optional TOML settings and atomic persistence
    toml-edit.ts                   # comment-preserving targeted TOML edits
    visibility.ts                 # presentation policy and published state
    assistant-layout.ts           # thinking/CoT presentation adapter
    tool-execution-layout.ts      # tool-row presentation adapter
    operational-input.ts          # Hush envelope and prefix classification
    operational-user-layout.ts    # operational user-row adapter
    animation.ts                  # animation contract, registry, widget host
    animation-loader.ts           # global/project drop-in discovery
    animation-settings.ts         # per-animation width settings
    animation-preference.ts       # selected-ID resolution
    activity.ts                   # live activity lifecycle and labels
    animation-cells.ts            # semantic-color cell grouping
    braille.ts                    # theme-colored sub-cell rendering
tests/
  *-check.ts                      # executable behavior checks
docs/
  configuration.md               # full optional TOML reference
  development.md                 # this guide
  advanced/                      # custom animations and message prefixes
  preview/                       # editable gallery HTML and TypeScript
  preview.html                   # generated, self-contained offline gallery
  assets/                        # generated README GIFs
scripts/
  preview-*.mjs                  # gallery build, capture, and parity checks
```

The important boundaries are:

1. `index.ts` translates Pi lifecycle events and commands into state changes.
2. `config.ts` owns durable preferences; UI changes are applied only after a successful save.
3. Presentation adapters alter rendering, never delivery or session data.
4. `animation.ts` owns animation validation, sizing, timing, painting, and widget cleanup.
5. Built-ins, drop-in modules, and packaged animations all meet the same animation contract.

See [Custom working animations](advanced/animations.md) for the extension contract and [Configuration](configuration.md) for persistence behavior.

## Install dependencies

From the repository root:

```sh
npm install --ignore-scripts
```

The checks import Pi packages as well as Hush's TOML dependencies, so run them only after dependencies are installed.

## Run validation

Each test file is an executable Node TypeScript check:

```sh
node --experimental-strip-types tests/self-check.ts
```

Run the complete local suite with:

```sh
for test in tests/*-check.ts; do
  echo "==> $test"
  node --experimental-strip-types "$test" || exit 1
done
```

With TypeScript installed, check the runtime, tests, and browser gallery together:

```sh
tsc --noEmit --strict --allowImportingTsExtensions \
  --moduleResolution bundler --module preserve --target es2022 --skipLibCheck \
  animation-api.ts extensions/hush/index.ts tests/*.ts docs/preview/app.ts
```

The checks use temporary directories for configuration scenarios. When adding tests, prefer behavior, public interfaces, and durable invariants such as visible width or row count over ANSI byte length and private implementation details.

## Regenerate the previews

The README GIFs and offline gallery use the actual built-in animation renderers. The gallery build extracts its sizing helpers from the runtime API; browser parity checks compare the displayed frames with Hush's terminal rendering and composition.

Requirements: **Bun, Node with TypeScript stripping, ffmpeg, Playwright, and Chrome**. Install the browser automation dependency for local development if needed:

```sh
npm install --no-save --no-package-lock --ignore-scripts playwright
```

Edit `docs/preview/app.ts` or `docs/preview/page.html`, not the generated `docs/preview.html`. After changing gallery sources or animation renderers, regenerate and check all outputs:

```sh
bun scripts/preview-build.mjs
node scripts/preview-assets.mjs
bun scripts/preview-build.mjs --check
node --experimental-strip-types scripts/preview-check.mjs
```

The capture script writes `docs/assets/animations.gif` and `docs/assets/activity-layouts.gif`. Open `docs/preview.html` directly in a browser to explore the gallery; it needs no server or network connection.

If Playwright is already installed in another project, set `PREVIEW_PLAYWRIGHT_PACKAGE` to that project's absolute `package.json` path. `PREVIEW_BROWSER_BIN` can point to a Chrome/Chromium executable, and `FFMPEG_BIN` can override the ffmpeg executable. The scripts use a separate headless browser and do not touch your normal browser profile or clipboard.

## Smoke-test in Pi

Use a temporary Hush configuration path so Hush commands cannot modify your normal Hush settings:

```sh
scratch="$(mktemp -d)"
PI_HUSH_CONFIG_PATH="$scratch/config.toml" \
  pi -e ./extensions/hush/index.ts
```

Inside Pi, exercise `/hush on`, `/hush off`, `/hush animation`, `/hush width`, `/hush activity`, export/share behavior, resize handling, and `/reload`. Project-local animation discovery also requires the project to be trusted.

## Pi runtime integration

Hush is presentation-only, but Pi does not currently expose one global transcript filter. Hush therefore probes and patches three specific rendering seams:

- `AssistantMessageComponent.updateContent` for thinking blocks,
- `ToolExecutionComponent.render` for all built-in and user-defined tool rows, and
- `InteractiveMode.addMessageToChat` for eligible operational user rows.

Each adapter installs independently. If a future Pi release removes a seam, Hush logs a diagnostic and skips only that adapter; commands and unaffected presentation continue working. There is no numeric version gate. The current integration is verified against Pi **0.85.1 and 0.87.0**.

The tool-row patch is necessary because Pi tool ownership is first-wins: wrapping `registerTool()` alone would miss tools owned by another extension. Working animations use `setWidget()` for the animation-only widget and Pi's native working message for activity labels in the editor divider. Hush suppresses Pi's spinner while the animation is active; Escape remains Pi's interrupt mechanism. When Hush is disabled or no animation can run, Pi's default working presentation is restored.

`/export` and `/share` briefly restore stock rendering so serialized output remains complete. Hush never removes tool execution, results, model context, or persisted messages.

## Known runtime limits

Because no global transcript filter exists, these remain visible while Hush is active:

- user-bash rows (`!` and `!!`);
- skill, compaction, and branch-summary rows;
- custom messages and entries emitted by other extensions; and
- generic system, cache, and command notices.

Pi also does not expose ownership or getters for working-row visibility and widgets. If another extension writes the same visibility or widget surface, the last configuration wins. Hush does not reset another extension's custom working indicator or message.

For operational user rows, only user-role content made entirely of text blocks is eligible. Image-bearing messages and custom message types remain on Pi's normal rendering path. See [Hidden operational-message prefixes](advanced/message-prefixes.md).

## Release checklist

Publishing is a separate, explicit step; preview generation and packaging checks never publish anything.

1. Run the runtime tests and preview checks, then inspect `npm pack --dry-run --ignore-scripts`. The package includes the GIFs, self-contained gallery, and guides—not development sources, user settings, or Git metadata.
2. Ensure the GitHub repository is public before publishing. Keep README images under `docs/assets/`, linked with absolute `https://raw.githubusercontent.com/ludoroo/pi-hush/main/…` URLs; link guides with absolute `https://github.com/ludoroo/pi-hush/blob/main/…` URLs. These links follow `main` and let the same README work on GitHub and npm without depending on an npm CDN. Verify the images and guides without GitHub authentication, and check the npm page after publication.
3. Keep the `pi-package` keyword and the `pi.extensions` manifest in `package.json`; these make the npm package discoverable and loadable by Pi. Set `pi.image` to the public animation preview URL for the package gallery. Remove any pending-publication note from the README in the release commit.
4. Create an annotated release tag matching the package version on the final release commit, and verify that it identifies the exact code being published. Do not move an already-published release tag to different code.

## Change guidelines

- Keep presentation logic separate from execution and persistence.
- Preserve comment-aware, read-before-write configuration behavior and refuse to overwrite invalid files.
- Validate custom animation input at registry boundaries and keep terminal output theme-semantic and control-sequence free.
- Add targeted behavior checks for the public seam being changed, then run the complete local suite.
- Test compatibility probes and degraded behavior without depending on a real user configuration file.
