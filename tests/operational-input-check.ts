import assert from "node:assert/strict";
import {
  classifyOperationalText,
  encodeHushHideInput,
  INVISIBLE_SEPARATOR,
  isOperationalInput,
  parseHiddenInputPrefixes,
} from "../extensions/hush/lib/operational-input.ts";

// Configuration is all-or-nothing and preserves valid prefixes exactly.
assert.deepEqual(parseHiddenInputPrefixes([]), []);
assert.deepEqual(
  parseHiddenInputPrefixes(["ops:", "  spaced  ", "通知：", "ops:"]),
  ["ops:", "  spaced  ", "通知："],
);
for (const invalid of [
  undefined,
  null,
  {},
  "ops:",
  '["ops:"]',
  ["ops:", 1],
  ["ops:", null],
  ["ops:", ""],
  ["ops:", "   "],
  ["ops:", "\n\t"],
  [new Date("2026-09-28")],
  Array(1),
]) {
  assert.throws(() => parseHiddenInputPrefixes(invalid), /array|nonblank/);
}

// The built-in Hush envelope remains available and requires a nonblank body.
const hidden = encodeHushHideInput("  watcher done  ");
assert.equal(hidden, `${INVISIBLE_SEPARATOR}HUSH_HIDE: watcher done`);
assert.equal(classifyOperationalText(hidden), "hush-hide");
assert.equal(isOperationalInput(hidden), true);
assert.throws(() => encodeHushHideInput(" \n\t "), /non-empty/);
for (const emptyEnvelope of [
  `${INVISIBLE_SEPARATOR}HUSH_HIDE:`,
  `${INVISIBLE_SEPARATOR}HUSH_HIDE:   `,
  `${INVISIBLE_SEPARATOR}HUSH_HIDE:\n\t`,
]) {
  assert.equal(classifyOperationalText(emptyEnvelope), undefined);
}

// Configured prefixes are literal, exact, case-sensitive startsWith matches.
const exactPrefixes = ["Ops: ", "  indented: ", "通知："];
for (const content of ["Ops: ", "Ops: done", "  indented: ", "通知：完了"]) {
  assert.equal(classifyOperationalText(content, exactPrefixes), "configured-prefix", content);
  assert.equal(isOperationalInput(content, exactPrefixes), true, content);
}
for (const content of [
  "ops: done",
  " Ops: done",
  "Ops:done",
  "indented: task",
  'quote: "Ops: done"',
  "ordinary text with Ops: embedded",
]) {
  assert.equal(classifyOperationalText(content, exactPrefixes), undefined, content);
  assert.equal(isOperationalInput(content, exactPrefixes), false, content);
}

// Defaults are generic: Firstmate-shaped input only hides when users configure it.
const broadFirstmatePrefix = `${INVISIBLE_SEPARATOR}FIRSTMATE_OP: v1 `;
const knownFirstmate = `${broadFirstmatePrefix}watcher: done`;
const futureFirstmate = `${broadFirstmatePrefix}new-kind: done`;
assert.equal(classifyOperationalText(knownFirstmate), undefined);
assert.equal(classifyOperationalText(`[fm-from-firstmate]${INVISIBLE_SEPARATOR}done`), undefined);
assert.equal(classifyOperationalText(knownFirstmate, [broadFirstmatePrefix]), "configured-prefix");
assert.equal(classifyOperationalText(futureFirstmate, [broadFirstmatePrefix]), "configured-prefix");
assert.equal(
  classifyOperationalText(futureFirstmate, [`${broadFirstmatePrefix}watcher:`]),
  undefined,
);
assert.equal(
  classifyOperationalText(knownFirstmate, [`${broadFirstmatePrefix}watcher:`]),
  "configured-prefix",
);

// Regex/control-looking characters have no special meaning.
const literalPrefix = "^ops.*[hidden]$";
assert.equal(classifyOperationalText(`${literalPrefix} remainder`, [literalPrefix]), "configured-prefix");
assert.equal(classifyOperationalText("ops anything hidden", [literalPrefix]), undefined);

// Invalid prefixes supplied directly are ignored rather than matching everything.
for (const content of ["ordinary content", "", "   "]) {
  assert.equal(classifyOperationalText(content, ["", " ", "\n\t"]), undefined);
  assert.equal(isOperationalInput(content, ["", " ", "\n\t"]), false);
}

console.log("operational-input checks passed");
