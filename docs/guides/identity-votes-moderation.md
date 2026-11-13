# Identity, votes, and moderation

The three trust-adjacent pieces of the engine: the per-device indexing identity that signs observations, the NIP-25 vote system with its anonymous/attributable switch, and the host-injected moderation set.

## The device indexing identity

`src/protocol/indexerIdentity.ts` implements spec §14: every browser/device gets its own dedicated indexer keypair, generated locally on first use. It signs web-index observations (kind 39697) — it is **not** the user's personal Nostr identity, and the two are never automatically linked.

Properties:

- **Generated locally** (cryptographically random), **stored locally** (`localStorage`, key `sip:indexer:secret`, hex), never uploaded as a private key.
- **Pseudonymous** — not cryptographically tied to any personal identity.
- **Replaceable** — regenerating creates a *new* indexer; old events keep the old key and their history, reputation does not transfer.
- **Exportable only on explicit request** (`exportIndexerNsec()`).

API:

| Export | Purpose |
|---|---|
| `getIndexerIdentity()` | Get (or generate + persist) this device's identity: `{ secretHex, pubkeyHex, npub, fresh }`. |
| `regenerateIndexerIdentity()` | Discard the key and start a new indexer. |
| `exportIndexerNsec()` | Export the secret as bech32 `nsec` — the only time it leaves the module. |
| `getIndexerPubkey()` | The device's indexer pubkey (hex). |
| `getIndexerSecretKey()` | Raw secret bytes for signing; never expose beyond signing. |

The storage trade-off is documented in the module: the secret sits in localStorage in plaintext, acceptable because the key is disposable, pseudonymous, and signs only public document metadata. And the privacy honesty note: this guarantees **key separation, not network anonymity** — relay operators can still see IP/timing (spec §16).

## Publishing observations

The auto-indexer (`useSearchIndexer`, driven by `EngineRuntime.autoIndex`) builds unsigned events with `buildIndexEvent`, signs them with `finalizeEvent` from `nostr-tools/pure` using the device identity, and publishes to the index relay pool (`publishToRelayPool(getIndexRelayUrls(), …)`). The `source` tag carries the host's `search.indexerSource` from `configureEngine()`, injected through `observationFromResult()` — the protocol layer itself never imports a host profile. What is never published: the query, the user's personal identity, and Nostr-native or index-sourced results (echo-loop prevention). Details in [Build a search engine on the core](build-an-engine.md#7-auto-indexing).

## Votes: anonymous vs attributable

Votes follow [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md), with [NIP-73](https://github.com/nostr-protocol/nips/blob/master/73.md) identifiers for external web content. `buildVoteEvent` uses the target returned by `voteTargetFor`:

- **Nostr-native events:** kind `7`, with an `e` tag for the event ID, a `p` tag for its author when known, a `k` tag for its kind when known, and an `a` coordinate when the target is addressable.
- **External web pages:** kind `17`, with `["k", "web"]` and `["i", "<normalized-url>"]`. The SIP-01 URL normalizer is used so the same page can be tallied consistently.

Do not use the legacy kind-7 `r` URL shape for new web votes. NIP-25 specifies kind `17` and NIP-73 `k`/`i` tags for external content.

The identity model is the host's choice via the runtime:

| Mode | Setting | Signer |
|---|---|---|
| **Anonymous** (default) | `voteWithIdentity: false` | The device's built-in indexing identity — pseudonymous, per-device, never the user's npub |
| **Attributable** | `voteWithIdentity: true` | The host's logged-in user signer — `EngineRuntime.userSigner` is **required** (a NIP-07-style `{ signEvent }` shape, exported as `EngineSigner`); `useVoteActions` throws without it |

Both paths publish to the index relay pool. Tally rule (`tallyVotes`): the latest valid reaction per pubkey and target wins; timestamp ties are resolved deterministically by event ID. The simple score is `up − down`. Optional host-supplied author weights are clamped to `0..5`; authors without an explicit weight default to `1`. These weights are a core application feature, not a rule imposed by NIP-25. The user's own directions persist locally under `sip01:votes` for button state. Hooks: `useVoteCounts(targetKeys)` for batch tallies, `useVoteActions()` → `{ vote, asIdentity, canVoteWithIdentity }`.

## Host-injected moderation

`src/engine/moderation.ts` is the **pure** core of moderation: a `ModerationSet` lookup and a matching predicate. It carries no trust policy — no owner pubkey, no label namespaces, no relay lists. The core ships **no trust anchors**; the host injects a set built from its own trust policy via `EngineRuntime.moderation`. `undefined` means no filtering.

```ts
interface HiddenTarget {
  labelEventId: string;        // source record id (for hosts that support un-hiding)
  targetType: 'u' | 'e';       // web URL (normalized) or Nostr event id
  value: string;               // normalized URL or event id hex
  createdAt: number;
}

interface ModerationSet {
  urls: Set<string>;
  eventIds: Set<string>;
}
```

`toModerationSet(targets)` builds the set; `isHiddenResult(result, set)` matches a result by its `nostrEvent.id` first, then by its SIP-01-normalized URL. `useProviderSearch` applies the set to every batch of visible results, so hidden entries never render.

### Building a set from your own trust policy

The set is just data — build it from whatever your engine trusts: NIP-32 labels signed by your own moderators, a curated blocklist, a local user list, or nothing. Example: fetching kind 1985 NIP-32 label events from your own moderator pubkeys on your own relays and turning their `u`/`e` targets into a moderation set.

```ts
import {
  toModerationSet,
  normalizeIndexUrl,
  queryRelayPool,
  getIndexRelayUrls,
  type HiddenTarget,
  type ModerationSet,
} from 'sip-01-core';

async function buildMyModerationSet(myModeratorPubkeys: string[]): Promise<ModerationSet> {
  const settled = await queryRelayPool(
    getIndexRelayUrls(),
    [{ kinds: [1985], authors: myModeratorPubkeys, limit: 1000 }],
    { timeoutMs: 6000 },
  );

  const targets: HiddenTarget[] = [];
  for (const events of settled) {
    for (const ev of events) {
      const url = ev.tags.find(([n]) => n === 'u')?.[1];
      const eventId = ev.tags.find(([n]) => n === 'e')?.[1];
      if (url) {
        const normalized = normalizeIndexUrl(url);
        if (normalized) {
          targets.push({ labelEventId: ev.id, targetType: 'u', value: normalized, createdAt: ev.created_at });
        }
      } else if (eventId) {
        targets.push({ labelEventId: ev.id, targetType: 'e', value: eventId, createdAt: ev.created_at });
      }
    }
  }
  return toModerationSet(targets);
}
```

Then inject it:

```tsx
<EngineRuntimeProvider runtime={{ moderation: myModerationSet }}>
```

URLs must be normalized with `normalizeIndexUrl` before entering the set — `isHiddenResult` normalizes the candidate side, so a set built from unnormalized URLs silently matches nothing.

## How the pieces fit

The same device identity signs both observations and anonymous votes; the personal identity only ever appears when the host explicitly opts into attributable votes with a user signer; and moderation is data flowing in, never code the core imports. This is what "the core ships no trust anchors" means concretely — see [Architecture](../architecture.md#the-engineruntime-injection-seam).
