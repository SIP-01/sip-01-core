# Ecosystem Integration Audit — 2026-11-12

This is a repository-level integration inventory based on the current default-branch documentation, package manifests, and selected implementation files. It is a starting audit, not a claim that every runtime path or deployment has been exhaustively tested.

## Findings

| Repository | Current evidence | Gap / next action |
|---|---|---|
| `SIP-01/SIP-01` | Canonical SIP-01 kind 39697 spec and v1 wire schema | Keep the spec authoritative; cross-link related NIPs without folding bookmark/vote semantics into SIP-01 itself |
| `SIP-01/sip-01-core` | Contains bookmark builders/parsers, hooks, tests, NIP-25 votes, NIP-85 policy/assertion handling, AI/provider and relay contracts | Make this the single implementation source; finish conformance fixtures and publish/build integration contract |
| `SIP-01/0xSearchstr` | `NIP.md` documents kind 39701, 10003, 30003, 7, 17, 1984, 1985, 10040 and 30382-30385; local `useNostrBookmarks.ts` duplicates bookmark handling | Bookmark list browsing and categorized-set UI are documented as not yet exposed; NIP-85 provider selection is not yet wired to shared core; consolidate duplicate hook |
| `SIP-01/0xPresearchstr` | `NIP.md` documents NIP-51 save/read-modify-write, NIP-25/73 and NIP-85 | Its matrix explicitly says saved-list browsing and kind-30003 UI are not exposed and NIP-85 core is not yet consumed by this app |
| `SIP-01/UNCAGED-ENGINE` | Minimal Nostr-native template; README says voting, keyword staking and term signals live in other apps | Keep minimal, but provide opt-in shared adapters for bookmarks, votes, WoT, moderation and AI |
| `SIP-01/Dsearch` | Flagship/control-plane application; its package manifest currently has no `sip-01-core` dependency | Integrate the shared core and expose platform policy controls; verify current app-local copies before replacing them |
| `Savedd-com/Savedd` | README says local browser SIP-01 adapter; explicitly says the app does not currently import `sip-01-core` | Preserve SAVEDD-specific Scripture/AI profile while adopting common conformance fixtures and shared event logic |
| `Savedd-com/ios-app` | README identifies this as documentation scaffold only; no Xcode project or Swift source | No runtime integration yet; keep native implementation requirements aligned with this contract |
| `SIP-01/SIP-Booster-Relay` | README describes a SIP-01-focused relay with kind 39697 validation, NIP-50, NIP-77, NIP-45, NIP-11 and kind 16919 heartbeat | Audit whether the relay intentionally accepts only SIP observations or also supports general Nostr event kinds; advertise exact scope |
| `SIP-01/UNCAGED-Index-Relay` | README describes a general Nostr relay plus SIP-01 indexing, NIP-50/77, NIP-85 and standard relay features | Verify general event-kind persistence/query behavior for B0, NIP-25, NIP-51, NIP-85 and moderation; don't apply SIP-only validation to other kinds |
| `SIP-01/crawlstr` | Crawler publishes kind 39697 with per-device identity and kind 16919 heartbeat | Keep focused on public page observations; add canonical vector and privacy regression gates |
| `SIP-01/indexstr` | Distributed indexer publishes kind 39697 and kind 16919 heartbeats | Validate canonical observations and NIP-77 replication; do not ingest private bookmarks or raw queries |

## Integration blockers

1. **Core distribution:** `sip-01-core` is marked `private: true`, exports a built `dist` entrypoint, and currently has no demonstrated app dependency path. Define a reproducible pinned Git dependency or other versioned distribution route before app migrations.
2. **Duplicated app logic:** 0xSearchstr contains its own bookmark hook; app-local copies risk diverging from core behavior.
3. **Feature completeness:** 0xSearchstr and 0xPresearchstr document save support but no full saved-list browsing/category management; their NIP-85 app integration remains incomplete.
4. **Relay scope:** SIP-Booster is documented as SIP-focused; UNCAGED Index Relay is documented as general-purpose. They need different conformance profiles rather than one blanket event-kind allowlist.
5. **Validation evidence:** GitHub README and package manifests cannot prove production behavior. Runtime tests, relay protocol tests, deployment checks, and cross-client event fixtures are still required.

## Required release gates

- Core: build, typecheck, lint, unit tests, canonical SIP-01 vectors, bookmark/vote/WoT fixtures.
- Each engine: app-specific tests plus shared NIP event fixtures; no regressions to providers, identity, ranking, privacy, ads, or application-specific namespaces.
- Each relay: WebSocket EVENT/REQ/COUNT tests, replaceable-event behavior, NIP-11 capability verification, NIP-50 query tests, NIP-77 sync tests, and cross-relay replication.
- Crawler/indexer: observation validation, per-device identity, offline replay, SSRF/rate-limit/privacy checks.
- Deployment: verify production and preview builds, worker bindings/secrets, migrations, and health endpoints separately from repository CI.

## Evidence paths checked

- `sip-01-core/src/engine/bookmarks.ts`
- `sip-01-core/src/engine/bookmarks.test.ts`
- `sip-01-core/src/engine/hooks/useBookmarks.ts`
- `sip-01-core/src/engine/hooks/useVotes.ts`
- `sip-01-core/src/engine/hooks/useWebOfTrustAssertions.ts`
- `sip-01-core/src/index.ts`
- `0xSearchstr/NIP.md`, `0xSearchstr/src/hooks/useNostrBookmarks.ts`
- `0xPresearchstr/NIP.md`
- `UNCAGED-ENGINE/README.md`
- `Dsearch/package.json`, `Dsearch/README.md`
- `Savedd/README.md`, `ios-app/README.md`
- `SIP-Booster-Relay/README.md`, `UNCAGED-Index-Relay/README.md`
- `crawlstr/README.md`, `indexstr/README.md`
