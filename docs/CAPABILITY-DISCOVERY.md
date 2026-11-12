# SIP-01 companion — capability announcements (kind 39698)

`draft` `optional` `kind: 39698`

This document is **not** a change to SIP-01 kind 39697. Schema `v` of a web observation stays `"1"`. Clients that only understand §1–§20 of SIP-01 can ignore this file.

Checked on **2026-11-07**:

- `nostr-protocol/nips` README event-kind table: 39698 absent. Nearby assigned kinds include 39000–39005, 39089, 39092, 39701.
- `nostr-protocol/registry-of-kinds` `schema.yaml`: 39698 absent. 39697 is also absent there (SIP-01 is still a draft allocation).
- `org:nostr-protocol` code search for `39698`: no hits.

If a later NIP claims 39698, stop publishing it and move. Do not squat silently.

## Why not an existing kind

| Kind | Why it is the wrong record |
|---|---|
| 39697 | One question only: an indexer saw this URL. Overloading it breaks `d` / `u` / `x`. |
| 31990 | NIP-89 handler information. `k` means "I open this Nostr kind". |
| 31989 | A person's recommendation of a handler. |
| 32267 | NIP-82 software application (package id, installable platforms). |
| 31992 | NIP-CD slash command. |
| 30402 | NIP-99 classified listing. |
| 30078 | NIP-78 says the data is not a shared protocol. |
| 5000–7000 | NIP-90 job request and result. That is invocation, which this profile does not carry. |

NIP-01 `d`, `t`, `a`, NIP-31 `alt`, and NIP-40 `expiration` are reused as themselves.

## Event

Addressable. One live event per `(pubkey, d)`.

```json
{
  "kind": 39698,
  "content": "{\"name\":\"Echo\",\"summary\":\"Returns text.\",\"about\":\"Local test tool.\"}",
  "tags": [
    ["d", "echo"],
    ["v", "1"],
    ["role", "tool"],
    ["proto", "mcp"],
    ["price", "free"],
    ["t", "echo"],
    ["endpoint", "https://example.com/mcp"],
    ["r", "https://example.com"],
    ["expiration", "1800000000"],
    ["alt", "Capability: Echo"]
  ]
}
```

### Tags

| Tag | Rule |
|---|---|
| `d` | Required. `^[a-z0-9][a-z0-9-]{0,63}$` |
| `v` | Required. `"1"` for this document. Unknown `v` is ignored by strict readers. |
| `role` | Required unless `status=withdrawn`. One of `agent`, `tool`, `model`, `api`, `compute`, `dataset`, `gateway`. |
| `proto` | Required unless withdrawn. One or more of `mcp`, `http`, `contextvm`, `nostr`, `a2a`. |
| `price` | Required unless withdrawn. `free`, `freemium`, `metered`, `subscription`, `prepaid`, `private`. |
| `t` | Optional capability words, lowercase keywords. Relays can filter `#t`. |
| `endpoint` | Optional. `https:` or `wss:` only. |
| `r` | Optional homepage, `https:` only. |
| `a` | Optional NIP-01 pointer, for example a `31990:` handler that performs Nostr jobs for this service. |
| `expiration` | Optional NIP-40 unix timestamp. |
| `alt` | Required human description (NIP-31). |
| `status` | `withdrawn` replaces the addressable event and removes it from search. |

`content` is JSON: `name`, `summary`, optional `about`, optional `priceNote`. No prompts, secrets, or private endpoints.

Withdraw by publishing a replacement with the same `d` and `["status","withdrawn"]`. That is the addressable update. It is not a kind 39697 delete.

## Link from the web index

A kind 39697 observation MAY add, without bumping schema `v`:

- `["a", "39698:<64-hex-pubkey>:<d>"]`
- `["role", "<keyword>"]`
- `["proto", "<keyword>"]` (repeatable)

`d`, `u`, and `x` stay defined by SIP-01 §3, §7, and §8. Indexers that do not know these tags skip them.

## Safety

- Discovery is not invocation.
- A price tag does not authorize payment.
- Nostr events do not carry model traffic or file bytes.
- Reputation is not a score in this event. Use separate NIP-32 labels or NIP-85 assertions if you need evidence.
