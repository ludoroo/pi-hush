# Hidden operational-message prefixes

Hush can hide text-only user rows that carry operational messages from another extension. This is a **presentation rule only**: matching messages still reach the model, remain in session history, and reappear when Hush is off. Exports and shares retain their original content.

This feature is not a privacy boundary, redaction mechanism, or execution filter.

## Built-in Hush envelope

The built-in envelope starts with an invisible separator (`U+2063`) followed by the literal marker `HUSH_HIDE:`:

```text
<U+2063>HUSH_HIDE: <nonblank body>
```

`<U+2063>` denotes the character, not those literal eight characters. There is no space between the invisible separator and `HUSH_HIDE:`. A valid encoded value is equivalent to:

```ts
"\u2063HUSH_HIDE: watcher: task finished"
```

An integration can send the envelope as an ordinary user message:

```ts
pi.sendUserMessage("\u2063HUSH_HIDE: watcher: task finished", {
  deliverAs: "followUp",
});
```

The marker itself is the interoperability contract. Hush's [`encodeHushHideInput()` reference implementation](../../extensions/hush/lib/operational-input.ts) trims the supplied body, rejects an empty body, and adds the marker; repository code can import it using the path appropriate to that module.

The envelope does not depend on custom prefix configuration. `HUSH_HIDE:` without the leading invisible separator does not match, and the marker must be followed by a nonblank body.

## Configure literal prefixes

Add `hidden_input_prefixes` to the `[transcript]` table in Hush's [configuration file](../configuration.md):

```toml
[transcript]
hidden_input_prefixes = ["[automation] ", "robot:status:"]
```

If the file already contains `[transcript]`, add or replace the key inside that table rather than declaring a second `[transcript]` table. Run `/reload` after saving.

Matching follows exact, literal rules:

- Matching is case-sensitive and starts at the first character of the message.
- Hush does not trim or normalize either the configured prefix or message.
- Characters with regular-expression meaning have no special behavior.
- A message exactly equal to a configured prefix matches.
- A quoted or embedded prefix does not match unless it begins the actual message text.
- Duplicate configured prefixes are harmless; Hush keeps their first occurrence internally.

Choose a distinctive prefix. Text you type yourself is subject to the same rule and will also be hidden while Hush is active.

## Eligible message types

Prefix and envelope rules apply only to user-role messages containing text and no non-text blocks. A plain string or a message made entirely of text blocks is eligible.

These rules do **not** hide:

- image-bearing user messages,
- assistant messages,
- custom messages or custom entries, or
- text where the prefix appears anywhere other than the beginning.

Eligibility changes only how Pi lays out the row. Delivery, role, ordering, editor history, model context, and persisted session data are unchanged.

## Validation and warnings

An omitted `hidden_input_prefixes` setting or an empty array means no custom prefixes. Every array member must be a nonblank string.

If the value is not an array, any member is invalid, or the overall TOML file cannot be read and validated, Hush warns and uses configuration defaults for that load. That disables the entire custom-prefix list; it does not partially apply valid entries. The built-in Hush envelope continues to work. Hush never repairs or rewrites the invalid file—fix it and run `/reload`.

## Firstmate recipe

To hide Firstmate's marked operational user rows, add both prefixes to the existing Hush configuration, then run `/reload`:

```toml
[transcript]
hidden_input_prefixes = [
  "\u2063FIRSTMATE_OP: v1 ",
  "[fm-from-firstmate]\u2063",
]
```

TOML double-quoted strings decode `\u2063` into the required invisible separator. Single-quoted TOML strings would keep the backslash characters literally and therefore would not match.

The broad `FIRSTMATE_OP: v1 ` prefix covers every kind under that header, including kinds added later. To hide only watcher inputs, use the narrower prefix instead:

```toml
[transcript]
hidden_input_prefixes = [
  "\u2063FIRSTMATE_OP: v1 watcher: ",
]
```

Hush does not need a Firstmate kind list, encoder, or dedicated adapter; it applies the same literal prefix rules described above.
