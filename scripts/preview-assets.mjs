#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execute = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREVIEW_PATH = resolve(ROOT, "docs/preview.html");
const ASSET_DIR = resolve(ROOT, "docs/assets");
const workDir = await mkdtemp(resolve(tmpdir(), "pi-hush-assets-"));
const frameRate = 10;

function loadPlaywright() {
  const localRequire = createRequire(import.meta.url);
  try {
    return localRequire("playwright");
  } catch (localError) {
    const packageJson = process.env.PREVIEW_PLAYWRIGHT_PACKAGE;
    if (!packageJson) {
      throw new Error(
        "Playwright is required to capture preview assets. Install it locally or set " +
          "PREVIEW_PLAYWRIGHT_PACKAGE to a package.json beside a Playwright install.",
        { cause: localError },
      );
    }
    return createRequire(resolve(packageJson))("playwright");
  }
}

async function runFfmpeg(args) {
  try {
    await execute(process.env.FFMPEG_BIN || "ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
      cwd: ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`ffmpeg failed: ${error.stderr || error.message}`, { cause: error });
  }
}

async function captureRegion(page, path) {
  // Element capture avoids padding every frame to a tall browser viewport.
  await page.locator("main").screenshot({ path, animations: "disabled" });
}

async function encodeGif(framePattern, output, colors) {
  await runFfmpeg([
    "-y",
    "-framerate",
    String(frameRate),
    "-i",
    framePattern,
    "-filter_complex",
    `[0:v]split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
      "[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    "-loop",
    "0",
    output,
  ]);
}

async function contactSheet(framePattern, output, every, scaleWidth) {
  await runFfmpeg([
    "-y",
    "-framerate",
    "1",
    "-i",
    framePattern,
    "-vf",
    `select='not(mod(n\\,${every}))',scale=${scaleWidth}:-2:flags=lanczos,tile=2x3`,
    "-frames:v",
    "1",
    output,
  ]);
}

await mkdir(ASSET_DIR, { recursive: true });
const { chromium } = loadPlaywright();
const launchOptions = process.env.PREVIEW_BROWSER_BIN
  ? { headless: true, executablePath: resolve(process.env.PREVIEW_BROWSER_BIN) }
  : { headless: true, channel: "chrome" };
const browser = await chromium.launch(launchOptions);

try {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const browserErrors = [];
  const network = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(pathToFileURL(PREVIEW_PATH).href);
  await page.waitForFunction(() => window.hushGallery?.inspect().frames.length === 7);

  await page.evaluate(() => {
    document.body.className = "asset-capture capture-animations";
    window.hushGallery.setLayout({ columns: 44, rows: 3, activity: "off", widthMode: "auto" });
  });
  const animationFrameCount = 140;
  for (let frame = 0; frame < animationFrameCount; frame += 1) {
    await page.evaluate((time) => window.hushGallery.setTime(time), frame * 100);
    await captureRegion(page, resolve(workDir, `animations-${String(frame).padStart(3, "0")}.png`));
    if (frame === 120) {
      await page.locator("main").screenshot({
        path: resolve(tmpdir(), "pi-hush-animations-frame.jpg"),
        type: "jpeg",
        quality: 90,
        animations: "disabled",
      });
    }
  }

  await page.setViewportSize({ width: 720, height: 680 });
  await page.evaluate(() => {
    document.body.className = "asset-capture capture-activity";
    const comparison = document.createElement("section");
    comparison.className = "activity-comparison";
    comparison.id = "activity-comparison";
    comparison.setAttribute("aria-label", "Activity placement comparison");
    document.querySelector("main")?.append(comparison);
  });
  const activityModes = ["status", "widget-left", "widget-right", "off"];
  const activityFrameCount = 80;
  for (let frame = 0; frame < activityFrameCount; frame += 1) {
    await page.evaluate(
      ({ modes, time }) => {
        const comparison = document.getElementById("activity-comparison");
        if (!comparison) throw new Error("activity comparison container is missing");
        comparison.replaceChildren();
        for (const activity of modes) {
          window.hushGallery.setTime(time);
          window.hushGallery.setLayout({
            columns: 54,
            rows: 3,
            activity,
            activityLabel: "Running read +2",
            widthMode: "auto",
          });
          const rendered = document.querySelector('.card[data-animation="flock"]');
          if (!rendered) throw new Error("rendered Flock card is missing");
          const clone = rendered.cloneNode(true);
          clone.classList.remove("focused");
          const label = document.createElement("span");
          label.className = "capture-label";
          label.textContent = `Activity · ${activity}`;
          clone.querySelector(".card-head")?.append(label);
          comparison.append(clone);
        }
      },
      { modes: activityModes, time: frame * 100 },
    );
    await captureRegion(page, resolve(workDir, `activity-${String(frame).padStart(3, "0")}.png`));
    if (frame === 60) {
      await page.locator("main").screenshot({
        path: resolve(tmpdir(), "pi-hush-activity-layouts-frame.jpg"),
        type: "jpeg",
        quality: 90,
        animations: "disabled",
      });
    }
  }

  await page.evaluate(() => {
    document.body.className = "";
    document.getElementById("activity-comparison")?.remove();
    window.hushGallery.setTime(6100);
    window.hushGallery.setLayout({
      columns: 54,
      rows: 3,
      activity: "status",
      activityLabel: "Working",
      widthMode: "auto",
    });
  });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.screenshot({
    path: resolve(tmpdir(), "pi-hush-preview-desktop.jpg"),
    type: "jpeg",
    quality: 90,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(tmpdir(), "pi-hush-preview-mobile.jpg"),
    type: "jpeg",
    quality: 90,
    fullPage: true,
    animations: "disabled",
  });

  if (browserErrors.length > 0 || network.length > 0) {
    throw new Error(
      `capture page was not clean: ${JSON.stringify({ browserErrors, network }, null, 2)}`,
    );
  }
  await context.close();

  await encodeGif(
    resolve(workDir, "animations-%03d.png"),
    resolve(ASSET_DIR, "animations.gif"),
    96,
  );
  await encodeGif(
    resolve(workDir, "activity-%03d.png"),
    resolve(ASSET_DIR, "activity-layouts.gif"),
    80,
  );
  await contactSheet(
    resolve(workDir, "animations-%03d.png"),
    resolve(tmpdir(), "pi-hush-animations-contact-sheet.png"),
    27,
    450,
  );
  await contactSheet(
    resolve(workDir, "activity-%03d.png"),
    resolve(tmpdir(), "pi-hush-activity-layouts-contact-sheet.png"),
    15,
    360,
  );
  console.log(
    "[preview-assets] wrote docs/assets/animations.gif, docs/assets/activity-layouts.gif, " +
      `and QA captures in ${tmpdir()}`,
  );
} finally {
  await browser.close();
  await rm(workDir, { recursive: true, force: true });
}
