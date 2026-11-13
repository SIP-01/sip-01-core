# Nostr Ecosystem Conformance Contract

Status: implementation contract for SIP-01 hosts; this document does not change any NIP or SIP-01 wire format.

This contract defines the shared behavior that SIP-01 search engines, indexers, relays, and compatible clients must implement. Application-specific branding, provider selection, relay defaults, AI prompts, moderation policy, and ranking weights remain host-owned. Protocol parsing, event construction, cryptographic handling, and conformance tests belong in `sip-01-core`.

## 1. Normative compatibility rules

- NIP specifications are authoritative for Nostr event shapes. SIP-01 is authoritative only for its own kind-39697 observation format.
- Do not repurpose an existing NIP event kind or silently change its tags.
- Preserve SIP-01 v1 wire compatibility: kind `39697`, wire tag `v=1`, and the canonical URL/document/content hash test vectors. A wire change requires a separately versioned SIP-01 spec revision.
- Verify event signatures and validate event structure before indexing, ranking, displaying, or acting on events.
- Unknown tags and unknown extension fields must be preserved during read-modify-write operations unless a security rule explicitly requires rejection.
- Never publish search queries, private bookmark URLs, private AI prompts, API keys, or private user data into public events.

## 2. Bookmarks: public and private

### Public web bookmarks

Use NIP-B0 kind `39701`: one addressable bookmark per author and URI.

- Require exactly one non-empty `d` tag.
- For HTTPS, the NIP-B0 `d` value omits the scheme and starts at the hostname. For HTTP and other URI schemes, retain the scheme as specified by NIP-B0.
- `content` is the user's bookmark description and may be empty.
- Optional metadata includes `title`, `t`, and `published_at`. On edits, preserve the original first-publication timestamp.
- Republish the same author/kind/d coordinate to edit the bookmark.
- Public bookmark discovery is by kind `39701`, author, and/or `#d` filters. Do not require a private application database.

### Personal NIP-51 lists

- Global bookmarks use kind `10003`.
- Categorized bookmark sets use kind `30003` and require a stable, non-empty `d` tag; use `title` for the human-readable category name.
- Use standard NIP-51 `e` and `a` references for Nostr events/addressable content where applicable.
- For external web URLs, use the NIP-73 `i` identifier with the matching `k=web` discriminator. Normalize by removing the fragment while preserving path and query semantics; do not invent a stronger canonicalization than NIP-73 specifies.
- Public references live in the event tags. Private references are JSON-serialized tag arrays encrypted in `content` with NIP-44.
- New writes MUST use NIP-44. NIP-04 is read-only migration compatibility; never re-encrypt new writes with NIP-04.
- A private URL must never be mirrored to kind `39701`, copied into public tags, included in logs, or sent to an indexing/AI provider.
- Read-modify-write must fetch the latest valid list, decrypt existing private content before replacement, preserve unrelated tags and private items, and abort without publishing if decryption fails. Do not silently erase data.
- Avoid lost updates: read from the configured read-relay set, detect conflicting/newer list events, and only publish after the source list is sufficiently complete. Make partial-relay failure visible.

### Cross-client behavior

- Public web bookmarks must remain independently discoverable as NIP-B0 events even when a client does not understand a particular NIP-51 extension.
- A client that understands NIP-51 but not NIP-B0 must still retain unknown references rather than deleting them on list updates.
- A client must clearly distinguish a public bookmark from a private personal save. Private means the URI is encrypted in the user's list, not merely hidden in the UI.
- Provide import/export and browsing for both kind-10003 global lists and kind-30003 categories; saving without a way to inspect, remove, or migrate bookmarks is incomplete.

## 3. Votes and reactions

Use NIP-25, with NIP-73 for external content identifiers.

- Native Nostr event reactions: kind `7`, with the target `e` tag and target author `p` tag; include `k` where applicable. Use `+` for upvote and `-` for downvote.
- External web page reactions: kind `17`, with `k=web` and `i=<normalized URL without fragment>`. Use `+` and `-` for directional votes.
- Do not publish new kind-7 URL reactions using legacy `r` tags. Legacy kind-7/`r` events may be read during migration only.
- De-duplicate by event id, verify signatures, and prevent one author from being counted repeatedly for the same target/direction according to NIP-25 reaction semantics.
- Keep raw reaction counts separate from trust-weighted ranking. Display the weighting policy and do not imply that weighted scores are universal Nostr consensus.
- Anonymous/device-identity voting is a host privacy option. If the user chooses attributable voting, sign with the user's configured Nostr signer. Never export or store raw private keys in the core.

## 4. Web of Trust and ranking policy

Use NIP-85 Trusted Assertions rather than inventing a competing reputation event format.

- Kind `10040`: the user's preferred trusted-assertion provider list; public rows use tags and private rows use NIP-44 encrypted content.
- Kind `30382`: user/pubkey assertions.
- Kind `30383`: event assertions.
- Kind `30384`: addressable-event assertions.
- Kind `30385`: NIP-73 external-identifier assertions. Web page assertions must include the corresponding `k=web` context.
- Validate assertion author against the selected provider key, subject coordinate, event kind, relay source, and expected service before consuming a score.
- A provider's `rank` is provider-specific, not a universal score. Never combine different providers as if their values shared a scale unless the host explicitly defines a calibrated combination.

Hosts must expose an explicit policy with these modes:

