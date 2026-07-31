# ADR-0004 — Worker-owned state mutations and generation-fenced cloud wipe

- Status: Accepted
- Date: 2026-07-18

## Context

Independent content, popup, and options writes caused proven cross-context lost updates.
A cloud wipe could also race with a stale push and restore erased data. ADR-0003 deferred
its Option A depth because the collision cost was higher than the known risk. The proven
loss and wipe race now justify revisiting it.

## Decision

- Content, popup, and options use grouped Ledger, Whitelist, Settings, and Cloud commands
  over validated runtime messages. The MV3 worker is the `StateOwner`: only it mutates
  shared storage or cloud state. `StateClient` serves reads. Dock position is excluded.
- `StateOwner` uses a short local mutation queue and serialized cloud operations. Caller
  action IDs make retries safe. Storage failures reject the command.
- `CloudAdapter` moves inward to `StateOwner`. A wipe atomically advances the server
  generation, which fences stale pushes around the wipe.

## Consequences

Surfaces cannot race to write shared state. A failed mutation is visible to its caller,
and wiped cloud data cannot be restored by a pre-wipe push.
