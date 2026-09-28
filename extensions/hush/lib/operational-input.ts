/**
 * Pure TypeScript operational-input configuration and classification.
 *
 * Classification is presentation-only. Messages are never rewritten.
 */

export const INVISIBLE_SEPARATOR = "\u2063";

const HUSH_HIDE_PREFIX = `${INVISIBLE_SEPARATOR}HUSH_HIDE:`;

/**
 * Validate an all-or-nothing list of literal prefixes from configuration.
 *
 * Prefix text is preserved exactly. Duplicate entries are removed while
 * retaining their first position.
 */
export function parseHiddenInputPrefixes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("hidden input prefixes must be an array");
  }
  const prefixes = new Set<string>();
  for (const prefix of value) {
    if (typeof prefix !== "string" || prefix.trim().length === 0) {
      throw new TypeError("hidden input prefixes must be nonblank strings");
    }
    prefixes.add(prefix);
  }
  return [...prefixes];
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

/** Classify a built-in Hush envelope or a configured literal prefix. */
export function classifyOperationalText(
  content: string,
  prefixes: readonly string[] = [],
): "hush-hide" | "configured-prefix" | undefined {
  if (content.startsWith(HUSH_HIDE_PREFIX)) {
    const body = content.slice(HUSH_HIDE_PREFIX.length).trimStart();
    if (body) return "hush-hide";
  }

  for (const prefix of prefixes) {
    if (
      typeof prefix === "string" &&
      prefix.trim().length > 0 &&
      content.startsWith(prefix)
    ) {
      return "configured-prefix";
    }
  }

  return undefined;
}

/** True when the text is an operational input Hush may zero-height. */
export function isOperationalInput(
  text: string,
  prefixes: readonly string[] = [],
): boolean {
  return classifyOperationalText(text, prefixes) !== undefined;
}