1. `off`: no WoT influence.
2. `platform`: apply the platform-admin-selected provider/policy.
3. `personal`: apply the logged-in user's selected provider/policy.
4. `mixed`: combine platform and personal evidence using an explicit strategy (intersection or union), thresholds, and unknown-provider behavior.

Platform administrators control whether personal WoT is available and whether it is ignored, combined, or allowed to determine ranking. Personal WoT must never bypass platform hard blocks, legal/safety blocks, verified malware blocks, or explicit administrator takedowns. Hard blocks are applied after score calculation as non-bypassable exclusions.

Unknown or unavailable assertion data must be represented as unknown/pending, not silently converted into a high trust score. The host must document whether unknown evidence is allowed, excluded, or temporarily shown without WoT weighting.

## 5. Reports and moderation

- NIP-56 reports use kind `1984` and the correct target tags/report type.
- NIP-32 labels use kind `1985` with explicit `L` namespace and `l` label tags.
- NIP-09 kind `5` deletion events are used only for deletion semantics supported by the referenced event; do not treat a deletion request as proof that every relay removed data.
- Separate user reports, trusted moderator labels, automated detection, and administrator hard blocks. Reports are signals, not automatic proof.
- Moderation namespaces must be namespaced per product/authority and must not collide with the frozen `0xsearchstr:*` federation namespaces.

## 6. Search, indexing, relays, and synchronization

- NIP-50 `search` is a relay capability, not a guarantee that every relay supports identical ranking or query syntax. Discover support through NIP-11 `supported_nips`; query multiple capable relays and validate returned results.
- SIP-01 observations remain kind `39697`, signed by the indexer's own key. Verify URL/document identity and content hashes against the canonical spec before accepting observations.
- NIP-77 Negentropy is a synchronization optimization; it does not change event meaning or replace ordinary Nostr REQ/EVENT semantics.
- NIP-66 relay discovery announcements are untrusted hints. Verify discovered relay metadata using NIP-11 and active capability checks before adding relays to a pool.
- Relays must enforce configured event-kind policy consistently across REQ, COUNT, EVENT, and synchronization paths. A relay that stores kind 39697 but drops kind 39701 or 17 must advertise/describe that limitation rather than claiming full ecosystem compatibility.
- Preserve standard Nostr event validation, size limits, rate limits, and relay policy. Never trust client-supplied ranking values as authoritative.

## 7. AI integration contract

- AI providers are replaceable adapters behind the shared provider contract. Provider keys and privileged credentials stay server-side or in user-controlled secret storage.
- Search/index pipelines must not publish raw queries, private bookmarks, private WoT settings, or prompts as Nostr events.
- AI answers must be traceable to retrieved evidence. Distinguish source facts from model-generated synthesis and preserve source URLs/event references.
- AI must not silently override platform moderation, hard blocks, or user privacy settings.
- Provider routing may use free/local providers first and paid fallbacks only under host policy; this routing is not a Nostr wire-protocol change.

## 8. Required conformance test matrix

Every host and infrastructure repo must test the applicable rows before release.

| Area | Required tests |
| --- | --- |
| SIP-01 | Canonical §13 vectors; URL normalization; document id; content hash; signature and tag validation; v1 compatibility |
| NIP-51 | kind 10003 and 30003; public/private separation; NIP-44 round-trip; NIP-04 read-only migration; unknown-tag preservation; failed-decrypt abort; duplicate prevention; concurrent update handling |
| NIP-B0 | kind 39701; HTTPS vs HTTP d-tag rules; one d tag; edit same coordinate; first published_at preservation; query by #d |
| NIP-25/73 | kind 7 native event; kind 17 external URL; + and -; legacy kind-7/r read-only; duplicate and signature handling |
| NIP-85 | all four assertion subjects; kind 10040 public/private providers; provider-key verification; stale/missing provider behavior; platform/personal/mixed policy; hard-block precedence |
| NIP-50/77/66 | supported_nips discovery; multi-relay query; Negentropy fallback; relay capability validation; untrusted discovery handling |
| Moderation | NIP-56 reports; NIP-32 labels; NIP-09 deletion semantics; platform hard blocks cannot be bypassed by personal WoT |
| AI/privacy | no query leakage; no private bookmark leakage; no client-bundled privileged keys; source attribution; provider fallback behavior |

## 9. Repository integration order

1. **Canonical spec and core:** keep NIP mappings, pure event builders/parsers, validators, policy resolution, and conformance vectors here.
2. **Dsearch:** integrate the shared core as the reference/control-plane host and expose the platform policy controls.
3. **0xSearchstr and 0xPresearchstr:** replace duplicated event construction and bookmark/vote/WoT logic with core APIs; preserve app-specific provider and referral behavior.
4. **UNCAGED Engine:** keep the lightweight template but expose optional, documented adapters for bookmarks, votes, moderation, and AI.
5. **Savedd and other Nostr clients:** adopt the same public/private bookmark and reaction contracts without importing Dsearch-specific branding or policy.
6. **Crawlstr and Indexstr:** validate and publish only canonical SIP-01 observations; never index private bookmark or query data.
7. **SIP Booster Relay, UNCAGED Index Relay, and Crawlstr SIP Relay:** align accepted event kinds, NIP-50/NIP-77 behavior, validation, and capability reporting.
8. **SIP Dashboard, SIP-01 Node, and Orbstr:** consume the same versioned core/spec contracts and expose compatibility status.

No repository is considered integrated merely because it compiles. Each must pass its own tests plus the cross-repository event fixtures and relay interoperability checks.
