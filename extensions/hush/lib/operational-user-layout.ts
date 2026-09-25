/**
 * Zero-height operational user-row presentation adapter.
 *
 * Verified against Pi 0.81.1–0.82.1 InteractiveMode.addMessageToChat.
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
type HushOperationalUserLayoutPatch = {
  hidesOperationalInput: () => boolean;
  isOperationalInput: (text: string) => boolean;
};

const HUSH_OPERATIONAL_USER_LAYOUT_PATCH = Symbol.for(
  "pi-hush:operational-user-layout:pi-0.85.1",
);

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

export function installHushOperationalUserLayout(): void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: HushOperationalUserLayoutPatch | undefined;
  };
  const hidesOperationalInput = (): boolean =>
    hushPresentationHides("synthetic-user");
  const matchesOperational = (text: string): boolean => isOperationalInput(text);

  const installed = registry[HUSH_OPERATIONAL_USER_LAYOUT_PATCH];
  if (installed) {
    installed.hidesOperationalInput = hidesOperationalInput;
    installed.isOperationalInput = matchesOperational;
    return;
  }

  const patch: HushOperationalUserLayoutPatch = {
    hidesOperationalInput,
    isOperationalInput: matchesOperational,
  };
  const InteractiveMode = PiCodingAgent.InteractiveMode;
  if (typeof InteractiveMode !== "function") {
    throw new Error("pi-hush requires Pi InteractiveMode");
  }
  const prototype =
    InteractiveMode.prototype as unknown as InteractiveModePrototype;
  const originalAddMessageToChat = prototype.addMessageToChat;
  if (typeof originalAddMessageToChat !== "function") {
    throw new Error("pi-hush requires Pi InteractiveMode.addMessageToChat");
  }

  const UserMessageComponent = PiCodingAgent.UserMessageComponent;
  if (typeof UserMessageComponent !== "function") {
    throw new Error("pi-hush requires Pi UserMessageComponent");
  }

  class HushOperationalUserMessageComponent extends UserMessageComponent {
    private readonly hasLeadingSpacer: boolean;

    constructor(
      text: UserMessageConstructorArgs[0],
      markdownTheme: UserMessageConstructorArgs[1],
      outputPad: number,
      hasLeadingSpacer: boolean,
    ) {
      super(text, markdownTheme, outputPad);
      this.hasLeadingSpacer = hasLeadingSpacer;
    }

    override render(width: number): string[] {
      if (patch.hidesOperationalInput()) return [];
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
    // Fast path: skip classification for ordinary captain rows without U+2063.
    if (!text || !text.includes("\u2063") || !patch.isOperationalInput(text)) {
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

  registry[HUSH_OPERATIONAL_USER_LAYOUT_PATCH] = patch;
}
