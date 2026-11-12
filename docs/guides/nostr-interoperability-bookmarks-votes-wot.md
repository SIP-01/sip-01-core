# Nostr interoperability: bookmarks, reactions and Web of Trust

This is the shared implementation contract for SIP-01 search engines, indexers, relays and compatible clients. It supplements the SIP-01 wire specification and does not change kind 39697.

## Scope boundary

SIP-01 kind 39697 remains a signed observation of a public web document. Do not put personal bookmarks, reading history, votes, provider ranks or private trust data into a 39697 event. Those concerns use their own Nostr event families. Search engines may consume them as ranking and filtering signals without changing the shared document identity fields.

## Bookmarks

Use the existing interoperable standards rather than inventing an application bookmark kind.

| Purpose | Standard | Kind | Behaviour |
|---|---|---:|---|
| Global bookmark list | NIP-51 | 10003 | Replaceable per author; public references are event tags, private references are encrypted in content |
| Categorized bookmark set | NIP-51 | 30003 | Addressable per author and d tag; supports a title and categorized references |
| Individually editable public web bookmark | NIP-B0 | 39701 | Addressable per author and URI; the HTTPS scheme is omitted from d |
| Web URL identifier inside another event | NIP-73 | none | Use i with the normalized URL and k=web |

NIP-51 private items are JSON arrays that mirror Nostr tag arrays and are encrypted with NIP-44 using the logged-in account signer. NIP-04 ciphertext is legacy compatibility only; new writes use NIP-44.

For web references inside a NIP-51 list, use the NIP-73 i/k pair. Public references stay in the event tags. Private references stay exclusively in encrypted content. A private web URL MUST NOT also be published as a kind-39701 event, because kind 39701 is public.

NIP-B0 is for the public, individually editable bookmark record. Its d tag contains the URI, omitting the scheme for HTTPS URIs. The title, published_at and t tags are optional. The content carries the description and may be empty. NIP-22 comments on kind 39701 use kind 1111.

When a client edits a NIP-51 list, it must fetch the freshest replaceable/addressable version, decrypt the private items, apply the change, preserve all other public and private items, then publish the new version. Do not replace a list from a stale snapshot. If private content cannot be decrypted because the signer is locked or does not support NIP-44, do not overwrite it with an empty string. Abort the write or retry when the signer is available.

Readers select the latest kind-10003 event per author and the latest kind-30003 event per author and d tag. Merge public and private items only after successful decryption. An unavailable private list is not an empty list.

## Voting and reactions

NIP-25 distinguishes reactions to Nostr events from reactions to external content.

- Native Nostr event: kind 7. Include the required e target tag. Include the target author's p tag and target-kind k tag when available. For addressable events, include the a coordinate as recommended by NIP-25.
- External web URL: kind 17 with NIP-73 k=web and i=<normalized URL> tags.
- Compatibility: existing legacy kind-7/r URL votes may be read during migration, but clients MUST NOT publish new URL reactions using kind 7/r.
- Numeric upvotes are + or empty content; downvotes are -; emoji reactions are not numeric votes.

Deduplicate by target and author. The most recent reaction by an author wins, with deterministic event-id tie-breaking if timestamps are equal. This ensures a user changing their vote does not count as several votes.

Keep raw up/down totals available. If WoT weighting is enabled, calculate a separate weighted score. Do not silently replace the public raw reaction counts with a weighted count. Explain the active weighting model to users and admins.

## Web of Trust and NIP-85

NIP-85 defines provider discovery and signed assertions. It does not prescribe one global WoT algorithm or a multi-provider merge rule.

| Subject | NIP-85 kind | d tag |
|---|---:|---|
| User or public key | 30382 | Subject pubkey |
| Regular event | 30383 | Event id |
| Addressable event | 30384 | kind:pubkey:d coordinate |
| NIP-73 external identifier | 30385 | External identifier, such as a normalized web URL |
| Trusted provider list | 10040 | Replaceable list of service/provider/relay rows |

A provider row in kind 10040 uses service, provider pubkey and relay hint. For example, a provider that supplies user ranks is named by the service 30382:rank. Private provider rows may be stored in the NIP-44-encrypted content of kind 10040.

An assertion is accepted for a trust decision only if:
1. Its NIP-01 event id and signature verify.
2. Its author is the exact provider selected for that service by the relevant observer.
3. Its kind matches the selected service.
4. Its d tag exactly matches the requested subject.
5. Its rank is a valid integer in the provider's documented range.
6. For kind 30385, its NIP-73 k tag matches the external identifier type.

