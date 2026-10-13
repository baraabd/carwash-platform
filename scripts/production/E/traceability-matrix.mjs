#!/usr/bin/env node
/**
 * Approved-UI traceability matrix checker.
 *
 *   node scripts/production/E/traceability-matrix.mjs [--root <tree>] [--json]
 *
 * Verifies docs/production/E/traceability-matrix.json against the EXACT tree it
 * runs on. The approved inventory is extracted from the three immutable HTML
 * references, never copied into the matrix, so a requirement cannot silently
 * disappear:
 *
 *  1. Reference bytes match the F010 registry pins the matrix names.
 *  2. Every extracted customer/technician/admin item (actions, forms, screens,
 *     steps, payment states, tracking stages, stages, phases, views, sheets,
 *     admin screens/jumps/modals/controls) is covered by at least one row, and
 *     no row covers an item the reference does not contain.
 *  3. Every W07-E full-scope row id is carried forward by at least one row.
 *  4. Every cited source/test/evidence path exists; every ownerRoute is served
 *     by that owner's controllers on this tree.
 *  5. Every unaccepted row names a live (OPEN/UNKNOWN) blocker; every blocker
 *     in the register is classified, owned, stated and sourced to an existing
 *     file; ACCEPTED_HISTORICAL rows cite dated, commit-bound evidence.
 *  6. The required owner decisions are all recorded, and the merge plan is tied
 *     to the matrix base SHA.
 *
 * It proves traceability only. It is not browser, database or release evidence.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCustomerReference } from '../../c001/customer-behavior-manifest.mjs';
import { servedRoutes } from '../B/check-finance-matrix.mjs';

export const MATRIX_PATH = 'docs/production/E/traceability-matrix.json';
const F010_PATH = 'docs/design/f010-reference-manifest.json';
const W07_PATH = 'docs/parallel/E/W07/FULL_SCOPE_MATRIX.md';

export const STATUSES = Object.freeze([
  'ACCEPTED_HISTORICAL',
  'IMPLEMENTED_UNACCEPTED',
  'PARTIAL',
  'FIXTURE_ONLY',
  'UI_NOT_PORTED',
  'BACKEND_ONLY',
  'NOT_STARTED',
  'PROTOTYPE_ONLY_EXCLUDED',
  'DESIGN_PENDING',
  'BLOCKED_DECISION',
]);
export const CLASSIFICATIONS = Object.freeze([
  'CODE_GAP',
  'CONTRACT_GAP',
  'INTEGRATION_GAP',
  'TEST_EVIDENCE_GAP',
  'DESIGN_PENDING',
  'OWNER_DECISION',
  'EXTERNAL_DEPENDENCY',
  'SECURITY_DEFECT',
  'DOC_DRIFT',
]);
export const OWNERS = Object.freeze([
  'Lane A',
  'Lane B',
  'Lane C',
  'Lane D',
  'Lane E',
  'Product owner',
  'Design owner',
  'Finance owner',
  'Operations',
  'Repository administrator',
]);
export const DECISION_TOPICS = Object.freeze([
  'market',
  'operatingModel',
  'currencies',
  'pricing',
  'cancellations',
  'refunds',
  'subscriptions',
  'cashCustody',
  'retention',
  'merchantOnboarding',
  'hosting',
]);
export const BLOCKER_STATES = Object.freeze(['OPEN', 'UNKNOWN', 'RESOLVED', 'SUPERSEDED']);
const LIVE = new Set(['OPEN', 'UNKNOWN']);
/** A single accountable owner, or a joint "Lane E + Lane C" assignment of known owners. */
const isOwner = (value) =>
  typeof value === 'string' && value.split(' + ').every((part) => OWNERS.includes(part));
