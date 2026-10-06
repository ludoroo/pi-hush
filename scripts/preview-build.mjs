#!/usr/bin/env bun

import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof Bun === "undefined") {
  throw new Error("The preview builder requires Bun (run: bun scripts/preview-build.mjs).");
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_PATH = resolve(ROOT, "docs/preview/app.ts");
const TEMPLATE_PATH = resolve(ROOT, "docs/preview/page.html");
const OUTPUT_PATH = resolve(ROOT, "docs/preview.html");
const ANIMATION_API_PATH = resolve(ROOT, "extensions/hush/lib/animation.ts");
const PLACEHOLDER = "__GALLERY_SCRIPT__";
const checkOnly = process.argv.includes("--check");
const workDir = await mkdtemp(join(tmpdir(), "pi-hush-preview-"));
const shimPath = join(workDir, "animation-api.mjs");

const extractAnimationApi = String.raw`
const api = await import(process.argv[1]);
const identity = {};
const payload = {
  defineHushWorkingAnimation: api.defineHushWorkingAnimation.toString(),
  resolveHushAnimationWidth: api.resolveHushAnimationWidth.toString(),
  resolveHushAnimationHeight: api.resolveHushAnimationHeight.toString(),
  HUSH_ANIMATION_ROW_BUDGET: api.HUSH_ANIMATION_ROW_BUDGET,
  HUSH_LOADER_INDENT: api.HUSH_LOADER_INDENT,
  checks: {
    identity: api.defineHushWorkingAnimation(identity) === identity,
    fixedWidth: api.resolveHushAnimationWidth(12, 8),
    proportionalWidth: api.resolveHushAnimationWidth(
      { ratio: 0.5, minColumns: 4, maxColumns: 20 },
      30,
    ),
    multiRowHeight: api.resolveHushAnimationHeight(
      { maxHeight: 9, minWidthForMultiRow: 12 },
      20,
      32,
    ),
    narrowHeight: api.resolveHushAnimationHeight(
      { maxHeight: 9, minWidthForMultiRow: 12 },
      11,
      32,
    ),
  },
};
process.stdout.write(JSON.stringify(payload));
`;

function fail(message) {
  throw new Error(`[preview-builder] ${message}`);
}

function decode(data) {
  return new TextDecoder().decode(data);
}

async function generateApiShim() {
  const extraction = Bun.spawnSync({
    cmd: [
      process.execPath.includes("bun") ? "node" : process.execPath,
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      extractAnimationApi,
      pathToFileURL(ANIMATION_API_PATH).href,
    ],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (extraction.exitCode !== 0) {
    fail(`could not inspect the animation API:\n${decode(extraction.stderr).trim()}`);
  }

  let api;
  try {
    api = JSON.parse(decode(extraction.stdout));
  } catch (error) {
    fail(`animation API inspection returned invalid JSON: ${error.message}`);
  }
  for (const name of [
    "defineHushWorkingAnimation",
    "resolveHushAnimationWidth",
    "resolveHushAnimationHeight",
  ]) {
    if (typeof api[name] !== "string" || !api[name].startsWith("function ")) {
      fail(`actual animation API did not expose ${name} as a function`);
    }
  }
  if (!Number.isInteger(api.HUSH_ANIMATION_ROW_BUDGET) || !Number.isInteger(api.HUSH_LOADER_INDENT)) {
    fail("actual animation API constants were not integers");
  }

  const shim = [
    "// Generated at build time from the real Hush animation API.",
    `export const HUSH_ANIMATION_ROW_BUDGET = ${JSON.stringify(api.HUSH_ANIMATION_ROW_BUDGET)};`,
    `export const HUSH_LOADER_INDENT = ${JSON.stringify(api.HUSH_LOADER_INDENT)};`,
    `export ${api.defineHushWorkingAnimation}`,
    `export ${api.resolveHushAnimationWidth}`,
    `export ${api.resolveHushAnimationHeight}`,
    "export class HushAnimationRegistry {",
    "  #animations = new Map();",
    "  constructor(animations = []) { for (const animation of animations) this.register(animation); }",
    "  register(animation) { this.#animations.set(animation.id, animation); }",
    "  list() { return [...this.#animations.values()]; }",
    "  get(id) { return this.#animations.get(id); }",
    "}",
    "",
  ].join("\n");
  await writeFile(shimPath, shim);
  return api;
}

function animationApiRedirectPlugin() {
  return {
    name: "preview-animation-api-redirect",
    setup(build) {
      // Import specifiers are relative to each source file, so match the stable API filename.
      build.onResolve({ filter: /[/\\]animation\.ts$/ }, () => ({
        path: shimPath,
      }));
    },
  };
}

async function bundle() {
  const result = await Bun.build({
    entrypoints: [APP_PATH],
    target: "browser",
    format: "iife",
    minify: true,
    plugins: [animationApiRedirectPlugin()],
  });
  if (!result.success) {
    fail(`browser bundle failed:\n${result.logs.map((log) => log.message).join("\n")}`);
  }
  if (result.outputs.length !== 1) {
    fail(`expected one browser bundle, received ${result.outputs.length}`);
  }
  return result.outputs[0].text();
}

try {
  const api = await generateApiShim();
  const [script, template] = await Promise.all([bundle(), readFile(TEMPLATE_PATH, "utf8")]);
  const placeholderCount = template.split(PLACEHOLDER).length - 1;
  if (placeholderCount !== 1) {
    fail(`page template must contain exactly one ${PLACEHOLDER} placeholder`);
  }
  const embeddedScript = script.replace(/<\/script/gi, "<\\/script");
  const generated = template
    .replace("<!doctype html>", "<!doctype html>\n<!-- Generated by scripts/preview-build.mjs; edit docs/preview/ instead. -->")
    .replace(PLACEHOLDER, () => embeddedScript);

  if (checkOnly) {
    let current;
    try {
      current = await readFile(OUTPUT_PATH, "utf8");
    } catch {
      fail("docs/preview.html is missing; regenerate it with bun scripts/preview-build.mjs");
    }
    if (current !== generated) {
      fail("docs/preview.html is stale; regenerate it with bun scripts/preview-build.mjs");
    }
    console.log(
      `[preview-builder] current: ${Buffer.byteLength(generated)} bytes; ` +
        `API parity ${JSON.stringify(api.checks)}`,
    );
  } else {
    const temporaryOutput = join(dirname(OUTPUT_PATH), ".preview.html.tmp");
    await writeFile(temporaryOutput, generated);
    await rename(temporaryOutput, OUTPUT_PATH);
    console.log(
      `[preview-builder] wrote ${OUTPUT_PATH} (${Buffer.byteLength(script)} bundled JS bytes, ` +
        `${Buffer.byteLength(generated)} HTML bytes)`,
    );
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}
