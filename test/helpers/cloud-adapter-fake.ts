// A plain CloudAdapter fake with per-method call counts and swappable impls, standing in
// for a surface's `loadAdapter` port (what the old convex-sync module-path mock used to
// fake). Shared by the popup sync-row suite and the options cloud-pane suite — both inject
// it as their cloud transport so no test ever loads the live Convex module. `state` swaps a
// method's behavior (e.g. make `pull` reject or hang); `calls` counts invocations.
import type { OutboxItem, RemoteAccount } from "../../entrypoints/lib/blocked-store.ts";
import type { CloudAdapter } from "../../entrypoints/lib/sync-engine.ts";

export function makeCloudAdapterFake() {
  const calls = { push: 0, pull: 0, wipe: 0 };
  const state = {
    configured: true,
    generation: 0,
    push: async (items: OutboxItem[], generation: number) => ({
      status: "accepted" as const,
      actionIds: items.map((item) => item.action.actionId),
      generation,
    }),
    pull: async () => ({ generation: state.generation, accounts: [] as RemoteAccount[] }),
    wipe: async (_wipeId: string) => ++state.generation,
  };
  const adapter: CloudAdapter = {
    isConfigured: () => state.configured,
    push: async (items, generation) => {
      calls.push += 1;
      return state.push(items, generation);
    },
    pull: async () => {
      calls.pull += 1;
      return state.pull();
    },
    wipe: async (wipeId) => {
      calls.wipe += 1;
      return state.wipe(wipeId);
    },
  };
  return { adapter, calls, state };
}
