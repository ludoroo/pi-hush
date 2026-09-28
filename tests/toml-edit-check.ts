import assert from "node:assert/strict";
import { parse } from "smol-toml";
import { updateTomlValues } from "../extensions/hush/lib/toml-edit.ts";

function parsed(source: string): Record<string, unknown> {
  return parse(source, { integersAsBigInt: "asNeeded" });
}

// Existing values are changed at their AST ranges without normalizing any other TOML.
const preserved = [
  "# keep this document exactly as written",
  String.raw`escaped = "\u03B1" # retain the escape, not merely its value`,
  "big = 9223372036854775807",
  "released = 1979-05-27T07:32:00Z",
  'message = """first',
  'second "quoted" line"""',
  "numbers = [",
  "  1, # one",
  "  2,",
  "]",
  "animations.wave.width = 12 # dotted existing value",
  "",
  String.raw`[animations."fish.\"雪"] # quoted arbitrary animation id`,
  "width = 5 # section value",
  "",
  "[[untouched]]",
  "name = 'one'",
  "",
].join("\n");
const preservedOutput = updateTomlValues(preserved, [
  { path: ["animations", "wave", "width"], value: "auto" },
  { path: ["animations", 'fish."雪', "width"], value: 37 },
]);
assert.equal(
  preservedOutput,
  preserved
    .replace("width = 12 # dotted", 'width = "auto" # dotted')
    .replace("width = 5 # section", "width = 37 # section"),
);
const preservedParsed = parsed(preservedOutput) as {
  animations: Record<string, { width: unknown }>;
};
assert.equal(preservedParsed.animations.wave!.width, "auto");
assert.equal(preservedParsed.animations['fish."雪']!.width, 37);
assert.match(preservedOutput, /escaped = "\\u03B1"/);
assert.match(preservedOutput, /big = 9223372036854775807/);
assert.match(preservedOutput, /released = 1979-05-27T07:32:00Z/);
assert.match(preservedOutput, /\[\[untouched\]\]/);

// Missing values go into the deepest real section, retaining inline and standalone comments.
const sectionSource = [
  "root = true",
  "",
  "[animations] # section comment",
  "# comment before existing value",
  "enabled = true # inline comment",
  "# trailing section comment",
  "",
  "[other]",
  "keep = \"yes\"",
  "",
].join("\n");
const sectionOutput = updateTomlValues(sectionSource, [
  { path: ["animations", "wave", "width"], value: 42 },
]);
assert.equal(
  sectionOutput,
  sectionSource.replace(
    "enabled = true # inline comment\n",
    "enabled = true # inline comment\nwave.width = 42\n",
  ),
);
assert.equal(
  ((parsed(sectionOutput).animations as Record<string, unknown>).wave as Record<
    string,
    unknown
  >).width,
  42,
);

// Standard-table and dotted-key subtrees can be reset to scalar values without
// losing comments or unrelated, even interleaved, sections.
const tableWidthSource = [
  "# document comment",
  "[animations.wave.width] # size table",
  "ratio = 0.6 # percent ratio",
  "minColumns = 2",
  "",
  "[animations.other] # unrelated animation",
  "enabled = true # keep enabled",
  "",
  "[animations.wave.width.constraints] # nested target table",
  "maximum = 80 # old maximum",
  "",
  "[other] # unrelated root section",
  "keep = true # keep root value",
  "",
].join("\n");
for (const replacement of [28, "auto"] as const) {
  const output = updateTomlValues(tableWidthSource, [
    { path: ["animations", "wave", "width"], value: replacement },
  ]);
  const result = parsed(output) as {
    animations: {
      wave: { width: unknown };
      other: { enabled: boolean };
    };
    other: { keep: boolean };
  };
  assert.equal(result.animations.wave.width, replacement);
  assert.equal(result.animations.other.enabled, true);
  assert.equal(result.other.keep, true);
  for (const comment of [
    "# document comment",
    "# size table",
    "# percent ratio",
    "# unrelated animation",
    "# keep enabled",
    "# nested target table",
    "# old maximum",
    "# unrelated root section",
    "# keep root value",
  ]) {
    assert.equal(output.includes(comment), true, `retains ${comment}`);
  }
}

