import { CursorConsole } from "./cursor-console";
import { NativeAutoConfirm } from "./native-auto-confirm";
import type { QuickBlockMode } from "./quick-block-mode";
import type { DirectActionType } from "./x-api";

export type QuickBlockService = {
  mount(): void;
  destroy(): void;
};

export type CreateQuickBlockServiceOptions = {
  mode: QuickBlockMode;
  onActed?: (kind: DirectActionType) => void;
  now?: () => number;
};

const doNothing = (): void => undefined;

export function createQuickBlockService(
  options: CreateQuickBlockServiceOptions,
): QuickBlockService {
  if (options.mode === "inline") {
    return new CursorConsole(options.onActed ? { onActed: options.onActed } : {});
  }
  if (options.mode === "auto-confirm") {
    return new NativeAutoConfirm(options.now ? { now: options.now } : {});
  }
  return { mount: doNothing, destroy: doNothing };
}
