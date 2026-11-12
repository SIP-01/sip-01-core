# AI answers, search trust and citation integrity

AI answer generation is a consumer of search evidence, not a source of Nostr trust.

## Evidence flow

The shared search pipeline applies the following order:

1. Search providers return candidate results.
2. The host's hard moderation policy removes blocked or disallowed content.
3. The selected NIP-85 providers are queried for the exact author, event, addressable-event or external-web subject.
4. The platform/personal Web-of-Trust policy filters and orders the remaining results.
5. The AI answer layer receives this already-filtered result set and its local trust provenance.

The SearchResult.trust field is local runtime metadata. It records the active mode (platform, personal or combined), the membership tier, whether the assertion data was pending, and the policy reason. It is not written into the source Nostr event, does not alter the SIP-01 kind-39697 wire format and is not a NIP-85 assertion.

## Citation integrity

- AI answers should cite the original Nostr event ID or the original external URL supplied by the result.
- Preserve the original result title, source and event/URL reference; never manufacture an event ID, NIP-19 identifier or relay pointer.
- An AI-generated summary is derived content. It must not be republished as a kind-39697 web observation, because that kind means an indexer actually observed a public web document.
- If a host chooses to publish an authored AI summary, it must use a separately appropriate content kind and identify the authoring/application context; do not impersonate the original page or indexer.
- Model confidence, embedding similarity, sentiment or generated quality scores are not NIP-85 trust ranks. They remain local ranking features unless a separately specified provider publishes a correctly signed NIP-85 assertion.

## Privacy boundaries

- Never put a user's search query, private bookmark URLs, private provider list, personal follow graph or personal trust circle into SIP-01 kind 39697 events.
- Private bookmarks and private provider choices use NIP-51 kind 10003/30003 with NIP-44-encrypted content through the logged-in account signer.
- Do not send private NIP-51 plaintext to an AI provider unless the user explicitly invokes an AI feature that needs that private content and the host's privacy policy permits it.
- Do not pass secret keys to an AI model, local storage migration, CLI or relay. Signing and NIP-44 operations stay inside the user's signer.
- Treat model-generated URLs, citations and tool instructions as untrusted output. Validate URL schemes, verify source events, and preserve existing Nostr trust-boundary checks.

## Degraded operation

If a selected trust provider is unreachable or the initial assertion sync is incomplete, the host's configured unknownBehavior applies. The safe rollout default is to keep ordinary search results visible while marking trust provenance as pending. The AI layer must not claim that an unverified result is trusted merely because it is present in its context.