const inlineWidthOutput = updateTomlValues(tableWidthSource, [
  {
    path: ["animations", "wave", "width"],
    value: { ratio: 0.75, minColumns: 3 },
  },
]);
const inlineWidthParsed = parsed(inlineWidthOutput) as {
  animations: { wave: { width: { ratio: number; minColumns: number } } };
};
assert.equal(inlineWidthParsed.animations.wave.width.ratio, 0.75);
assert.equal(inlineWidthParsed.animations.wave.width.minColumns, 3);
assert.match(inlineWidthOutput, /# size table/);
assert.match(inlineWidthOutput, /# old maximum/);

const dottedWidthSource = [
  "[animations.wave] # parent",
  "width.ratio = 0.6 # ratio",
  "unrelated = \"same\" # sibling",
  "width.minColumns = 2 # minimum",
  "",
].join("\n");
const dottedWidthOutput = updateTomlValues(dottedWidthSource, [
  { path: ["animations", "wave", "width"], value: "auto" },
]);
const dottedWidthParsed = parsed(dottedWidthOutput) as {
  animations: { wave: { width: unknown; unrelated: string } };
};
assert.equal(dottedWidthParsed.animations.wave.width, "auto");
assert.equal(dottedWidthParsed.animations.wave.unrelated, "same");
for (const comment of ["# parent", "# ratio", "# sibling", "# minimum"]) {
  assert.equal(dottedWidthOutput.includes(comment), true, `retains ${comment}`);
}

// Inline tables support exact replacement and insertion into nested missing paths.
const inlineSource =
  'settings = { animations = { "id.with.\\\"quote" = { speed = 1 }, existing.width = 2 }, untouched = "yes" } # tail\n';
const inlineOutput = updateTomlValues(inlineSource, [
  {
    path: ["settings", "animations", 'id.with."quote', "width"],
    value: { ratio: 0.75, labels: ["a", "雪", true] },
  },
  {
    path: ["settings", "animations", "existing", "width"],
    value: "auto",
  },
  {
    path: ["settings", "animations", "new.id", "width"],
    value: 18,
  },
]);
const inlineParsed = parsed(inlineOutput) as {
  settings: {
    animations: Record<string, { width: unknown }>;
    untouched: string;
  };
};
const inlineWidth = inlineParsed.settings.animations['id.with."quote']!
  .width as { ratio: number; labels: unknown[] };
assert.equal(inlineWidth.ratio, 0.75);
assert.deepEqual(inlineWidth.labels, ["a", "雪", true]);
assert.equal(inlineParsed.settings.animations.existing!.width, "auto");
assert.equal(inlineParsed.settings.animations["new.id"]!.width, 18);
assert.equal(inlineParsed.settings.untouched, "yes");
assert.match(inlineOutput, /speed = 1/);
assert.match(inlineOutput, /untouched = "yes"/);
assert.match(inlineOutput, /# tail/);

// A missing top-level section is represented safely by a dotted key before later sections.
const missingSectionSource = "# heading\n\n[other]\nvalue = 1\n";
const missingSectionOutput = updateTomlValues(missingSectionSource, [
  { path: ["hush", "animation", "width"], value: 25 },
]);
assert.equal(
  missingSectionOutput,
  '# heading\n\nhush.animation.width = 25\n[other]\nvalue = 1\n',
);
assert.equal(
  (((parsed(missingSectionOutput).hush as Record<string, unknown>)
    .animation as Record<string, unknown>).width),
  25,
);
assert.equal((parsed(missingSectionOutput).other as { value: number }).value, 1);

// Empty/comment-only documents and CRLF files keep the surrounding newline convention.
assert.equal(
  updateTomlValues("", [{ path: ["animation", "width"], value: "auto" }]),
  'animation.width = "auto"\n',
);
assert.equal(
  updateTomlValues("# only a comment", [
    { path: ["animation", "width"], value: 12 },
  ]),
  "# only a comment\nanimation.width = 12",
);
assert.equal(
  updateTomlValues("[animation]", [
    { path: ["animation", "width"], value: 12 },
  ]),
  "[animation]\nwidth = 12",
);
const crlf = "[animation]\r\nwidth = 10 # keep\r\n";
const crlfOutput = updateTomlValues(crlf, [
  { path: ["animation", "width"], value: 20 },
  { path: ["animation", "label"], value: "snow 雪" },
]);
assert.equal(
  crlfOutput,
  '[animation]\r\nwidth = 20 # keep\r\nlabel = "snow 雪"\r\n',
);
assert.equal(crlfOutput.replaceAll("\r\n", "").includes("\n"), false);
const crlfTableOutput = updateTomlValues(
  "[animation.width] # table\r\nratio = 0.5 # ratio\r\n",
  [{ path: ["animation", "width"], value: "auto" }],
);
assert.equal(
  (parsed(crlfTableOutput).animation as { width: unknown }).width,
  "auto",
);
assert.match(crlfTableOutput, /# table/);
assert.match(crlfTableOutput, /# ratio/);
assert.equal(crlfTableOutput.endsWith("\r\n"), true);
assert.equal(crlfTableOutput.replaceAll("\r\n", "").includes("\n"), false);
const noFinalNewlineOutput = updateTomlValues("[a]\r\nb = 1", [
  { path: ["a"], value: 2 },
]);
assert.equal(parsed(noFinalNewlineOutput).a, 2);
assert.equal(noFinalNewlineOutput.endsWith("\n"), false);
assert.equal(noFinalNewlineOutput.replaceAll("\r\n", "").includes("\n"), false);

// Invalid documents, paths, collisions, and non-JSON-compatible values reject atomically.
const unchanged = "value = 1\n";
for (const [name, source, updates] of [
  ["invalid source", "not = [valid", [{ path: ["value"], value: 2 }]],
  ["empty path", unchanged, [{ path: [], value: 2 }]],
  ["scalar prefix", "a = 1\n", [{ path: ["a", "b"], value: 2 }]],
  ["array table ambiguity", "[[a]]\nb = 1\n", [{ path: ["a", "c"], value: 2 }]],

  ["null", unchanged, [{ path: ["value"], value: null }]],
  ["undefined", unchanged, [{ path: ["value"], value: undefined }]],
  ["non-finite", unchanged, [{ path: ["value"], value: Infinity }]],
  ["unsafe integer", unchanged, [{ path: ["value"], value: 2 ** 60 }]],
  ["nested undefined", unchanged, [{ path: ["value"], value: [1, undefined] }]],
  [
    "later invalid update",
    unchanged,
    [
      { path: ["value"], value: 2 },
      { path: ["bad"], value: Number.NaN },
    ],
  ],
] as const) {
  const original = source;
  assert.throws(() => updateTomlValues(source, updates), name);
  assert.equal(source, original);
}

// A table itself is a logical value and can be replaced while retaining comments.
const tableAsValue = updateTomlValues("[a] # table\nb = 1 # old value\n", [
  { path: ["a"], value: 2 },
]);
assert.equal(parsed(tableAsValue).a, 2);
assert.match(tableAsValue, /# table/);
assert.match(tableAsValue, /# old value/);

// Spacing inside a table header is valid TOML and must not prevent replacing it.
const spacedHeader = updateTomlValues("[ animations.wave.width \t] # header\nratio = 0.6 # ratio\n", [
  { path: ["animations", "wave", "width"], value: "auto" },
]);
assert.equal(((parsed(spacedHeader).animations as Record<string, unknown>).wave as Record<string, unknown>).width, "auto");
assert.match(spacedHeader, /# header/);
assert.match(spacedHeader, /# ratio/);

// Implicit inline subtrees can be replaced without disturbing adjacent values.
for (const body of [
  "width.ratio = 0.6",
  "width.ratio = 0.6, keep = true",
  "keep = true, width.ratio = 0.6",
  'width.ratio = 0.6, keep = { text = "untouched" }, width.minColumns = 2',
  'before = true, width.ratio = 0.6, keep = "literal", width.minColumns = 2, after = false',
]) {
  const source = `settings = { ${body} } # tail\n`;
  const expected = parsed(source);
  (expected.settings as Record<string, unknown>).width = 28;
  const output = updateTomlValues(source, [{ path: ["settings", "width"], value: 28 }]);
  assert.deepEqual(parsed(output), expected);
  assert.match(output, /# tail/);
}

// Multiple valid edits are applied in memory and the final document remains parseable.
const multiple = updateTomlValues("a = 1\n", [
  { path: ["a"], value: 2 },
  { path: ["new", "quoted.key"], value: [1, "two", false] },
  { path: ["a"], value: 3 },
]);
assert.equal(multiple, 'a = 3\nnew."quoted.key" = [1, "two", false]\n');
const multipleParsed = parsed(multiple) as {
  a: number;
  new: Record<string, unknown>;
};
assert.equal(multipleParsed.a, 3);
assert.deepEqual(multipleParsed.new["quoted.key"], [1, "two", false]);

console.log("toml edit checks passed");
