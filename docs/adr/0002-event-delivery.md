# ADR 0002 — Durable event delivery
Status: proposed baseline, 2026-09-19. Not implemented in this foundation.

Use RabbitMQ for business integration, HTTP for bounded synchronous needs and Socket.IO for non-authoritative UI updates. One queue per subscriber service; replicas of the same subscriber compete on that queue. Broker identity and resource ACLs establish publisher authorization, not an unsigned JSON producer field.

Commit domain changes + Outbox atomically. Publish with persistent messages, confirms and explicit handling of unroutable messages. Mark Outbox only after confirmed routing; safe duplicates remain possible. Commit Inbox uniqueness + consumer-local effects atomically, then ACK. Use bounded retries, DLQ, alerting and controlled replay.

External effects have separate idempotency/reconciliation. There is no universal exactly-once guarantee. Persist saga state and deadlines; never keep the only workflow state in a gateway process. Ordering is aggregate-specific and projections handle old versions and gaps.
