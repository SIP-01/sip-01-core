# sip-01-core

**The reusable reference implementation of the SIP-01 Search Index Protocol —
engine, contracts, providers, and AI layer that any search engine can build on.**

## Documentation

Full guides and reference material live in [`docs/`](docs/README.md) — start at
the [table of contents](docs/SUMMARY.md): getting started, the SIP-01 primer,
the build-an-engine guide, provider/AI/relay/identity guides, and the API,
conformance, versioning, and security references. The repo is **GitBook-ready**:
the root `.gitbook.yaml` points Git Sync at `docs/`, so connecting this repo at
gitbook.com renders the space directly — and every page also reads on GitHub.

## What SIP-01 is

[SIP-01](https://github.com/NostrDanish/SIP-01) (Search Index Protocol) is an
open Nostr protocol for a decentralized web-document index: indexers publish
observations about web pages as addressable Nostr events (kind 39697), and any
search engine can read the shared index from public relays — no central
crawler, no central server. The canonical specification (currently **v1.2**,
wire schema `v: "1"`), its test vectors, and the wire format live in the
[`NostrDanish/SIP-01`](https://github.com/NostrDanish/SIP-01) repo; a vendored
copy is kept at [`docs/SIP-01.md`](docs/SIP-01.md) for convenience. When they
disagree, the spec repo wins.

## What sip-01-core is

This repo is the protocol's **reference implementation plus a reusable
search-engine core**, packaged as a library: the byte-critical protocol code,
the shared federation contracts, and a complete engine (providers, query/rank
stack, relay machinery, votes/moderation, optional AI answers) that any
application can build on.

```
src/protocol/    SIP-01 reference implementation (byte-critical, spec-pinned)
src/federation/  shared 0xsearchstr:* event contracts (frozen namespaces)
src/lib/         core contracts + relay/proxy machinery (config seams)
src/engine/      providers + query/rank stack + votes + moderation + hooks
src/ai/          AIProvider contract + OpenAI-compatible layer
src/index.ts     the public API barrel
```

## What it is NOT

- **Not the protocol specification.** The spec is the
  [`NostrDanish/SIP-01`](https://github.com/NostrDanish/SIP-01) repo; this is
  software that implements it.
- **Not an application.** There is no UI, no branding, no deployment
  infrastructure, and no backend in this repo. The Dsearch application plane
  was split out (the extraction program is closed — see
  [`docs/EXTRACTION-MAP.md`](docs/EXTRACTION-MAP.md)); crawlers, relays, and
  the abuse API live in separate infrastructure repos.
- **Not a published npm package (yet).** `package.json` is `private: true`;
  nothing here is published to any registry. Consuming the core today means
  building from this repository (or a git dependency).

## Install, build, test

```bash
npm ci          # install
npm run build   # library build → dist/sip-01-core.js + dist/*.d.ts
npm run test    # the gate: tsc --noEmit && eslint --cache && vitest run && vite build
```

The build produces an ES module (`dist/sip-01-core.js`) with TypeScript
declarations (`dist/index.d.ts`). `react`, `react-dom`,
`@tanstack/react-query`, `@nostrify/nostrify`, and `nostr-tools` are peer
dependencies — the host application supplies them.

## Public API overview

Everything is exported from the package root (`src/index.ts`):

- **Protocol** — `WEB_INDEX_KIND`, `normalizeIndexUrl`, `documentId`,
  `contentHash`, `buildIndexEvent`, `parseIndexEvent`, `verifyObservation`,
  `getIndexerIdentity` & friends (`src/protocol/`).
- **Federation** — builders/parsers + namespace constants for the shared
  legacy cache, community submissions, keyword stakes, and term signals
  (`src/federation/`). Namespaces are frozen: renaming forks the network.
- **Core contracts** — relay pool query/publish helpers, relay discovery,
  CORS proxy, URL sanitizers, language/content-type helpers, storage
  migration (`src/lib/`).
- **Engine** — the provider contract (`SearchProvider`/`SearchResult`), the
  15 built-in providers, `createProviderRegistry`, the query parse/evaluate/
  rank stack, votes (NIP-25), the moderation matcher, the engine hooks
  (`useProviderSearch`, `useSearchIndexer`, `useInstantAnswer`, …)
  (`src/engine/`).
- **AI** — the `AIProvider` contract, the `AI_PROVIDERS` catalog,
  `createOpenAICompatibleProvider`, credential-precedence resolution
  (`resolveAIConfig`), and the runtime-agnostic engine-proxy isomorph
  (`src/ai/`).

The per-layer contract with exact export lists is
[`PACKAGE_BOUNDARIES.md`](PACKAGE_BOUNDARIES.md); the architecture deep-dive
is [`ARCHITECTURE.md`](ARCHITECTURE.md); the implementation guide is
[`docs/IMPLEMENTATION-GUIDE.md`](docs/IMPLEMENTATION-GUIDE.md); query
operators are documented in [`docs/guides/query-syntax.md`](docs/guides/query-syntax.md).

## The replacement seams (how a host plugs in)

The core holds no brand, no trust anchors, and no credentials. A host
application injects its identity through five seams:

1. **`configureEngine()`** (`src/lib/engineConfig.ts`) — engine id, indexer
   software id (stamped as the SIP-01 `source` tag), Brave tier, and the AI
   defaults (including an optional public-by-design community key). Called
   once at bootstrap; neutral brand-free defaults apply until then.
2. **`configureRelays()`** (`src/lib/relayConfig.ts`) — default relay pools
   (search/index/git/wiki) and the host's localStorage key names, with
   optional legacy-key migration. Defaults are empty pools and neutral
   `sip01:*` keys — no relay URLs are hardcoded in the core.
3. **The provider registry** — `createProviderRegistry([...])`
   (`src/engine/providers/registry.ts`) builds a catalog from any mix of the
   built-in providers and your own. Anything implementing `SearchProvider`
   slots in — including closed-source providers.
4. **`AIProvider`** (`src/ai/types.ts`) — implement the two-method contract,
   or reuse `createOpenAICompatibleProvider` for any OpenAI-compatible
   endpoint.
5. **`<EngineRuntimeProvider>`** (`src/engine/runtime.tsx`) — the React
   runtime for the engine hooks: `privacyMode`, `autoIndex`,
   `disabledProviders`, `languageFilter`, `voteWithIdentity`, the host's
   `userSigner` (for attributable votes), and the host's `moderation` set
   (built from the host's own trust policy — the core ships no trust
   anchors). Every field is optional; the hooks also work with no provider
   at all via neutral defaults.

**Staying SIP-01 compatible:** run the protocol tests
(`npx vitest run src/protocol` — 45 tests pinning the spec §13 vectors
byte-for-byte); never change `normalizeIndexUrl` / `documentId` /
`contentHash` behavior, never rename the `0xsearchstr:*` federation
namespaces, and never change the wire format (`v` stays `"1"`) except through
a spec revision.

## Open contracts, closed components

The protocol layer, federation contracts, config seams, and the provider/AI
interfaces are designed as **open contracts** — stable touchpoints you build
against. Providers, ranking, AI backends, crawlers, datasets, and UI are
designed as **replaceable components**: you can keep the built-ins, swap
individual ones, or keep your own versions proprietary behind the same
interfaces.

**Licensing boundary — owner decision required:** this repository currently
has **no LICENSE file**. An earlier revision of this README stated "MIT",
but no LICENSE file was ever committed, so the actual terms are
**undetermined** — this contradiction must be resolved by the project
owner before any third-party reuse or distribution of any layer. Until
then, no reuse or distribution rights are granted by default, and no terms
should be assumed for any derivative, open or closed.

## Versioning — three separate axes

| Axis | Current | Changes when |
|---|---|---|
| **SIP-01 document revision** | v1.2 | the spec repo publishes a revision |
| **Wire schema version** (`v` tag) | `"1"` | only with a spec revision that changes the wire format |
| **sip-01-core software version** | 0.1.0 (semver, this repo) | any software release — internal improvements must not change wire behavior |

Protocol compatibility always takes priority over software architecture: the
core can ship fixes and features while the wire format stays frozen.


## Capability discovery

Kind 39697 is unchanged. Optional `role` and `proto` tags, plus `suggestCapabilities` for the AI layer, are described in [`docs/guides/capability-discovery.md`](docs/guides/capability-discovery.md).