Do not trust an arbitrary kind-30382 event as a WoT score. Kind 30382 has other uses, including user-authored contact cards. Provider author and selected service must be checked. Missing rank is unknown, not automatically rank zero. A rank-zero removal marker is meaningful only when the selected provider defines it that way.

Use the right subject for the signal:
- kind 30382 can describe the indexer, author, curator or other user account.
- kind 30383 can describe a regular Nostr event.
- kind 30384 can describe an addressable Nostr event.
- kind 30385 with k=web can describe the external web page itself.

For a SIP-01 observation, separate the indexer identity from the indexed page. The observation author is the indexer; the external URL is the page. A search engine can use a 30382 assertion about an indexer and a 30385 assertion about the web URL as separate signals. Do not treat an indexer's reputation as proof that the page itself is trustworthy.

## Platform and personal policy

Each host supplies its own platform trust policy. The policy may include the platform's trusted provider list, provider-specific thresholds, whether personal trust is allowed, the allowed merge strategies, how unresolved providers are handled, and hard moderation rules.

A logged-in user may select their own provider from their own kind-10040 list. Public rows may be read directly. Private rows must be decrypted locally through the logged-in NIP-44 signer. The user's follow graph and private provider selection must never be sent to a public indexer or copied into shared SIP-01 observations.

Administrator permissions:

| Admin permission | Meaning |
|---|---|
| disabled | Ignore personal providers and use the platform policy only |
| augment-only | Personal WoT may be combined with platform WoT, but cannot replace platform positive trust |
| user-choice | User may choose an allowed combination strategy or personal override |

Combination strategies:

- intersection: both providers must accept a subject. This is the strictest filter.
- union: either provider may accept a subject. This is the most permissive filter.
- both-first: either provider may accept a subject, but a subject accepted by both gets a higher trust tier.

Apply each provider's threshold to that provider's own score. Do not average rank values from unrelated providers. NIP-85 does not define cross-provider score arithmetic, and the values may represent different algorithms or scales.

A personal override replaces positive platform trust ranking only. Platform moderation, mandatory blocks and hard-deny rules remain in force and cannot be overridden by a personal provider.

During first sync or provider outages, use the admin-selected unknown-state policy. The rollout-safe default is to preserve ordinary search behaviour while trust data is unavailable, rather than unexpectedly hiding all results. Show the user when a WoT filter is pending or incomplete.

## Voting weight

The first implementation uses explicit membership tiers, not arbitrary provider-rank multiplication. For example:

| Trust outcome | Vote weight |
|---|---:|
| Disabled or unresolved | 1 |
| Trusted by one selected provider | 1 |
| Trusted by both platform and personal providers | 2 |
| Excluded or hard-blocked | 0 |

The multiplier is a configurable engine policy, not a NIP-25 field. Keep raw totals visible. Do not let an anonymous device-indexing identity inherit the signed-in user's personal WoT unless the user explicitly chooses attributable voting and the host authorizes it.

## Relay compatibility

SIP-01 relays remain generic NIP-01 relays. They must preserve valid kinds, tags and content for kind 7, kind 17, kinds 10003 and 30003, kind 39701, kind 10040 and kinds 30382-30385. They must apply NIP-01 replaceable and addressable semantics correctly.

NIP-73 and kind-17 searches rely on single-letter tag filters #i and #k. A relay's generic event storage is not enough if its tag index cannot answer those filters. Relay schema and migration tests must cover #i and #k on both fresh and upgraded databases.

Advertise a NIP in NIP-11 only when the relay implements the relevant relay-facing behaviour. Storing arbitrary NIP-01 events does not make a relay a NIP-85 calculation provider.

## Regression checklist

- [ ] New web URL votes publish kind 17 with k=web and i=<normalized URL>.
- [ ] New native event reactions publish kind 7 with e and recommended author/kind/address hints.
- [ ] Legacy kind-7/r URL votes remain readable but are never emitted.
- [ ] Emoji reactions are not counted as numeric upvotes or downvotes.
- [ ] NIP-51 kinds 10003 and 30003 round-trip public references.
- [ ] NIP-51 private references are NIP-44 encrypted and never copied into public tags.
- [ ] A private bookmark never produces a public kind-39701 event.
- [ ] NIP-B0 kind 39701 is parsed as a public addressable bookmark.
- [ ] NIP-85 assertions are checked against the selected provider, service and exact subject.
- [ ] Personal WoT is ignored when the platform sets permission to disabled.
- [ ] Personal WoT cannot override when the platform selects augment-only.
- [ ] Personal override cannot bypass platform hard moderation.
- [ ] Different provider rank values are not averaged.
- [ ] Relay #i and #k filters work on fresh and upgraded databases.
- [ ] SIP-01 kind-39697 test vectors remain byte-identical.
