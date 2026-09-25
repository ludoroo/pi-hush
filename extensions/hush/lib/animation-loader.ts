import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HushWorkingAnimation } from "./working-animation.ts";

const HUSH_ANIMATION_EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);
const HUSH_ANIMATION_INDEX_FILES = new Set([
  "index.ts",
  "index.mts",
  "index.js",
  "index.mjs",
]);

function isAnimationModule(name: string): boolean {
  return (
    HUSH_ANIMATION_EXTENSIONS.has(extname(name)) &&
    !name.endsWith(".d.ts") &&
    !name.endsWith(".d.mts")
  );
}

function classifyEntry(
  path: string,
  entry: {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  },
): "file" | "directory" | undefined {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  if (!entry.isSymbolicLink()) return undefined;
  try {
    const target = statSync(path);
    if (target.isFile()) return "file";
    if (target.isDirectory()) return "directory";
  } catch {
    // Broken links are ignored like missing files.
  }
  return undefined;
}

export type LoadedHushAnimation = {
  readonly animation: HushWorkingAnimation;
  readonly path: string;
};

/**
 * Find theme-like animation modules: files directly in a root, plus
 * one-level <name>/index.* modules so an animation can carry local assets.
 */
export function findHushAnimationFiles(roots: readonly string[]): string[] {
  const files: string[] = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = join(root, entry.name);
      const kind = classifyEntry(entryPath, entry);
      if (kind === "file" && isAnimationModule(entry.name)) {
        files.push(entryPath);
        continue;
      }
      if (kind !== "directory") continue;
      let children;
      try {
        children = readdirSync(entryPath, { withFileTypes: true });
      } catch {
        continue;
      }
      const index = children.find(
        (child) =>
          HUSH_ANIMATION_INDEX_FILES.has(child.name) &&
          classifyEntry(join(entryPath, child.name), child) === "file",
      );
      if (index) files.push(join(entryPath, index.name));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/** Load default-exported contracts. Querying by mtime avoids stale /reload imports. */
export async function loadHushAnimationFiles(
  paths: readonly string[],
): Promise<LoadedHushAnimation[]> {
  const loaded: LoadedHushAnimation[] = [];
  for (const path of paths) {
    const url = pathToFileURL(path);
    url.searchParams.set("hush", String(statSync(path).mtimeMs));
    const module = (await import(url.href)) as { default?: unknown };
    if (!module.default || typeof module.default !== "object") {
      throw new Error(`${path} must default-export one Hush animation contract`);
    }
    loaded.push({
      animation: module.default as HushWorkingAnimation,
      path,
    });
  }
  return loaded;
}
