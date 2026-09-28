import { parse as parseToml } from "smol-toml";
import { parseTOML, type AST } from "toml-eslint-parser";

export interface TomlValueUpdate {
  readonly path: readonly string[];
  readonly value: unknown;
}

type StringPath = readonly string[];

type Container =
  | {
      readonly kind: "root";
      readonly path: readonly [];
      readonly node: AST.TOMLTopLevelTable;
    }
  | {
      readonly kind: "table";
      readonly path: StringPath;
      readonly node: AST.TOMLTable;
    }
  | {
      readonly kind: "inline";
      readonly path: StringPath;
      readonly node: AST.TOMLInlineTable;
    };

interface LocatedDocument {
  readonly values: ReadonlyArray<{
    readonly path: StringPath;
    readonly node: AST.TOMLKeyValue;
  }>;
  readonly containers: readonly Container[];
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/u;

function basicString(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("TOML strings cannot contain an unpaired surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("TOML strings cannot contain an unpaired surrogate");
    }
  }

  // JSON string escapes are also TOML basic-string escapes. JSON leaves DEL
  // literal, while TOML forbids it, so handle that one additional code point.
  return JSON.stringify(value).replaceAll("\u007f", "\\u007F");
}

function serializeKey(key: string): string {
  return BARE_KEY.test(key) ? key : basicString(key);
}

function serializeValue(value: unknown, active: Set<object>): string {
  if (typeof value === "string") return basicString(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("TOML update numbers must be finite");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError("TOML update integers must be safe JavaScript integers");
    }
    if (Object.is(value, -0)) return "-0.0";
    return String(value);
  }
  if (value === null || typeof value !== "object") {
    throw new TypeError("TOML updates must contain non-null JSON values");
  }
  if (active.has(value)) {
    throw new TypeError("TOML updates cannot contain cyclic values");
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serializeValue(item, active)).join(", ")}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("TOML update records must be plain objects");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("TOML update records cannot have symbol keys");
    }

    const fields = Object.keys(value as Record<string, unknown>).map((key) => {
      const item = (value as Record<string, unknown>)[key];
      return `${serializeKey(key)} = ${serializeValue(item, active)}`;
    });
    return `{ ${fields.join(", ")} }`;
  } finally {
    active.delete(value);
  }
}

function validateDocument(source: string): AST.TOMLProgram {
  const document = parseTOML(source, { tomlVersion: "1.0" });
  parseToml(source, { integersAsBigInt: "asNeeded" });
  return document;
}

function keyParts(key: AST.TOMLKey): string[] {
  return key.keys.map((part) =>
    part.type === "TOMLBare" ? part.name : part.value,
  );
}

function locateDocument(document: AST.TOMLProgram): LocatedDocument {
  const top = document.body[0];
  const values: Array<{ path: StringPath; node: AST.TOMLKeyValue }> = [];
  const containers: Container[] = [{ kind: "root", path: [], node: top }];

  const visitValue = (prefix: StringPath, node: AST.TOMLKeyValue): void => {
    const path = [...prefix, ...keyParts(node.key)];
    values.push({ path, node });
    if (node.value.type !== "TOMLInlineTable") return;

    containers.push({ kind: "inline", path, node: node.value });
    for (const child of node.value.body) visitValue(path, child);
  };

  for (const node of top.body) {
    if (node.type === "TOMLKeyValue") {
      visitValue([], node);
      continue;
    }

    if (
      node.kind === "standard" &&
      node.resolvedKey.every((part): part is string => typeof part === "string")
    ) {
      containers.push({ kind: "table", path: node.resolvedKey, node });
    }
    const prefix = node.resolvedKey;
    for (const value of node.body) {
      if (prefix.every((part): part is string => typeof part === "string")) {
        visitValue(prefix, value);
      }
    }
  }

  return { values, containers };
}

function pathsEqual(left: StringPath, right: StringPath): boolean {
  return left.length === right.length && left.every((part, i) => part === right[i]);
}

function isStrictPrefix(prefix: StringPath, path: StringPath): boolean {
  return (
    prefix.length < path.length &&
    prefix.every((part, index) => part === path[index])
  );
}

