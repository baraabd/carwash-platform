# Contract request to Lane E — Wallet custody projection (P06-B3)

Status: **SUBMITTED, not accepted.** Requested by Lane B (Commerce & Finance) on
2026-10-11 for child P06-B3. Nothing in this request is consumed by Wallet
until E merges a versioned artifact. Wallet code that needs these items fails
closed or stays unbound until then.

Wallet consumes only the already-published `billing.v1` custody events
(`packages/event-contracts/src/billing-v1.ts`, P04-E1). It publishes no events
and owns no money. It keeps a read projection that references Billing events.

| ID      | Request | Why | Current behaviour without it |
| ------- | ------- | --- | ---------------------------- |
| CR-B-P06-WAL-01 | Add `"@carwash/platform-messaging": "workspace:*"` to `services/wallet/package.json` and refresh `pnpm-lock.yaml` (root lockfile is E-owned). | The broker binding (queue, ACK after commit, bounded redelivery, DLQ) belongs to the messaging foundation. Wallet must not hand-roll AMQP. | `BILLING_EVENTS_BINDING = 'NOT_BOUND'`. No queue is consumed. The projection gets no live events. `BUSINESS_READY = false`. |
| CR-B-P06-WAL-02 | Broker topology: a durable queue `wallet.billing-custody.v1` bound to exchange `washgo.billing.events`. Routing keys: `billing.cash-collected.v1`, `billing.cash-collection-reversed.v1`, `billing.custody-handover-changed.v1`. Add a dead-letter queue and a bounded delivery limit. Wallet's broker identity gets read-only access to that queue. | The broker ACL establishes that Billing is the producer, so the `producer` field is not trusted. Same-id-different-bytes deliveries are rejected as non-retryable (409) and must reach the DLQ. | None bound. |
| CR-B-P06-WAL-03 | Register `wallet.v1` in `@carwash/contracts`: `GET /internal/v1/wallet/custody/holders/me` (access `permission:billing.cash.collect`, account principals only) and `GET /internal/v1/wallet/custody/holders/:subject` (access `permission:billing.read`). Include the response shape below. | Lane B must not copy DTOs into a shared package. Gateway and admin/technician consumers need a versioned shape. | The owner routes exist and are tested. No registry entry and no Gateway alias exist. |
| CR-B-P06-WAL-04 | Decide whether Wallet keeps Billing's grant names (`billing.cash.collect` for self, `billing.read` for Finance) or Identity issues Wallet aliases such as `wallet.custody.read:self` / `wallet.custody.read`. | Least privilege. The same grants as Billing's authoritative custody reads (CR-B-08) keep the two views consistent. | Wallet checks the Billing grant names. Identity issues them only after CR-B-08 is accepted. |
| CR-B-P06-WAL-05 | Readiness promotion criteria for Wallet: broker bound (CR-B-P06-WAL-01/02), contract registered (CR-B-P06-WAL-03), and real Billing-to-Wallet event acceptance on a shared broker. | Readiness is an E-owned gate. | `/health/ready` returns 503. |

## Proposed `wallet.v1` custody response (owner implementation as shipped)

```json
{
  "projection": "wallet.technician-custody",
  "authoritative": false,
  "authority": "billing",
  "holder": "<uuid>",
  "asOf": "<UTC ms ISO>",
  "positions": [
    {
      "currency": "SYP",
      "collected": { "currency": "SYP", "amountMinor": "200000", "scale": 2 },
      "reversed": { "...": "Money" },
      "held": { "...": "Money (signed; transiently negative while incomplete)" },
      "inHandover": { "...": "Money" },
      "receivedByTreasury": { "...": "Money" },
      "settled": { "...": "Money" },
      "outstanding": { "...": "Money = held + inHandover" },
      "shortage": { "...": "Money" },
      "overage": { "...": "Money" },
      "complete": true,
      "source": {
        "lastEventId": "<billing event uuid>",
        "lastEventAt": "<UTC>",
        "revision": 3,
        "updatedAt": "<UTC>"
      }
    }
  ]
}
```

`held` is the only signed amount. It is negative only while a handover event
has arrived before the collections it contains, and `complete` is then `false`.
The projection never reports a customer payment or a company receipt beyond
what Billing's events state. Billing's
`GET /internal/v1/billing/custody/holders/:subject` remains the authoritative
read.

No secret, account number, phone number or customer data is part of this
request.
