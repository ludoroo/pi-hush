/**
 * Zero-height operational user-row presentation adapter.
 *
 * Verified against Pi 0.85.1 and 0.87.0 InteractiveMode.addMessageToChat.
 * Probes that exact method and throws if missing so the main extension can
 * skip only this adapter. Changes presentation only — never delivery, role,
 * ordering, or session data.
 */
import type { UserMessageComponent as PiUserMessageComponent } from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { isOperationalInput } from "./operational-input.ts";
import { hushPresentationHides } from "./visibility.ts";

type UserMessageConstructorArgs = ConstructorParameters<
  typeof PiUserMessageComponent
>;
type UserMessageLike = {
  role: string;
  content: unknown;
};
type AddMessageOptions = {
  populateHistory?: boolean;
};
type InteractiveModePresentation = {
  chatContainer: {
    children: unknown[];
    addChild(component: PiUserMessageComponent): void;
  };
  editor: {
    addToHistory?(text: string): void;
  };
  getMarkdownThemeWithSettings(): UserMessageConstructorArgs[1];
  getUserMessageText(message: UserMessageLike): string;
  outputPad: number;
};
type InteractiveModePrototype = {
  addMessageToChat(
    this: InteractiveModePresentation,
    message: UserMessageLike,
    options?: AddMessageOptions,
  ): void;
};
type AddMessageToChat = InteractiveModePrototype["addMessageToChat"];
type HushOperationalUserLayoutPatch = {
  version?: number;
  hidesOperationalInput: () => boolean;
  isOperationalInput: (text: string) => boolean;
};

const HUSH_OPERATIONAL_USER_LAYOUT_PATCH = Symbol.for(
  "pi-hush:operational-user-layout:pi-0.85.1",
);
const HUSH_OPERATIONAL_USER_LAYOUT_ORIGINAL = Symbol.for(
  "pi-hush:operational-user-layout:original-addMessageToChat:v1",
);
// Bump when wrapper behavior changes; ordinary reloads only update callbacks.
const HUSH_OPERATIONAL_USER_LAYOUT_VERSION = 2;

function contentIsTextOnly(content: unknown): boolean {
  if (typeof content === "string") return true;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string",
  );
}

export function installHushOperationalUserLayout(
  matchesOperational: (text: string) => boolean = isOperationalInput,
): void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: HushOperationalUserLayoutPatch | AddMessageToChat | undefined;
  };
  const hidesOperationalInput = (): boolean =>
    hushPresentationHides("synthetic-user");
  const InteractiveMode = PiCodingAgent.InteractiveMode;
  if (typeof InteractiveMode !== "function") {
    throw new Error("pi-hush requires Pi InteractiveMode");
  }
  const prototype =
    InteractiveMode.prototype as unknown as InteractiveModePrototype;
  if (typeof prototype.addMessageToChat !== "function") {
    throw new Error("pi-hush requires Pi InteractiveMode.addMessageToChat");
  }

  const UserMessageComponent = PiCodingAgent.UserMessageComponent;
  if (typeof UserMessageComponent !== "function") {
    throw new Error("pi-hush requires Pi UserMessageComponent");
  }

  // Keep the original dispatch once. Upgrading may leave one older wrapper
  // underneath; update its shared matcher so removed defaults cannot hide rows.
  // The legacy layer is retained, but ordinary reloads do not add more layers.
  if (typeof registry[HUSH_OPERATIONAL_USER_LAYOUT_ORIGINAL] !== "function") {
    registry[HUSH_OPERATIONAL_USER_LAYOUT_ORIGINAL] = prototype.addMessageToChat;
  }
  const originalAddMessageToChat = registry[
    HUSH_OPERATIONAL_USER_LAYOUT_ORIGINAL
  ] as AddMessageToChat;
  const patch = (registry[HUSH_OPERATIONAL_USER_LAYOUT_PATCH] as
    HushOperationalUserLayoutPatch | undefined) ?? {
    hidesOperationalInput,
    isOperationalInput: matchesOperational,
  };
  patch.hidesOperationalInput = hidesOperationalInput;
  patch.isOperationalInput = matchesOperational;
  registry[HUSH_OPERATIONAL_USER_LAYOUT_PATCH] = patch;
  // Preserve any third-party wrapper installed after ours on ordinary reloads.
  if (patch.version === HUSH_OPERATIONAL_USER_LAYOUT_VERSION) return;

  class HushOperationalUserMessageComponent extends UserMessageComponent {
    private readonly hasLeadingSpacer: boolean;
    private readonly operationalText: string;

    constructor(
      text: UserMessageConstructorArgs[0],
      markdownTheme: UserMessageConstructorArgs[1],
      outputPad: number,
      hasLeadingSpacer: boolean,
    ) {
      super(text, markdownTheme, outputPad);
      this.hasLeadingSpacer = hasLeadingSpacer;
      this.operationalText = text;
    }

    override render(width: number): string[] {
      if (patch.hidesOperationalInput() && patch.isOperationalInput(this.operationalText)) return [];
      const lines = super.render(width);
      return this.hasLeadingSpacer ? ["", ...lines] : lines;
    }
  }

  prototype.addMessageToChat = function (
    message: UserMessageLike,
    options?: AddMessageOptions,
  ): void {
    if (message.role !== "user" || !contentIsTextOnly(message.content)) {
      originalAddMessageToChat.call(this, message, options);
      return;
    }

    const text = this.getUserMessageText(message);
    if (!text || !patch.isOperationalInput(text)) {
      originalAddMessageToChat.call(this, message, options);
      return;
    }

    const component = new HushOperationalUserMessageComponent(
      text,
      this.getMarkdownThemeWithSettings(),
      this.outputPad,
      this.chatContainer.children.length > 0,
    );
    this.chatContainer.addChild(component);
    if (options?.populateHistory) this.editor.addToHistory?.(text);
  };
  patch.version = HUSH_OPERATIONAL_USER_LAYOUT_VERSION;
}
