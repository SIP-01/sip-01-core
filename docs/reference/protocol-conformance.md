# Protocol conformance

How sip-01-core proves it is byte-compatible with the SIP-01 specification: the §13 test vectors, the identity constructions they pin, and what conformance does and does not cover.

## What conformance means

SIP-01 works only if every implementation derives **byte-identical identifiers** for the same page. If your URL normalization or hashing drifts by a single character, your observations stop deduplicating against everyone else's — the shared index fragments. Conformance therefore means: reproduce the spec §13 test vectors exactly, and never change the behavior of the three identity functions:

- `normalizeIndexUrl()` — §7 URL normalization
- `documentId()` — §3 URL identity: `"widx:" + sha256(normalized_url)[0:32]` (lowercase hex)
- `contentHash()` — §8 content identity: `sha256(title + "\n" + description)`, absent description treated as `""`

The vectors live in the spec ([SIP-01.md](../SIP-01.md) §13, vendored v1.3; canonical: [`NostrDanish/SIP-01`](https://github.com/NostrDanish/SIP-01)) and are pinned in `src/protocol/webIndex.test.ts`.

## The §13 test vectors

### §13.1 URL identity (`d`)

| Input URL | Normalized URL | `d` tag |
|---|---|---|
| `https://example.com/` | `https://example.com/` | `widx:0f115db062b7c0dd030b16878c99dea5` |
| `HTTPS://WWW.Example.Com:443/page/?b=2&utm_source=x&a=1#top` | `https://example.com/page?a=1&b=2` | `widx:f68176b3eb966bd682c3c6eadcc5fe44` |
| `https://example.com/page` | `https://example.com/page` | `widx:3641c5f2274c5471278ab5bf1df6d185` |
| `https://github.com/NostrDanish/Crwalstr` | `https://github.com/NostrDanish/Crwalstr` | `widx:cdfd4df8c01d609fc9cdf943afa80197` |

Vector 2 exercises nearly every §7 rule at once: scheme/host lowercased, `www.` stripped, default port removed, fragment removed, tracking parameter removed, remaining parameters sorted, trailing slash removed. Vector 4 pins that **paths stay case-sensitive** — only scheme and host are lowercased.

### §13.2 Content identity (`x`)

| `title` | `description` | `x` tag |
|---|---|---|
| `Example` | _(absent)_ | `e1762f14d9924e37b32f1c81dfd256410af462f5136415c96877efa8c80345d0` |
| `Example Page` | `A page about examples.` | `2a5cbdf44513f552fb571d6c6de2ddf16c5452b235cc887980b52898fb38e7c1` |

All six values are independently reproducible with any SHA-256 implementation.

## Running the conformance tests

```bash
npx vitest run src/protocol
```

That is 45 tests across `webIndex.test.ts` and `indexerIdentity.test.ts`: the vectors above (each URL vector checked twice — once for normalization, once for the `d` derivation), plus build/parse/verify behavior, field caps, tag validation, extension-tag normalization, and round-trip signing. The full gate (`npm run test`) runs them with type-checking, lint and build. Check the current CI result for live pass counts; any count in an old audit report is a historical snapshot.

For third-party implementers, the [implementation guide](../IMPLEMENTATION-GUIDE.md#5-test-vectors-run-these-first) carries the same table with a publisher checklist.

## The `d` tag and `x` hash construction

Given a raw URL and observed metadata, the conformant pipeline is:

```ts
import { normalizeIndexUrl, documentId, contentHash, buildIndexEvent, parseIndexEvent, verifyObservation } from 'sip-01-core';

const normalized = normalizeIndexUrl(rawUrl);   // §7 — null if not http(s)
const d = await documentId(normalized!);        // §3 — 'widx:' + sha256(normalized)[0:32]
const x = await contentHash(title, description); // §8 — sha256(title + '\n' + description)
```

`buildIndexEvent` does all of this (including truncation **before** hashing — `x` is computed over the truncated values actually published, per §8), and `verifyObservation` performs the reader-side integrity check (spec §18 step 2): `d` must match the normalized `u`, and `x` — when present — must match the content. That check is what stops a spoofed observation from squatting on a popular document's `d` tag with fake metadata.

## Extension tags

Beyond the core schema, the reference implementation builds and parses the registered §9.2 extensions: `type`, `platform`, `category`, `network` (keyword-shaped per `EXTENSION_VALUE_RE`, lowercased), `country` (ISO 3166-1 alpha-2, uppercased), `mime` (lowercased MIME), optional `role`, and repeatable `proto`. The v1.3 role/protocol vocabulary belongs to capability discovery; role identifies a provider class, while finer specialisations remain ordinary capability/topic tags. A NIP-01 `a` tag may point from a web observation to a companion kind-39698 capability announcement. Conformance rules for extensions (§9.1): they are optional, invalid values are **dropped, never fatal**, and consumers must ignore unknown tags. Experimental tags use the `x-` prefix until registered via a spec PR.

## What conformance does NOT cover

- **Kind 39698 capability announcements.** This companion profile is documented separately by ORBSTR; it is not a kind-39697 observation and is not covered by the §13 URL/content hash vectors. See [Capability discovery](../guides/capability-discovery.md).
- **Kind 16919 crawler/indexer heartbeats.** `useNetworkStats` (`NODE_HEARTBEAT_KIND = 16919`) reads self-reported "this node is alive" heartbeats purely as a network-status display. They are an engine-level signal, **not part of SIP-01** — no spec section defines them, and no conformance depends on them.
- **The federation contracts** (`0xsearchstr:*` namespaces). They are shared ecosystem conventions frozen for compatibility, not SIP-01 spec content — see [What is SIP-01?](../what-is-sip-01.md#frozen-federation-namespaces).
- **Ranking, moderation, query syntax.** Deliberately out of protocol scope (spec §1); they are engine decisions.

## Staying conformant

1. Never change `normalizeIndexUrl` / `documentId` / `contentHash` behavior — the vectors pin them byte-for-byte.
2. Never rename the `0xsearchstr:*` federation namespaces — renaming forks the network.
3. `v` stays `"1"` until the spec itself bumps the schema (see [Versioning](versioning.md)).
4. Run `npx vitest run src/protocol` before merging anything that touches `src/protocol/`.
