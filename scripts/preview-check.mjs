import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BUILT_IN_HUSH_ANIMATIONS } from "../extensions/hush/animations/index.ts";
import {
  normalizeHushWidgetFrame,
  renderHushAnimation,
  resolveHushAnimationHeight,
  resolveHushAnimationWidth,
  resolveHushWidgetLayout,
} from "../extensions/hush/lib/animation.ts";
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREVIEW_PATH = resolve(ROOT, "docs/preview.html");
const ASSETS = [
  resolve(ROOT, "docs/assets/animations.gif"),
  resolve(ROOT, "docs/assets/activity-layouts.gif"),
];

function loadPlaywright() {
  const localRequire = createRequire(import.meta.url);
  try {
    return localRequire("playwright");
  } catch (localError) {
    const packageJson = process.env.PREVIEW_PLAYWRIGHT_PACKAGE;
    if (!packageJson) {
      throw new Error(
        "Playwright is required for preview checks. Install it locally or set " +
          "PREVIEW_PLAYWRIGHT_PACKAGE to a package.json beside a Playwright install.",
        { cause: localError },
      );
    }
    return createRequire(resolve(packageJson))("playwright");
  }
}

function expectedFrames(time, config) {
  const palette = Object.fromEntries(
    ["accent", "secondary", "tertiary", "highlight", "muted"].map((role) => [
      role,
      (text) => text,
    ]),
  );
  const activityEnabled = config.activity !== "off";
  const activityPlacement = config.activity === "off" ? "status" : config.activity;
  const layout = resolveHushWidgetLayout(
    config.columns,
    activityEnabled,
    activityPlacement,
  );
  return BUILT_IN_HUSH_ANIMATIONS.map((animation) => {
    const width = resolveHushAnimationWidth(
      config.widthMode === "full" ? { ratio: 1 } : animation.width,
      layout.animationAvailableWidth,
    );
    const height = resolveHushAnimationHeight(animation, width, config.rows * 8);
    const frame = Math.floor(time / animation.intervalMs);
    const elapsedMs = frame * animation.intervalMs;
    const rows =
      width === 0
        ? []
        : renderHushAnimation(
            animation,
            { frame, elapsedMs, width, height, viewportWidth: config.columns },
            palette,
          );
    const activityLabel = stripTerminalSequences(truncateToWidth(
      config.activityLabel,
      layout.activityWidth,
      "",
    ));
    const activityCell = activityLabel +
      " ".repeat(Math.max(0, layout.activityWidth - visibleWidth(activityLabel)));
    const blankActivityCell = " ".repeat(layout.activityWidth);
    const gap = " ".repeat(layout.gapWidth);
    const lines = normalizeHushWidgetFrame(rows, width, height).map(
      (animationLine, row) => {
        const label = row === 0 ? activityCell : blankActivityCell;
        const body = config.activity === "widget-left"
          ? label + gap + animationLine
          : config.activity === "widget-right"
            ? animationLine + gap + label
            : animationLine;
        return (" ".repeat(layout.indent) + body).padEnd(config.columns, " ");
      },
    );
    return { id: animation.id, width, height, frame, elapsedMs, rows: lines, error: null };
  });
}

await access(PREVIEW_PATH);
function gifInfo(bytes) {
  assert.match(bytes.subarray(0, 6).toString("ascii"), /^GIF8[79]a$/);
  let frames = 0;
  let durationMs = 0;
  for (let index = 0; index < bytes.length - 7; index += 1) {
    if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9 && bytes[index + 2] === 0x04) {
      frames += 1;
      durationMs += bytes.readUInt16LE(index + 4) * 10;
    }
  }
  return {
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
    frames,
    durationMs,
  };
}

