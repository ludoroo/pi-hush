/**
 * Pure TypeScript operational-input classifier.
 *
 * Compatible with Firstmate's wire form so existing operational rows hide under
 * Hush, plus a simple general marker any extension can use:
 *
 *   Firstmate current:
 *     U+2063 FIRSTMATE_OP: v1 <kind>: <body>
 *     [fm-from-firstmate]U+2063<body>
 *
 *   General (standalone):
 *     U+2063HUSH_HIDE: <body>
 *
 * Classification is presentation-only. Messages are never rewritten.
 */

export const INVISIBLE_SEPARATOR = "\u2063";

export const FIRSTMATE_CURRENT_OPERATIONAL_KINDS = [
  "session-start",
  "watcher",
  "turn-end-guard",
  "away-supervisor",
  "from-firstmate",
  "launch-brief",
] as const;

export type FirstmateCurrentOperationalKind =
  (typeof FIRSTMATE_CURRENT_OPERATIONAL_KINDS)[number];

const FIRSTMATE_OP_PREFIX = `${INVISIBLE_SEPARATOR}FIRSTMATE_OP: v1 `;
const FROM_FIRSTMATE_PREFIX = `[fm-from-firstmate]${INVISIBLE_SEPARATOR}`;
const HUSH_HIDE_PREFIX = `${INVISIBLE_SEPARATOR}HUSH_HIDE:`;

const CURRENT_KIND_SET = new Set<string>(FIRSTMATE_CURRENT_OPERATIONAL_KINDS);

function isCurrentKind(kind: string): kind is FirstmateCurrentOperationalKind {
  return CURRENT_KIND_SET.has(kind);
}

/**
 * Encode a general Hush-hide operational user message.
 * Delivery remains an ordinary user-role message; Hush only hides its row.
 */
export function encodeHushHideInput(body: string): string {
  const text = body.trim();
  if (!text) throw new Error("hush hide body must be non-empty");
  return `${HUSH_HIDE_PREFIX} ${text}`;
}

/**
 * Encode a Firstmate-compatible operational input.
 */
export function encodeFirstmateOperationalInput(
  kind: FirstmateCurrentOperationalKind,
  body: string,
): string {
  const text = body.trim();
  if (!text) throw new Error("operational body must be non-empty");
  if (kind === "from-firstmate") {
    return `${FROM_FIRSTMATE_PREFIX}${text}`;
  }
  if (!isCurrentKind(kind)) {
    throw new Error(`unsupported operational kind: ${kind}`);
  }
  return `${FIRSTMATE_OP_PREFIX}${kind}: ${text}`;
}

/**
 * Return a current Firstmate kind, "hush-hide", or undefined.
 * Only used for presentation classification.
 */
export function classifyOperationalText(content: string): string | undefined {
  if (!content.includes(INVISIBLE_SEPARATOR)) return undefined;

  if (content.startsWith(HUSH_HIDE_PREFIX)) {
    const body = content.slice(HUSH_HIDE_PREFIX.length).trimStart();
    return body ? "hush-hide" : undefined;
  }

  if (content.startsWith(FIRSTMATE_OP_PREFIX)) {
    const remainder = content.slice(FIRSTMATE_OP_PREFIX.length);
    const sep = remainder.indexOf(": ");
    if (sep <= 0) return undefined;
    const kind = remainder.slice(0, sep);
    const body = remainder.slice(sep + 2);
    if (!body || !isCurrentKind(kind) || kind === "from-firstmate") {
      return undefined;
    }
    return kind;
  }

  if (content.startsWith(FROM_FIRSTMATE_PREFIX) && content.length > FROM_FIRSTMATE_PREFIX.length) {
    return "from-firstmate";
  }

  return undefined;
}

/** True when the text is a text-only operational envelope Hush may zero-height. */
export function isOperationalInput(text: string): boolean {
  return classifyOperationalText(text) !== undefined;
}