const REFERENCE_KEYS = { RC: 'customer', RT: 'technician', RA: 'admin' };
const ROW_KEYS = [
  'id',
  'reference',
  'title',
  'kind',
  'role',
  'uiStates',
  'covers',
  'referenceAnchor',
  'existingFunction',
  'api',
  'ownerService',
  'data',
  'events',
  'permission',
  'integrationTest',
  'browserTest',
  'evidence',
  'status',
  'blockers',
  'accountableOwner',
];
// Rows not accepted on any commit, and not deliberately excluded, must name a live blocker.
const NEEDS_BLOCKER = new Set(
  STATUSES.filter((s) => !['ACCEPTED_HISTORICAL', 'PROTOTYPE_ONLY_EXCLUDED'].includes(s)),
);
// The prototype tracking timeline has five labelled stages plus the cancelled (-1) stage.
const TRACKING_IDS = ['received', 'assigned', 'en_route', 'washing', 'completed'];
const TECH_PHASE_IDS = ['task', 'route', 'before', 'wash', 'after', 'handoff'];
const OUT_OF_SCOPE = /paymera|stored[\s-]?value|advertiser/i;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const read = (root, file) => readFileSync(path.join(root, file), 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const literalList = (source) => [...source.matchAll(/'([^']+)'/g)].map((m) => m[1]);

function slice(source, start, end, code) {
  const from = source.indexOf(start);
  const to = from < 0 ? -1 : source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(code);
  return source.slice(from + start.length, to);
}

function technicianInventory(source, anchors) {
  const views = literalList(slice(source, "['home','tasks'", ']', 'RT_VIEWS_NOT_FOUND'));
  views.unshift('home', 'tasks');
  const stages = literalList(
    slice(source, 'STAGES = Object.freeze([', '])', 'RT_STAGES_NOT_FOUND'),
  );
  const phases = literalList(slice(source, 'PHASES = [', ']', 'RT_PHASES_NOT_FOUND'));
  if (phases.length !== TECH_PHASE_IDS.length) throw new Error('RT_PHASE_COUNT');
  // Click actions are data-action attributes plus generated `case` values; stage cases are not actions.
  const actions = new Set();
  for (const m of source.matchAll(/data-action=["']([A-Za-z0-9_-]+)["']/g)) actions.add(m[1]);
  for (const m of source.matchAll(/case\s*'([a-z-]+)'/g)) actions.add(m[1]);
  for (const stage of stages) actions.delete(stage);
  // Sheets: every titled showSheet call site is anchored by its exact title; showIssue modes share one helper.
  const sites = [...source.matchAll(/showSheet\((['`])/g)].length;
  const sheets = [];
  const problems = [];
  let anchored = 0;
  for (const [id, anchor] of Object.entries(anchors ?? {})) {
    if (!source.includes(anchor)) problems.push(`RT sheet ${id}: anchor not found: ${anchor}`);
    if (anchor.startsWith('showSheet(')) anchored += 1;
    sheets.push(id);
  }
  if (anchored !== sites)
    problems.push(`RT sheets: ${sites} titled showSheet call sites, ${anchored} anchored`);
  return {
    inventory: {
      actions: [...actions].sort(),
      stages,
      views: [...new Set(views)],
      phases: TECH_PHASE_IDS,
      sheets: sheets.sort(),
    },
    problems,
  };
}

function adminInventory(source, controls) {
  const screens = [...new Set([...source.matchAll(/data-screen="([a-z]+)"/g)].map((m) => m[1]))];
  const jumps = [...new Set([...source.matchAll(/data-jump="([a-z]+)"/g)].map((m) => m[1]))];
  const forms = slice(source, 'forms={', '};', 'RA_FORMS_NOT_FOUND');
  const modals = [...forms.matchAll(/(?:^|[{,])([a-z]+):\[/g)].map((m) => m[1]);
  const problems = [];
  for (const [id, anchor] of Object.entries(controls ?? {}))
    if (!source.includes(anchor)) problems.push(`RA control ${id}: anchor not found: ${anchor}`);
  return {
    inventory: {
      screens,
      jumps: jumps.map((j) => `jump:${j}`),
      modals: modals.map((m) => `modal:${m}`),
      controls: Object.keys(controls ?? {}).sort(),
    },
    problems,
  };
}

function customerInventory(root) {
  const observed = inspectCustomerReference(root);
  const manifest = JSON.parse(read(root, 'docs/customer/customer-parity-manifest.json'));
  const states = slice(observed.source, 'PAYMENT_STATES=Object.freeze({', '});', 'RC_STATES');
  const paymentStates = [...states.matchAll(/(?:^|[\n{,])\s*([a-z_]+):\{/g)].map((m) => m[1]);
  const status = slice(observed.source, 'STATUS=[', '];', 'RC_STATUS');
  const labels = [...status.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  const problems = [];
  if (JSON.stringify(labels) !== JSON.stringify(manifest.orderTracking.stages.map((s) => s.label)))
    problems.push('RC tracking labels differ from the C001 manifest');
  if (labels.length !== TRACKING_IDS.length) problems.push('RC tracking stage count changed');
  return {
    inventory: {
      actions: observed.actions,
      forms: observed.forms,
      screens: manifest.primaryScreens.map((s) => s.id),
      steps: manifest.bookingFlow.map((s) => s.id),
      paymentStates,
      trackingStages: [...TRACKING_IDS, 'cancelled'],
    },
    problems,
  };
}

/** The approved inventory, extracted from the immutable references on this tree. */
export function extractInventory(root, matrix) {
  const rt = technicianInventory(read(root, matrix.references.RT.path), matrix.anchors?.RT?.sheets);
  const ra = adminInventory(read(root, matrix.references.RA.path), matrix.anchors?.RA?.controls);
  const rc = customerInventory(root);
  return {
    inventory: { RC: rc.inventory, RT: rt.inventory, RA: ra.inventory },
    problems: [...rc.problems, ...rt.problems, ...ra.problems],
  };
}

export function w07RowIds(root) {
  const ids = new Set();
  for (const m of read(root, W07_PATH).matchAll(/^\|\s*([A-Z]{1,2}\d{2})\b/gm)) ids.add(m[1]);
  return [...ids].sort();
}

/** First whitespace/paren/colon-delimited token if it looks like a repository path. */
export function citedPath(entry) {
  const token = String(entry)
    .trim()
    .split(/[\s(]/)[0]
    .replace(/:[^/]*$/, '');
  if (!token.includes('/') || /^(https?:|PR|[A-Z]+ \/)/.test(token)) return null;
  if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(token)) return null;
  return token.replace(/\/$/, '');
}

export function checkTraceabilityMatrix(root, matrix) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!/^[a-f0-9]{40}$/.test(matrix.base?.sha ?? '')) fail('base.sha must be a full commit SHA');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matrix.base?.date ?? '')) fail('base.date must be YYYY-MM-DD');
  if (matrix.base?.currentCandidateAcceptance !== 'NONE')
    fail('base.currentCandidateAcceptance must stay NONE: this matrix is not acceptance');

  const f010 = JSON.parse(read(root, F010_PATH));
  for (const [key, name] of Object.entries(REFERENCE_KEYS)) {
    const ref = matrix.references?.[key];
    const pin = f010.references[name];
    if (!ref || ref.path !== pin.canonicalHtml || ref.sha256 !== pin.sha256) {
      fail(`reference ${key}: must name the F010 ${name} path and sha256`);
      continue;
    }
    if (sha256(read(root, ref.path)) !== ref.sha256) fail(`reference ${key}: bytes changed`);
  }
  if (problems.length > 0) return problems;

  const { inventory, problems: extraction } = extractInventory(root, matrix);
  problems.push(...extraction);

  const blockers = new Map();
  for (const b of matrix.blockers ?? []) {
    const where = `blocker ${b.id}`;
    if (blockers.has(b.id)) fail(`${where}: duplicate id`);
    blockers.set(b.id, b);
    if (!CLASSIFICATIONS.includes(b.classification)) fail(`${where}: classification`);
    if (!isOwner(b.owner)) fail(`${where}: owner ${b.owner}`);
    if (!BLOCKER_STATES.includes(b.state)) fail(`${where}: state ${b.state}`);
    if (typeof b.summary !== 'string' || b.summary.length < 20) fail(`${where}: summary too short`);
    if (/\b(TODO|FIXME|TBD)\b/.test(b.summary ?? '')) fail(`${where}: generic TODO wording`);
    const source = citedPath(b.source ?? '');
    if (!source || !existsSync(path.join(root, source))) fail(`${where}: source ${b.source}`);
  }

  const covered = {};
  const carriedW07 = new Set();
  const ids = new Set();
  const served = new Map();
  const routesOf = (service) => {
    if (!served.has(service)) {
      try {
        served.set(service, new Set(servedRoutes(root, service).map((r) => r.key)));
      } catch (error) {
        fail(`ownerRoutes: cannot read ${service} controllers: ${error.message}`);
        served.set(service, new Set());
      }
    }
    return served.get(service);
  };

  for (const row of matrix.requirements ?? []) {
    const where = `row ${row.id}`;
    if (ids.has(row.id)) fail(`${where}: duplicate id`);
    ids.add(row.id);
    for (const key of ROW_KEYS) if (!(key in row)) fail(`${where}: missing ${key}`);
    if (!STATUSES.includes(row.status)) fail(`${where}: status ${row.status}`);
    if (!isOwner(row.accountableOwner)) fail(`${where}: owner ${row.accountableOwner}`);
    if (OUT_OF_SCOPE.test(`${row.title} ${row.role}`))
      fail(`${where}: names unapproved scope (Paymera/stored value/Advertiser)`);
    for (const id of row.blockers ?? [])
      if (!blockers.has(id)) fail(`${where}: unknown blocker ${id}`);
    if (
      NEEDS_BLOCKER.has(row.status) &&
      !(row.blockers ?? []).some((id) => LIVE.has(blockers.get(id)?.state))
    )
      fail(`${where}: ${row.status} without a blocker`);
    if (row.status === 'ACCEPTED_HISTORICAL') {
      const dated = (row.evidence ?? []).filter((e) =>
        /\d{4}-\d{2}-\d{2}.*\b[a-f0-9]{7,40}\b/.test(e),
      );
      if (dated.length === 0) fail(`${where}: historical acceptance needs dated commit evidence`);
    }
    for (const field of ['existingFunction', 'integrationTest', 'browserTest', 'evidence'])
      for (const entry of row[field] ?? []) {
        const file = citedPath(entry);
        if (file && !existsSync(path.join(root, file))) fail(`${where}: ${field} ${file} missing`);
      }
    for (const route of row.ownerRoutes ?? []) {
      const [service, method, ...rest] = route.split(' ');
      const key = `${method} /${rest
        .join(' ')
        .split('/')
        .filter(Boolean)
        .map((s) => (s.startsWith(':') ? ':p' : s))
        .join('/')}`;
      if (!routesOf(service).has(key)) fail(`${where}: ownerRoute ${route} is not served`);
    }
    for (const id of row.w07 ?? []) carriedW07.add(id);
    const ref = row.reference;
    if (ref === 'X') continue;
    if (!inventory[ref]) {
      fail(`${where}: reference ${ref}`);
      continue;
    }
    for (const [kind, items] of Object.entries(row.covers ?? {})) {
      const known = inventory[ref][kind];
      if (!known) {
        if (items.length > 0) fail(`${where}: ${ref} has no inventory class ${kind}`);
        continue;
      }
      for (const item of items) {
        if (!known.includes(item)) fail(`${where}: ${ref}.${kind} ${item} is not in the reference`);
        (covered[`${ref}.${kind}`] ??= new Set()).add(item);
      }
    }
  }

  for (const [ref, classes] of Object.entries(inventory))
    for (const [kind, items] of Object.entries(classes))
      for (const item of items)
        if (!covered[`${ref}.${kind}`]?.has(item)) fail(`uncovered ${ref}.${kind} ${item}`);
  for (const id of w07RowIds(root))
    if (!carriedW07.has(id)) fail(`W07 row ${id} is not carried forward`);

  const topics = new Set((matrix.decisions ?? []).map((d) => d.topic));
  for (const topic of DECISION_TOPICS) if (!topics.has(topic)) fail(`decision ${topic} missing`);
  for (const d of matrix.decisions ?? []) {
    if (!['DECIDED', 'PARTIAL', 'OPEN'].includes(d.status)) fail(`decision ${d.topic}: status`);
    if (!isOwner(d.owner)) fail(`decision ${d.topic}: owner ${d.owner}`);
    for (const id of d.blockers ?? []) if (!blockers.has(id)) fail(`decision ${d.topic}: ${id}`);
  }

  if (matrix.mergePlan?.base !== matrix.base?.sha) fail('mergePlan.base must equal base.sha');
  const steps = matrix.mergePlan?.steps ?? [];
  if (steps.length === 0) fail('mergePlan has no steps');
  const order = new Set();
  for (const step of steps) {
    for (const dep of step.dependsOn ?? [])
      if (!order.has(dep)) fail(`mergePlan ${step.id}: depends on later/unknown step ${dep}`);
    order.add(step.id);
    for (const id of step.blockers ?? [])
      if (!blockers.has(id)) fail(`mergePlan ${step.id}: ${id}`);
  }
  for (const e of matrix.historicalEvidence ?? [])
    if (e.appliesToBase !== false) fail(`historical evidence ${e.path}: must not apply to base`);
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const root = path.resolve(arg('root') ?? here);
  const matrix = JSON.parse(read(root, MATRIX_PATH));
  const problems = checkTraceabilityMatrix(root, matrix);
  const counts = {};
  for (const row of matrix.requirements) counts[row.status] = (counts[row.status] ?? 0) + 1;
  if (process.argv.includes('--json'))
    console.log(
      JSON.stringify({ root, rows: matrix.requirements.length, counts, problems }, null, 2),
    );
  else {
    console.log(
      `traceability matrix: ${matrix.requirements.length} rows ${JSON.stringify(counts)}`,
    );
    for (const p of problems) console.log(`  PROBLEM ${p}`);
    console.log(problems.length === 0 ? 'PASSED' : `FAILED (${problems.length})`);
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
