# XBlocker

XBlocker helps people act on unwanted X.com reply content while preserving trusted accounts.

## Surfaces

The **Reply Rail** is the bulk surface on status pages. Manual single-account behavior
depends on `VITE_QUICK_BLOCK_MODE`: the default `auto-confirm` mode uses X's native flow;
the opt-in `inline` mode adds the **Cursor Console** beside replies.

## Language

**Reply Rail** (formerly _Reply Action Bar_ / _Dock_):
The draggable bulk control for Conversation Replies. Each run is capped by the normalized
`maxReplies` setting: 50 by default, 200 at most.
_Avoid_: Dashboard, floating menu, three-dot menu

**Cursor Console**:
The inline-mode control for one Conversation Reply's author. The default auto-confirm mode
leaves manual actions in X's native flow.
_Avoid_: Tooltip, context menu, popup

**Conversation Reply**:
A reply article after the conversation's main post and before X's "Discover more" recommendations.
_Avoid_: Tweet, post, comment

**Whitelist**:
Trusted X.com handles. Inline direct actions always skip them. Bulk actions skip them when
`protectWhitelist` is enabled; it defaults to enabled.
_Avoid_: Allowlist, safe list

**Blocked Ledger**:
The history of actions recorded against X.com accounts.
_Avoid_: Block list, event log

**Blocked Account**:
An X.com account with one or more actions in the Blocked Ledger.
_Avoid_: Blocked user, target

**Action**:
One recorded decision to block or mute a Blocked Account.
_Avoid_: Event, operation

**Outbox**:
Actions waiting to be included in Cloud Backup.
_Avoid_: Queue, pending sync

**Cloud Backup**:
The optional remote mirror of the Blocked Ledger.
_Avoid_: Sync service, cloud state

## Design source of truth

Stitch project **XBlocker Chrome UI Polish** (`projects/376932020779293096`), design system
**Calm Control**: Inter, primary #0A8FE3, OKLCH tokens (see
`entrypoints/content/styles.ts`), dual light/dark, compact density, tonal layers over heavy
shadows.
