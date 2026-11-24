import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Synthetic schema-upgrade evidence, not a merchant verification. All writes
 * use the runtime role and real financial guards; no trigger or ACL is bypassed.
 * The previous P04 schema must exist before write(), and the complete history
 * (including the canonical workflow discriminator) before verify().
 */
export function refundUpgradeSentinel({ query, transaction }) {
  const ids = Object.fromEntries(
    [
      'credit',
      'received',
      'refund',
      'paid',
      'recorder',
      'approver',
      'requester',
      'decider',
      'correlation',
    ].map((name) => [name, randomUUID()]),
  );
  const providerReference = `UPG${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const transferReference = `UPGR${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const digest = createHash('sha256')
    .update(`synthetic-upgrade:${providerReference}`)
    .digest('hex');
  let previous;
  return {
    async write(url) {
      await transaction(url, [
        [
          `INSERT INTO app.provider_credit (id, provider, merchant_account, provider_reference,
             currency, amount_minor, occurred_at, source, evidence_digest, status, active_slot,
             recorded_by_subject, revision, created_at, updated_at, correlation_id)
           VALUES ($1, 'SHAM_CASH', 'synthetic-upgrade-merchant', $2, 'SYP', 100000,
             now() - interval '1 minute', 'MERCHANT_STATEMENT', $3, 'PENDING_APPROVAL', 1,
             $4, 1, now(), now(), $5)`,
          [ids.credit, providerReference, digest, ids.recorder, ids.correlation],
        ],
        [
          `UPDATE app.provider_credit SET status='UNALLOCATED', unallocated_reason='NO_CLAIM',
             decided_by_subject=$2, decided_at=now(), revision=2, updated_at=now() WHERE id=$1`,
          [ids.credit, ids.approver],
        ],
        [
          `INSERT INTO app.ledger_journal (id, kind, business_ref, credit_id, posted_at, correlation_id)
           VALUES ($1, 'CREDIT_RECEIVED', $2, $3, now(), $4)`,
          [ids.received, `credit:${ids.credit}:received`, ids.credit, ids.correlation],
        ],
        [
          `INSERT INTO app.ledger_line (journal_id, line_no, account, side, currency, amount_minor) VALUES
             ($1, 0, 'CLEARING_SHAM_CASH', 'DEBIT', 'SYP', 100000),
             ($1, 1, 'PROVIDER_CREDITS_UNALLOCATED', 'CREDIT', 'SYP', 100000)`,
          [ids.received],
        ],
        [
          `INSERT INTO app.payment_refund (id, credit_id, provider, currency, amount_minor,
             reason, channel, status, requested_by_subject, requested_at, revision, updated_at, correlation_id)
           VALUES ($1, $2, 'SHAM_CASH', 'SYP', 40000, 'DUPLICATE_PAYMENT', 'MANUAL_OUT_OF_BAND',
             'REQUESTED', $3, now(), 1, now(), $4)`,
          [ids.refund, ids.credit, ids.requester, ids.correlation],
        ],
        [
          `UPDATE app.payment_refund SET status='APPROVED', decided_by_subject=$2,
             decided_at=now(), revision=2, updated_at=now() WHERE id=$1`,
          [ids.refund, ids.decider],
        ],
      ]);
      previous = (
        await query(url, 'SELECT to_jsonb(r) AS facts FROM app.payment_refund r WHERE id=$1', [
          ids.refund,
        ])
      ).rows[0]?.facts;
      assert.ok(previous, 'Legacy refund must exist before migration');
      assert.equal(previous.workflow, undefined, 'Sentinel must run under the previous schema');
    },
    async verify(url) {
      assert.ok(previous, 'Previous refund was not seeded');
      const preserved = (
        await query(url, 'SELECT to_jsonb(r) AS facts FROM app.payment_refund r WHERE id=$1', [
          ids.refund,
        ])
      ).rows[0]?.facts;
      assert.equal(preserved?.workflow, 'CREDIT_V1');
      const facts = { ...preserved };
      delete facts.workflow;
      assert.deepEqual(facts, previous, 'Migration cannot rewrite existing financial facts');
      // A legacy approval still requires its evidence digest before completion.
      await assert.rejects(
        query(
          url,
          `UPDATE app.payment_refund SET status='SUCCEEDED', completed_by_subject=$2,
          completed_at=now(), provider_refund_reference=$3, revision=3, updated_at=now() WHERE id=$1`,
          [ids.refund, ids.decider, transferReference],
        ),
        /payment_refund_facts/,
      );
      await transaction(url, [
        [
          `UPDATE app.payment_refund SET status='SUCCEEDED', completed_by_subject=$2,
             completed_at=now(), provider_refund_reference=$3, evidence_digest=$4,
             revision=3, updated_at=now() WHERE id=$1`,
          [ids.refund, ids.decider, transferReference, digest],
        ],
        [
          `INSERT INTO app.ledger_journal (id, kind, business_ref, credit_id, posted_at, correlation_id)
           VALUES ($1, 'REFUND_PAID', $2, $3, now(), $4)`,
          [ids.paid, `refund:${ids.refund}:paid`, ids.credit, ids.correlation],
        ],
        [
          `INSERT INTO app.ledger_line (journal_id, line_no, account, side, currency, amount_minor) VALUES
             ($1, 0, 'PROVIDER_CREDITS_UNALLOCATED', 'DEBIT', 'SYP', 40000),
             ($1, 1, 'CLEARING_SHAM_CASH', 'CREDIT', 'SYP', 40000)`,
          [ids.paid],
        ],
      ]);
      const done = (
        await query(url, 'SELECT workflow, status, revision FROM app.payment_refund WHERE id=$1', [
          ids.refund,
        ])
      ).rows[0];
      assert.deepEqual(done, { workflow: 'CREDIT_V1', status: 'SUCCEEDED', revision: 3 });
      const balance = (
        await query(
          url,
          `SELECT SUM(CASE l.side WHEN 'DEBIT' THEN l.amount_minor ELSE -l.amount_minor END)::text AS amount
        FROM app.ledger_line l JOIN app.ledger_journal j ON j.id=l.journal_id
        WHERE j.credit_id=$1 AND l.account='CLEARING_SHAM_CASH'`,
          [ids.credit],
        )
      ).rows[0];
      assert.equal(balance?.amount, '60000');
      await assert.rejects(
        query(url, 'SELECT app.billing_assert_provider_credit($1)', [ids.credit]),
        /permission denied/,
      );
    },
  };
}
