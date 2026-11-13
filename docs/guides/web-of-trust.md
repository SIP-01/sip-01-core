# Web of Trust and NIP-85

The search engine's WoT layer sits above the SIP-01 document protocol. Kind 39697 continues to mean "this indexer observed this public web document"; it does not contain private user identities, votes, trust-provider ranks or private social graph data.

## Provider discovery and verification

The host resolves the platform provider from an administrator-controlled provider list and may resolve the personal provider from the logged-in user's kind-10040 list. Kind-10040 rows identify a service, provider pubkey and relay hint. Private rows are decrypted through the logged-in user's NIP-44 signer.

A trust assertion is accepted only when the NIP-01 signature verifies, the author is the selected provider for that service, the event kind matches the service, the d tag matches the requested subject, and rank is a valid integer in the provider's declared scale. For kind 30385, validate the NIP-73 k tag as well.

## Policy model

The host-injected EngineRuntime.webOfTrust configuration contains platform providers, optional personal providers, administrator policy and the user's allowed personal preference.

Admin permission values:
- disabled: personal providers are ignored.
- augment-only: personal providers can combine with platform trust but cannot replace it.
- user-choice: the user can choose among allowed combination strategies or request personal override.

Combination strategies:
- intersection: both sources must accept.
- union: either source accepts.
- both-first: either source accepts, but a subject accepted by both receives a higher trust tier.

The provider thresholds are independent. Raw scores from unrelated providers are never averaged. A personal override replaces the positive platform trust source only; the platform moderation set and hard blocks remain higher priority.

## Trust subjects

Use 30382 for the indexer/author account, 30383 for a regular Nostr event, 30384 for an addressable event, and 30385 with the correct NIP-73 identifier type for external content. For a SIP-01 web result, evaluate the indexer's identity separately from the external page URL.

## Filtering and voting

The Web-of-Trust decision returns inclusion, a trust tier, pending state and a reason. Hosts apply that decision after hard platform moderation. The vote helper maps the resolved tier to a small influence multiplier while keeping raw NIP-25 counts available alongside weighted totals.

When providers are syncing or unavailable, the administrator's unknown-state policy decides whether results remain visible. The safe default during rollout is to preserve normal search results until the first successful provider sync.


## Provider list ownership

The selected provider rows are resolved by the host from an administrator-owned platform list and, when permitted, the logged-in account's own kind-10040 list. `buildNip85ProviderListDraft()` writes public provider rows as tags and private rows as NIP-44-encrypted JSON tag arrays. `decryptNip85PrivateProviderRows()` opens those private rows through the account signer before `parseNip85ProviderList()` validates the selected services. The host must still verify the kind-10040 event signature and enforce its own authorization policy before injecting the result into `EngineRuntime.webOfTrust`.

A kind-10040 list may contain several candidates for the same service, such as different 30382:rank providers. The host settings UI should present those candidates and inject exactly one selected provider per service into the active platform or personal policy. The engine rejects duplicate selected providers for one service rather than averaging unrelated rank values or silently choosing whichever relay replies last.

## Shared vote ranking

The core search hook now retrieves verified NIP-25 reactions for visible result targets and applies a bounded community signal after platform moderation, NIP-85 subject filtering, and query relevance. Positive reactions add up to the configured `maxBoost`; negative reactions subtract up to `maxPenalty`; `minVotes` controls how quickly the cap is reached. Defaults are 3 weighted votes, +6 score points, and -9 score points. Hosts may disable this through `EngineRuntime.communityRanking.enabled` or tune the limits.

The vote hook keeps raw up/down counts and weighted up/down totals separate. It selects the latest valid reaction per author/target; when NIP-85 voter assertions are configured, their policy determines the weight. Pending/unavailable assertions follow the configured unknown-state policy rather than inventing trust. Search result moderation hard-blocks still run before community ranking and cannot be reversed by votes.

This behavior is provided by the shared `sip-01-core` `useProviderSearch()` and `useVoteCounts()` hooks. A host that still uses local/duplicated search and vote hooks does **not** inherit this behavior merely by adding the package; it must migrate its result search and vote integration to the shared hooks/runtime. The remaining app migration matrix is tracked separately from the core contract.
