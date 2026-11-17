# Versioning

sip-01-core has three separate version axes. Confusing them is the most common way to break compatibility, so they are tracked independently.

## The three axes

| Axis | Current | Changes when |
|---|---|---|
| **SIP-01 document revision** | v1.3 | The spec repo ([`NostrDanish/SIP-01`](https://github.com/NostrDanish/SIP-01)) publishes a revision. |
| **Wire schema version** (`v` tag) | `"1"` | Only with a spec revision that changes the wire format. |
| **sip-01-core software version** | 0.1.0 (semver, `package.json`) | Any software release of this repo. |

Example of why they differ: v1.2 audited NIP references and v1.3 added optional `role`/`proto` extensions plus an optional NIP-01 `a` pointer to the companion kind 39698 capability profile. Neither revision changes the required kind-39697 wire schema, so `v` stays `"1"`. This repo can ship software fixes and features while both the specification revision and wire schema stay put.

**Protocol compatibility always takes priority over software architecture.** The core may improve freely; the wire behavior may not drift.

## Compatibility policy

- **Pre-1.0 software.** The core is at 0.1.0: the public API ([API reference](api.md)) is settling, and minor releases may adjust non-protocol APIs. Contracts documented as **stable** in `PACKAGE_BOUNDARIES.md` get semver-style care; **experimental** internals (provider internals, the AI provider catalog) may change in any release.
- **Protocol-critical surfaces never change in a software release.** `normalizeIndexUrl`, `documentId`, `contentHash`, the kind (`39697`), the tag schema, and the `v` value are pinned by the spec and its §13 vectors — see [Protocol conformance](protocol-conformance.md).
- **Federation namespaces are frozen.** The `0xsearchstr:*` kinds/tags/d-prefixes are the shared contract with 0xSearchstr and every compatible fork. Renaming one forks the network; extension happens only via new tags or kinds.

## What counts as a breaking change

Breaking (requires the matching axis to move):

- Changing the output of `normalizeIndexUrl` / `documentId` / `contentHash` for any input — a **wire** break; only legitimate through a spec revision with a `v` bump.
- Changing the meaning of an existing SIP-01 field, or requiring a previously optional field — a **spec** break (spec §10: publishers must not change field meaning without bumping `v`).
- Renaming a `0xsearchstr:*` federation namespace — a **network** break (forks the shared index).
- Removing or changing a stable public API export's contract — a **software** break (major bump once the library is 1.0+; noted in release notes pre-1.0).

Not breaking:

- Adding optional extension tags (spec §9 — consumers ignore unknown tags). The registered v1.3 `role` and repeatable `proto` tags are optional; a NIP-01 `a` pointer to kind 39698 is also optional.
- Adding providers, hooks, or exports; changing ranking internals; improving relay machinery — software improvements with identical wire behavior.
- Renaming local-only storage keys with read-through migration (the `dsearch:*` → `sip01:*` pattern via `STORAGE_KEY_RENAMES`).

## Staying compatible as a consumer

1. Import only from the package root (the barrel) — deep imports are internals.
2. Pin your git dependency to a commit or tag.
3. After upgrading, run your app against `npx vitest run src/protocol` in this repo if you touch anything protocol-adjacent; the 45 protocol tests fail loudly on any wire drift.
