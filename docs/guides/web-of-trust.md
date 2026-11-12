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