function pathsOverlapAsSubtrees(left: StringPath, right: StringPath): boolean {
  return (
    pathsEqual(left, right) ||
    isStrictPrefix(left, right) ||
    isStrictPrefix(right, left)
  );
}

function assertNoArrayTableAmbiguity(
  document: AST.TOMLProgram,
  path: StringPath,
): void {
  for (const node of document.body[0].body) {
    if (node.type !== "TOMLTable" || node.kind !== "array") continue;
    const logicalPath = node.resolvedKey.filter(
      (part): part is string => typeof part === "string",
    );
    if (pathsOverlapAsSubtrees(logicalPath, path)) {
      throw new TypeError("TOML array-table updates are ambiguous");
    }
  }
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

function positionAfterLine(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline === -1 ? source.length : newline + 1;
}

function insertLine(
  source: string,
  position: number,
  line: string,
  eol: string,
): string {
  const atLineStart = position === 0 || source[position - 1] === "\n";
  const before = atLineStart ? "" : eol;
  const after = position === source.length && source.length > 0 && !atLineStart
    ? ""
    : eol;
  return `${source.slice(0, position)}${before}${line}${after}${source.slice(position)}`;
}

function insertIntoContainer(
  source: string,
  container: Container,
  relativePath: StringPath,
  serializedValue: string,
  eol: string,
): string {
  const assignment = `${relativePath.map(serializeKey).join(".")} = ${serializedValue}`;

  if (container.kind === "inline") {
    const close = container.node.range[1] - 1;
    if (source[close] !== "}") {
      throw new Error("Unexpected inline-table AST range");
    }
    if (container.node.body.length === 0) {
      const open = container.node.range[0];
      const spacing = source.slice(open + 1, close);
      const addition = spacing.length === 0
        ? ` ${assignment} `
        : assignment;
      return `${source.slice(0, close)}${addition}${source.slice(close)}`;
    }

    let position = close;
    while (position > container.node.range[0] && /[ \t]/u.test(source[position - 1]!)) {
      position -= 1;
    }
    return `${source.slice(0, position)}, ${assignment}${source.slice(position)}`;
  }

  if (container.kind === "table") {
    const anchor = container.node.body.at(-1);
    const offset = anchor?.range[1] ?? container.node.key.range[1];
    return insertLine(source, positionAfterLine(source, offset), assignment, eol);
  }

  const rootValues = container.node.body.filter(
    (node): node is AST.TOMLKeyValue => node.type === "TOMLKeyValue",
  );
  const lastValue = rootValues.at(-1);
  if (lastValue) {
    return insertLine(
      source,
      positionAfterLine(source, lastValue.range[1]),
      assignment,
      eol,
    );
  }

  const firstTable = container.node.body.find(
    (node): node is AST.TOMLTable => node.type === "TOMLTable",
  );
  if (firstTable) {
    return insertLine(source, lineStart(source, firstTable.range[0]), assignment, eol);
  }
  return insertLine(source, source.length, assignment, eol);
}

function replaceDeclaredSubtree(
  source: string,
  located: LocatedDocument,
  path: StringPath,
  serializedValue: string,
  eol: string,
): string | undefined {
  const tables = located.containers.filter(
    (container): container is Extract<Container, { kind: "table" }> =>
      container.kind === "table" &&
      (pathsEqual(path, container.path) || isStrictPrefix(path, container.path)),
  );
  const descendantValues = located.values.filter((value) =>
    isStrictPrefix(path, value.path),
  );
  if (tables.length === 0 && descendantValues.length === 0) return undefined;

  // Implicit dotted keys inside inline tables need comma-aware replacement.
  // Preserve the original spelling and separators of all surviving entries.
  const removableValues = descendantValues.filter(
    (value) => value.node.parent.type !== "TOMLInlineTable",
  );
  const implicitInlineValue = descendantValues.find(
    (value) =>
      value.node.parent.type === "TOMLInlineTable" &&
      !removableValues.some(
        (parent) =>
          parent.node.range[0] <= value.node.range[0] &&
          value.node.range[1] <= parent.node.range[1],
      ),
  );
  if (implicitInlineValue) {
    const parent = located.containers.find(
      (container): container is Extract<Container, { kind: "inline" }> =>
        container.kind === "inline" && container.node === implicitInlineValue.node.parent,
    );
    if (!parent || !isStrictPrefix(parent.path, path)) {
      throw new Error("Unable to locate the owning inline table");
    }
    const members = parent.node.body;
    const owned = members.map((node) => isStrictPrefix(path, [...parent.path, ...keyParts(node.key)]));
    const firstOwned = owned.indexOf(true);
    if (firstOwned === -1) throw new Error("Unable to locate the inline subtree");
    const assignment = `${path.slice(parent.path.length).map(serializeKey).join(".")} = ${serializedValue}`;
    let body = "";
    for (let index = 0; index < members.length; index += 1) {
      if (owned[index] && index !== firstOwned) continue;
      const member = members[index]!;
      if (index > 0) {
        body += source.slice(members[index - 1]!.range[1], member.range[0]);
      }
      body += index === firstOwned ? assignment : source.slice(...member.range);
    }
    return `${source.slice(0, members[0]!.range[0])}${body}${source.slice(members.at(-1)!.range[1])}`;
  }

  const ranges: Array<readonly [number, number]> = removableValues.map(
    (value) => value.node.range,
  );
  for (const table of tables) {
    let headerEnd = table.node.key.range[1];
    while (source[headerEnd] === " " || source[headerEnd] === "\t") headerEnd += 1;
    headerEnd += 1;
    if (source[table.node.range[0]] !== "[" || source[headerEnd - 1] !== "]") {
      throw new Error("Unexpected standard-table AST range");
    }
    ranges.push([table.node.range[0], headerEnd]);
  }

  let withoutSubtree = source;
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
    withoutSubtree = `${withoutSubtree.slice(0, start)}${withoutSubtree.slice(end)}`;
  }

  const remaining = validateDocument(withoutSubtree);
  const remainingLocated = locateDocument(remaining);
  const container = remainingLocated.containers
    .filter((candidate) => isStrictPrefix(candidate.path, path))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (!container) throw new Error("Unable to locate a TOML insertion point");
  const replaced = insertIntoContainer(
    withoutSubtree,
    container,
    path.slice(container.path.length),
    serializedValue,
    eol,
  );
  if (source.length > 0 && !source.endsWith("\n") && replaced.endsWith(eol)) {
    return replaced.slice(0, -eol.length);
  }
  return replaced;
}

