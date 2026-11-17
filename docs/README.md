# sip-01-core Documentation

The reusable reference implementation of the SIP-01 Search Index Protocol — engine, contracts, providers, and AI layer that any search engine can build on.

## What SIP-01 is

[SIP-01](https://github.com/NostrDanish/SIP-01) (Search Index Protocol) is an open Nostr protocol for a decentralized web-document index. Instead of one company running one crawler, any number of independent indexers publish **observations** about web pages as addressable Nostr events (kind 39697), and any search engine can read the shared index from public relays. There is no central crawler, no central server, and no privileged signer.

The protocol is deliberately small: it defines what an indexed web document looks like on the wire — the event kind, the tags, the URL normalization, the hashing — and nothing else. Ranking, moderation, branding, and business logic all belong to the engines built on top. The canonical specification (currently **v1.3**, wire schema `v: "1"`), its test vectors, and the wire format live in the [`NostrDanish/SIP-01`](https://github.com/NostrDanish/SIP-01) repository; a vendored copy is kept at [SIP-01.md](SIP-01.md) for convenience. When they disagree, the spec repo wins.

## What sip-01-core is

This repository ([`NostrDanish/sip-01-core`](https://github.com/NostrDanish/sip-01-core)) is the protocol's **reference implementation plus a reusable search-engine core**, packaged as a TypeScript library. It contains the byte-critical protocol code, the shared federation contracts, and a complete engine — providers, a query/rank stack, relay machinery, votes and moderation, and an optional AI answer layer — that any application can build on.

What it is **NOT**:

- **Not the protocol specification.** The spec is the `NostrDanish/SIP-01` repo; this is software that implements it.
- **Not an application.** There is no UI, no branding, no deployment infrastructure, and no backend in this repo. You bring the product; the core brings the protocol and the engine.
- **Not infrastructure.** Crawlers, relays, and abuse APIs live in separate infrastructure repos. Everything here runs client-side plus on public Nostr relays.
- **Not a published npm package (yet).** `package.json` is `private: true`; consuming the core today means building from this repository (or a git dependency).

## Features

- **SIP-01 v1.3 reference implementation** — build, parse, and verify kind 39697 observations; §7 URL normalization and §3/§8 hashing pinned byte-for-byte by the spec §13 vectors. The wire schema remains `v="1"`; optional `role`/`proto` extensions do not alter legacy observations.
- **15 built-in search providers** — from the SIP-01 web index and legacy cache to Brave, DuckDuckGo, SearXNG, Wikipedia, Hacker News, Stack Overflow, Tor, and more — behind one `SearchProvider` contract and a composable registry.
- **Structured query engine** — Boolean operators and filters (`site:`, `lang:`, `before:`, …) parsed once and evaluated **locally**, so an upstream engine that misunderstands an operator can never leak a wrong result.
- **Auto-indexing** — useful results discovered during searches are contributed back to the shared index as kind 39697 observations, signed by a per-device pseudonymous indexing identity (never the user's personal key, never the query).
- **Votes and moderation** — NIP-25 votes (anonymous by default, attributable when the host supplies a signer) and a pure moderation matcher driven by a host-injected `ModerationSet`.
- **Pluggable AI answer layer** — the two-method `AIProvider` contract, an OpenAI-compatible implementation that works with any compatible endpoint, credential precedence (BYOK → engine proxy → community tier), and an isomorphic engine-proxy module for server-side key injection.
- **Host injection seams** — `configureEngine()`, `configureRelays()`, and `<EngineRuntimeProvider>`: the core holds no brand, no relay URLs, no trust anchors, and no credentials.
- **Test-vector conformance** — `npm run test` runs type-checking, lint, Vitest and build. The protocol tests pin the §13 vectors; use the current CI run for the authoritative pass count.

## Status

| Metric | Value |
|---|---|
| Test command | `npm run test` (live results in CI) |
| Protocol vector suite | `src/protocol/` against spec §13 |
| SIP-01 spec revision | v1.3 |
| Wire schema version (`v` tag) | `"1"` |
| Core software version | 0.1.0 (semver, pre-1.0) |
| Package status | private; not published to npm |
| License | none yet — see [Licensing](licensing.md) |

## Where to start

- **New here?** [Getting started](getting-started.md) — clone, test, build, first import.
- **Understanding the protocol** — [What is SIP-01?](what-is-sip-01.md), then the [full spec](SIP-01.md).
- **Building an application** — [Build a search engine on the core](guides/build-an-engine.md), then the guides on [providers](guides/search-providers.md), [AI answers](guides/ai-answers.md), [relays and config](guides/relays-and-config.md), and [identity, votes, moderation](guides/identity-votes-moderation.md).
- **Understanding the codebase** — [Architecture](architecture.md), [API reference](reference/api.md).
- **Implementing the protocol yourself** — [Implementation guide](IMPLEMENTATION-GUIDE.md) and [Protocol conformance](reference/protocol-conformance.md).

This documentation is GitBook-ready: the repository root contains a `.gitbook.yaml` that points GitBook's Git Sync at this `docs/` directory, and every page also reads directly on GitHub.
