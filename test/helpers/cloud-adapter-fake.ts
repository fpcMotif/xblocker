// A plain CloudAdapter fake with per-method call counts and swappable impls, standing in
// for a surface's `loadAdapter` port (what the old convex-sync module-path mock used to
// fake). Shared by the popup sync-row suite and the options cloud-pane suite — both inject
// it as their cloud transport so no test ever loads the live Convex module. `state` swaps a
// method's behavior (e.g. make `pull` reject or hang); `calls` counts invocations.
import type { OutboxItem, RemoteAccount } from "../../entrypoints/lib/blocked-store.ts";
import type { CloudAdapter } from "../../entrypoints/lib/sync-engine.ts";

export function makeCloudAdapterFake() {
  const calls = { push: 0, pull: 0, clear: 0 };
  const state = {
    configured: true,
    push: async (items: OutboxItem[]): Promise<string[]> =>
      items.map((item) => item.action.actionId),
    pull: async (): Promise<RemoteAccount[]> => [],
    clear: async (): Promise<void> => {},
  };
  const adapter: CloudAdapter = {
    isConfigured: () => state.configured,
    push: async (items) => {
      calls.push += 1;
      return state.push(items);
    },
    pull: async () => {
      calls.pull += 1;
      return state.pull();
    },
    clear: async () => {
      calls.clear += 1;
      return state.clear();
    },
  };
  return { adapter, calls, state };
}