/**
 * Update TOML values while retaining every source byte outside the requested
 * value ranges and newly inserted assignments.
 */
export function updateTomlValues(
  source: string,
  updates: readonly TomlValueUpdate[],
): string {
  let document = validateDocument(source);
  const prepared = updates.map((update) => {
    if (
      update.path.length === 0 ||
      update.path.some((part) => typeof part !== "string")
    ) {
      throw new TypeError("TOML update paths must contain at least one string");
    }
    return {
      path: [...update.path],
      value: serializeValue(update.value, new Set<object>()),
    };
  });

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let output = source;
  for (const update of prepared) {
    assertNoArrayTableAmbiguity(document, update.path);
    const located = locateDocument(document);
    const existing = located.values.find((value) =>
      pathsEqual(value.path, update.path),
    );
    if (existing) {
      const [start, end] = existing.node.value.range;
      output = `${output.slice(0, start)}${update.value}${output.slice(end)}`;
    } else {
      const replaced = replaceDeclaredSubtree(
        output,
        located,
        update.path,
        update.value,
        eol,
      );
      if (replaced !== undefined) {
        output = replaced;
      } else {
        const container = located.containers
          .filter((candidate) => isStrictPrefix(candidate.path, update.path))
          .sort((left, right) => right.path.length - left.path.length)[0];
        if (!container) throw new Error("Unable to locate a TOML insertion point");
        output = insertIntoContainer(
          output,
          container,
          update.path.slice(container.path.length),
          update.value,
          eol,
        );
      }
    }
    document = validateDocument(output);
  }

  return output;
}