let combinedAssetBytes = 0;
const assetInfo = [];
for (const asset of ASSETS) {
  const details = await stat(asset);
  assert.ok(details.size > 0, `${asset} must not be empty`);
  combinedAssetBytes += details.size;
  assetInfo.push(gifInfo(await readFile(asset)));
}
assert.ok(combinedAssetBytes < 4 * 1024 * 1024, "preview GIFs must remain below 4 MiB combined");
assert.ok(assetInfo[0].durationMs >= 13_500, "animation showcase must cover the full 14-second loop");
assert.ok(assetInfo[1].durationMs >= 7_500, "activity comparison must include a useful flight sample");
assert.ok(assetInfo[0].frames >= 130, "animation showcase must preserve real-time motion detail");
assert.ok(assetInfo[1].frames >= 70, "activity comparison must preserve real-time motion detail");
assert.equal(BUILT_IN_HUSH_ANIMATIONS.length, 7, "the gallery documents all built-ins");

const { chromium } = loadPlaywright();
const launchOptions = process.env.PREVIEW_BROWSER_BIN
  ? { headless: true, executablePath: resolve(process.env.PREVIEW_BROWSER_BIN) }
  : { headless: true, channel: "chrome" };
const browser = await chromium.launch(launchOptions);
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const network = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(pathToFileURL(PREVIEW_PATH).href);
  await page.waitForFunction(() => window.hushGallery?.inspect().frames.length === 7);

  assert.equal(await page.locator(".card").count(), 7);
  assert.equal(await page.locator("h1").textContent(), "Hush animation gallery");
  const initial = await page.evaluate(() => window.hushGallery.inspect());
  assert.equal(initial.config.activity, "status", "preview should use status activity by default");
  assert.equal(initial.config.activityLabel, "Working", "preview should use Hush's default busy label");
  let comparisons = 0;
  for (const columns of [2, 10, 18, 19, 20, 24, 26, 54, 96]) {
    for (const rows of [1, 2, 3]) {
      for (const activity of ["off", "status", "widget-left", "widget-right"]) {
        for (const widthMode of ["auto", "full"]) {
          const config = { columns, rows, activity, widthMode, activityLabel: "Working" };
          for (const time of [0, 1234, 6100, 13_200]) {
            const actual = await page.evaluate(
              ({ nextConfig, nextTime }) => {
                window.hushGallery.setTime(nextTime);
                window.hushGallery.setLayout(nextConfig);
                return window.hushGallery.inspect().frames;
              },
              { nextConfig: config, nextTime: time },
            );
            assert.deepEqual(actual, expectedFrames(time, config), JSON.stringify({ config, time }));
            comparisons += actual.length;
          }
        }
      }
    }
  }

  await page.evaluate(() => {
    window.hushGallery.setTime(6100);
    window.hushGallery.setLayout({ columns: 54, rows: 3, activity: "off", widthMode: "auto" });
  });
  await page.locator('.card[data-animation="cat-ball"] .expand').click();
  assert.equal(await page.locator(".card.focused").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".card.focused").count(), 0);

  await page.locator("summary").click();
  await page.locator("#columns-number").fill("");
  await page.locator("#columns-number").pressSequentially("100");
  assert.equal((await page.evaluate(() => window.hushGallery.inspect())).config.columns, 100);
  await page.locator("#columns-number").fill("32");
  await page.locator("#activity").selectOption("widget-right");
  await page.locator("#activity-label").selectOption("Running read +2");
  const relabelled = await page.evaluate(() => window.hushGallery.inspect());
  assert.equal(relabelled.elapsedMs, 6100);
  assert.equal(relabelled.config.activityLabel, "Running read +2");
  assert.deepEqual(
    relabelled.frames,
    expectedFrames(6100, {
      columns: 32,
      rows: 3,
      activity: "widget-right",
      activityLabel: "Running read +2",
      widthMode: "auto",
    }),
  );
  await page.locator("#theme").selectOption("paper");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "paper");
  await page.locator("#theme").selectOption("rose");
  await page.locator("#font-size").selectOption("22");
  assert.equal(
    await page.locator(".drawing").first().evaluate((element) => getComputedStyle(element).fontSize),
    "22px",
  );
  await page.locator("#font-size").selectOption("16");
  await page.locator("#restart").click();
  assert.equal((await page.evaluate(() => window.hushGallery.inspect())).elapsedMs, 0);
  await page.locator("#play").click();
  await page.waitForFunction(() => window.hushGallery.inspect().elapsedMs > 150);
  await page.locator("#play").click();
  assert.equal((await page.evaluate(() => window.hushGallery.inspect())).playing, false);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "preview must not overflow a mobile viewport",
  );
  await context.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 800, height: 700 },
    reducedMotion: "reduce",
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(pathToFileURL(PREVIEW_PATH).href);
  await reducedPage.waitForFunction(() => window.hushGallery?.inspect().frames.length === 7);
  assert.equal((await reducedPage.evaluate(() => window.hushGallery.inspect())).playing, false);
  assert.match(await reducedPage.locator("#motion-note").textContent(), /reduced motion/i);
  await reducedContext.close();

  // Display fitting must not change terminal geometry, and expansion must keep
  // its heading/control visible even with reduced motion and scroll anchoring.
  for (const reducedMotion of ["reduce", "no-preference"]) {
    for (const width of [375, 1280]) {
      const fitContext = await browser.newContext({
        viewport: { width, height: 812 },
        reducedMotion,
      });
      const fitPage = await fitContext.newPage();
      fitPage.on("pageerror", (error) => errors.push(error.message));
      await fitPage.goto(pathToFileURL(PREVIEW_PATH).href);
      await fitPage.evaluate(() => {
        window.hushGallery.setTime(6100);
        window.hushGallery.setLayout({ columns: 54, activity: "widget-left", rows: 3 });
      });
      const fits = () => [...document.querySelectorAll(".theatre")].every((stage) => {
        const drawing = stage.querySelector(".drawing").getBoundingClientRect();
        const bounds = stage.getBoundingClientRect();
        const padding = getComputedStyle(stage);
        return drawing.left >= bounds.left &&
          drawing.right <= bounds.right - parseFloat(padding.paddingRight) + 1 &&
          stage.scrollWidth <= stage.clientWidth + 1;
      });
      await fitPage.waitForFunction(fits);
      const before = await fitPage.evaluate(() => window.hushGallery.inspect());
      const catCard = fitPage.locator('.card[data-animation="cat-ball"]');
      await catCard.scrollIntoViewIfNeeded();
      await catCard.locator('.expand').click();
      await fitPage.waitForFunction(() => {
        const card = document.querySelector('.card[data-animation="cat-ball"].focused');
        if (!card) return false;
        const toolbar = document.querySelector(".controls").getBoundingClientRect();
        const heading = card.querySelector("h2").getBoundingClientRect();
        const button = card.querySelector(".expand").getBoundingClientRect();
        return heading.top >= toolbar.bottom && button.top >= toolbar.bottom && button.bottom <= innerHeight;
      });
      await fitPage.waitForFunction(fits);
      // Inherited font/width transitions can fit transiently, then grow offscreen
      // over subsequent paints. The settled layout must still fit.
      await fitPage.evaluate(async () => {
        for (let frame = 0; frame < 6; frame += 1) {
          await new Promise(requestAnimationFrame);
        }
      });
      assert.ok(await fitPage.evaluate(fits), `Canvas overflow after expansion settled (${width}px, ${reducedMotion})`);
      const after = await fitPage.evaluate(() => window.hushGallery.inspect());
      assert.deepEqual(after, before, "Preview fitting/expansion must preserve renderer state and frames");
      await fitContext.close();
    }
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(network, []);
  console.log(
    `Preview checks passed: ${comparisons} exact renderer comparisons, controls, ` +
      "reduced motion, mobile canvas fitting, expansion visibility, offline network, and console.",
  );
} finally {
  await browser.close();
}
