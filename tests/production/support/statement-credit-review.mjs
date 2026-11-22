/* global document -- page.evaluate callbacks run in the browser */
/**
 * Test-only proposal for the existing Admin reconciliation modal. No app imports
 * this module. The original required financial journey remains authoritative.
 * A pending real owner record supplies masked facts; this preview sends nothing.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export async function captureStatementCreditProposal({ page, output, credit }) {
  assert.equal(credit.source, 'MERCHANT_STATEMENT');
  assert.equal(credit.status, 'PENDING_APPROVAL');
  assert.equal(credit.revision, 1);
  assert.equal(credit.obligationId, null, 'A preview never consumes an allocated credit');
  assert.equal(credit.attemptId, null);
  assert.match(credit.merchantAccount, /^…[A-Za-z0-9_-]{1,4}$/);
  assert.match(credit.reference, /^…[A-Za-z0-9]{1,8}$/);
  assert.match(credit.evidence, /^[a-f0-9]{12}$/);
  mkdirSync(output, { recursive: true });
  const mutations = [];
  const observe = (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))
      mutations.push({ method: request.method(), path: new URL(request.url()).pathname });
  };
  page.on('request', observe);
  const modal = page.locator('.modal');
  const files = {
    original: 'statement-credit-candidate.png',
    proposal: 'statement-credit-proposal-candidate.png',
  };
  let preview;
  try {
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(
      path.join(output, files.original),
      await modal.screenshot({ animations: 'disabled', caret: 'hide' }),
    );
    preview = await page.evaluateHandle((fact) => {
      const parent = document.getElementById('modalBody');
      const button = document.getElementById('reconcileSubmit');
      if (!parent || !button) throw new Error('EXISTING_RECONCILIATION_MODAL_REQUIRED');
      const box = document.createElement('section');
      box.dataset.proposal = 'statement-credit';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'قيد كشف الحساب المستقل');
      const label = document.createElement('label');
      label.htmlFor = 'statementCreditProposal';
      label.textContent = 'قيد كشف الحساب المستقل';
      const select = document.createElement('select');
      select.id = label.htmlFor;
      const option = document.createElement('option');
      option.value = fact.creditId;
      const digits = fact.amount.amountMinor.padStart(fact.amount.scale + 1, '0');
      const whole = digits
        .slice(0, digits.length - fact.amount.scale)
        .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const fraction = fact.amount.scale > 0 ? `.${digits.slice(-fact.amount.scale)}` : '';
      option.textContent = `شام كاش · ${fact.reference} · ${whole}${fraction} ${fact.amount.currency}`;
      option.selected = true;
      select.append(option);
      label.append(select);
      const details = document.createElement('dl');
      details.className = 'detail-list';
      for (const [name, value] of [
        ['حساب التاجر', fact.merchantAccount],
        ['مرجع الحركة', fact.reference],
        ['دليل الكشف', fact.evidence],
        ['تاريخ الحركة', fact.occurredAt],
        ['الحالة', 'بانتظار موافقة مراجع آخر'],
      ]) {
        const term = document.createElement('dt');
        term.textContent = name;
        const definition = document.createElement('dd');
        definition.textContent = value;
        details.append(term, definition);
      }
      const note = document.createElement('p');
      note.textContent =
        'سجّل هذا القيد موظف آخر. بعد التحقق، تُعتمد الحركة وتُخصّص لهذه المحاولة في إجراء واحد. لا يثبت اختيار النتيجة وحده وصول المال.';
      box.append(label, details, note);
      parent.insertBefore(box, document.getElementById('reconcileProblem'));
      const original = { text: button.textContent, disabled: button.disabled };
      button.textContent = 'اعتماد القيد وتخصيصه';
      // The preview is review evidence only. A click cannot invoke a command.
      button.disabled = true;
      return { box, button, original };
    }, credit);
    writeFileSync(
      path.join(output, files.proposal),
      await modal.screenshot({ animations: 'disabled', caret: 'hide' }),
    );
    assert.deepEqual(mutations, [], 'A visual proposal cannot issue any state-changing request');
    return {
      status: 'UNAPPROVED_FINANCE_MODAL_PROPOSAL',
      files,
      acceptanceEffect: 'none; the original F1 paid-state and audit assertions remain mandatory',
      commandPerformed: false,
      source: 'real Billing pending statement credit recorded by a different Finance account',
      proposedCommand:
        'POST /api/v1/admin/billing/payment-attempts/:id/statement-credit-allocation',
      bindingFields: ['creditId', 'expectedCreditRevision', 'expectedRevision', 'observedAmount'],
    };
  } finally {
    if (preview) {
      await preview.evaluate(({ box, button, original }) => {
        box.remove();
        button.textContent = original.text;
        button.disabled = original.disabled;
      });
      await preview.dispose();
    }
    page.off('request', observe);
  }
}
