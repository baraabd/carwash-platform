// Final release barrier (P08-E1). Pure evaluation: every effect (git, file
// digests, clock) is injected so the same rules run in tests and in the CLI.
//
// Verdict rule: GO only when every family in architecture/release-barrier.json
// has exactly one receipt that is PASSED, schema-valid, bound to the candidate
// sha/tree, references evidence whose sha256 still matches, carries no secret
// material, and agrees with the candidate config digest and the published
// artifact manifest. Anything else is NO-GO with the owning lane and action.

export const RECEIPT_SCHEMA = 'carwash.release-receipt/v1';
export const CANDIDATE_SCHEMA = 'carwash.release-candidate/v1';

const SHA1 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SECRET_REF = /^(vault|aws-sm|gcp-sm|azure-kv|k8s-secret):\/\/\S+$/;
// Keys that would carry secret material instead of a reference.
const SECRET_KEYS =
  /^(value|secret|password|passwd|token|apikey|api_key|privatekey|private_key|clientsecret|client_secret)$/i;
// Receipts must never decide readiness through a stub; the names mirror the
// dependency labels already used in lane evidence ("LOCAL HTTP STUB", ...).
const NOT_REAL = /\b(stub|mock|fake|double|simulat|not used|skipped)/i;

export class BarrierInputError extends Error {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseInstant(value) {
  if (!nonEmptyString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value))
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function validateCandidate(candidate) {
  if (!isObject(candidate) || candidate.schema !== CANDIDATE_SCHEMA)
    throw new BarrierInputError(`candidate must declare schema ${CANDIDATE_SCHEMA}`);
  if (!SHA1.test(candidate.sha ?? ''))
    throw new BarrierInputError('candidate.sha must be a full sha');
  if (!SHA1.test(candidate.tree ?? ''))
    throw new BarrierInputError('candidate.tree must be a full sha');
  if (!DIGEST.test(candidate.configDigest ?? ''))
    throw new BarrierInputError('candidate.configDigest must be sha256:<hex>');
  if (!isObject(candidate.refs) || Object.keys(candidate.refs).length === 0)
    throw new BarrierInputError('candidate.refs must pin at least one ref');
  for (const [ref, sha] of Object.entries(candidate.refs))
    if (!ref.startsWith('refs/') || !SHA1.test(sha))
      throw new BarrierInputError(`candidate.refs.${ref} must map a full ref name to a full sha`);
  return candidate;
}

export function findSecretMaterial(value, path = '$') {
  const hits = [];
  if (Array.isArray(value))
    value.forEach((v, i) => hits.push(...findSecretMaterial(v, `${path}[${i}]`)));
  else if (isObject(value))
    for (const [key, v] of Object.entries(value)) {
      if (SECRET_KEYS.test(key) && typeof v === 'string' && !SECRET_REF.test(v))
        hits.push(`${path}.${key}`);
      hits.push(...findSecretMaterial(v, `${path}.${key}`));
    }
  return hits;
}

// Family-specific checks. Each returns a list of problems (empty = valid).
const KIND_CHECKS = {
  check: () => [],
  acceptance(receipt) {
    const problems = [];
    const deps = receipt.dependencies;
    if (!isObject(deps) || Object.keys(deps).length === 0)
      return ['acceptance must declare its dependencies (name -> REAL ...)'];
    for (const [name, label] of Object.entries(deps))
      if (typeof label !== 'string' || !/^REAL\b/.test(label) || NOT_REAL.test(label))
        problems.push(`dependency ${name} is not real (${String(label)})`);
    return problems;
  },
  artifacts(receipt) {
    const artifacts = receipt.artifacts;
    if (!isObject(artifacts) || Object.keys(artifacts).length === 0)
      return ['artifact manifest must list at least one image digest'];
    return Object.entries(artifacts)
      .filter(([, digest]) => !DIGEST.test(digest))
      .map(([name]) => `artifact ${name} digest must be sha256:<hex>`);
  },
  review(receipt, candidate) {
    const d = receipt.details ?? {};
    const problems = [];
    if (!Number.isInteger(d.pullRequest) || d.pullRequest <= 0)
      problems.push('review needs pullRequest');
    if (!nonEmptyString(d.reviewer) || !nonEmptyString(d.author))
      problems.push('review needs reviewer and author');
    else if (d.reviewer.toLowerCase() === d.author.toLowerCase())
      problems.push('reviewer is the author; approval is not independent');
    if (d.state !== 'APPROVED') problems.push(`review state is ${String(d.state)}, not APPROVED`);
    if (d.commitId !== candidate.sha)
      problems.push('review approved a different commit than the candidate');
    return problems;
  },
  'branch-protection'(receipt) {
    const d = receipt.details ?? {};
    const problems = [];
    if (d.branch !== 'main') problems.push('protection record must be for main');
    if (!Array.isArray(d.requiredChecks) || d.requiredChecks.length === 0)
      problems.push('no required status checks are enforced');
    if (d.enforceAdmins !== true) problems.push('enforce_admins is not enabled');
    if (!Number.isInteger(d.requiredApprovals) || d.requiredApprovals < 1)
      problems.push('at least one required approving review must be enforced');
    return problems;
  },
  authorization(receipt, candidate, ctx) {
    const d = receipt.details ?? {};
    const problems = [];
    if (!nonEmptyString(d.authorizer)) problems.push('authorization must name the authorizer');
    if (d.candidateSha !== candidate.sha)
      problems.push('authorization names a different candidate');
    if (!DIGEST.test(d.artifactManifestDigest ?? ''))
      problems.push('authorization must name the artifact manifest digest');
    else if (ctx.artifactManifestDigest && d.artifactManifestDigest !== ctx.artifactManifestDigest)
      problems.push('authorization names a different artifact manifest than the published one');
    if (!isObject(d.scope) || typeof d.scope.liveMoney !== 'boolean')
      problems.push('authorization scope must state liveMoney explicitly');
    const notBefore = parseInstant(d.notBefore);
    const expiresAt = parseInstant(d.expiresAt);
    if (notBefore === null || expiresAt === null || expiresAt <= notBefore)
      problems.push('authorization needs a valid UTC notBefore < expiresAt window');
    else if (ctx.now < notBefore || ctx.now >= expiresAt)
      problems.push('authorization is not valid now');
    return problems;
  },
  external(receipt) {
    const d = receipt.details;
    return isObject(d) && Object.keys(d).length > 0
      ? []
      : ['external input must carry its reviewed details'];
  },
  'secret-references'(receipt) {
    const refs = receipt.details?.references;
    if (!Array.isArray(refs) || refs.length === 0)
      return ['secret receipt must list store references'];
    return refs.flatMap((ref, i) =>
      isObject(ref) && nonEmptyString(ref.name) && SECRET_REF.test(ref.ref ?? '')
        ? []
        : [`reference ${i} must be {name, ref: <store>://...}`],
    );
  },
  'incident-contacts'(receipt) {
    const d = receipt.details ?? {};
    const problems = [];
    for (const role of ['primary', 'backup']) {
      const c = d[role];
      if (!isObject(c) || !nonEmptyString(c.name) || !nonEmptyString(c.channel))
        problems.push(`${role} incident contact must have name and channel`);
    }
    if (
      isObject(d.primary) &&
      isObject(d.backup) &&
      nonEmptyString(d.primary.name) &&
      d.primary.name.trim().toLowerCase() === String(d.backup.name).trim().toLowerCase()
    )
      problems.push('primary and backup incident contacts must be different people');
    return problems;
  },
  'window-policy'(receipt) {
    const d = receipt.details ?? {};
    const problems = [];
    if (!nonEmptyString(d.approvedBy)) problems.push('window policy must name its approver');
    if (!Number.isInteger(d.durationMinutes) || d.durationMinutes <= 0)
      problems.push('window durationMinutes must be a positive integer');
    if (!Number.isInteger(d.maxSampleGapMinutes) || d.maxSampleGapMinutes <= 0)
      problems.push('window maxSampleGapMinutes must be a positive integer');
    const t = d.thresholds;
    if (!isObject(t) || Object.keys(t).length === 0)
      problems.push('window policy must declare thresholds');
    else
      for (const [name, rule] of Object.entries(t))
        if (
          !isObject(rule) ||
          !['max', 'min'].includes(rule.bound) ||
          typeof rule.limit !== 'number' ||
          !Number.isFinite(rule.limit) ||
          !['rollback', 'forward-recovery', 'stop'].includes(rule.onBreach)
        )
          problems.push(`threshold ${name} must be {bound: max|min, limit: finite, onBreach}`);
    return problems;
  },
};

function validateReceipt(receipt, family, candidate, ctx) {
  const problems = [];
  if (!isObject(receipt) || receipt.schema !== RECEIPT_SCHEMA)
    return [`receipt schema is not ${RECEIPT_SCHEMA}`];
  if (!['PASSED', 'FAILED'].includes(receipt.status))
    problems.push('status must be PASSED or FAILED');
  if (receipt.rc?.sha !== candidate.sha || receipt.rc?.tree !== candidate.tree)
    problems.push(
      `receipt is bound to ${String(receipt.rc?.sha).slice(0, 12)}/${String(receipt.rc?.tree).slice(0, 12)}, not the candidate`,
    );
  if (parseInstant(receipt.producedAt) === null) problems.push('producedAt must be a UTC instant');
  else if (parseInstant(receipt.producedAt) > ctx.now) problems.push('producedAt is in the future');
  if (!nonEmptyString(receipt.producer?.actor)) problems.push('producer.actor is required');
  if (receipt.configDigest !== undefined && receipt.configDigest !== candidate.configDigest)
    problems.push('receipt ran against a different configuration digest');
  if (!Array.isArray(receipt.evidence) || receipt.evidence.length === 0)
    problems.push('receipt must reference at least one evidence file');
  else
    for (const item of receipt.evidence) {
      if (!isObject(item) || !nonEmptyString(item.path) || !DIGEST.test(item.sha256 ?? '')) {
        problems.push('evidence entries must be {path, sha256}');
        continue;
      }
      const actual = ctx.digestEvidence(item.path);
      if (actual === null) problems.push(`evidence ${item.path} is missing`);
      else if (actual !== item.sha256)
        problems.push(`evidence ${item.path} changed after the receipt was issued`);
    }
  if (receipt.artifacts !== undefined && family.kind !== 'artifacts' && ctx.artifacts)
    for (const [name, digest] of Object.entries(receipt.artifacts))
      if (ctx.artifacts[name] !== digest)
        problems.push(`artifact ${name} differs from the published manifest`);
  for (const path of findSecretMaterial(receipt)) problems.push(`secret material at ${path}`);
  const kindCheck = KIND_CHECKS[family.kind];
  if (!kindCheck) problems.push(`policy kind ${family.kind} has no validator`);
  else problems.push(...kindCheck(receipt, candidate, ctx));
  return problems;
}

/** Canonical JSON (sorted keys) so manifest digests do not depend on key order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/**
 * @param {object} input
 * @param {object} input.policy        architecture/release-barrier.json
 * @param {object} input.candidate     carwash.release-candidate/v1
 * @param {Array<{source: string, receipt: unknown}>} input.receipts
 * @param {object} input.io            { resolveTree(sha), resolveRef(ref), digestEvidence(path), sha256(text) }
 * @param {number} input.now           epoch ms (injected clock)
 */
export function evaluateBarrier({ policy, candidate, receipts, io, now }) {
  validateCandidate(candidate);
  if (!Number.isFinite(now)) throw new BarrierInputError('now must be an injected epoch ms');
  const families = policy?.families;
  if (!Array.isArray(families) || families.length === 0)
    throw new BarrierInputError('policy has no families');
  if (policy.receiptSchema !== RECEIPT_SCHEMA)
    throw new BarrierInputError('policy receipt schema mismatch');

  const candidateChecks = [];
  const tree = io.resolveTree(candidate.sha);
  if (tree === null)
    candidateChecks.push({ check: 'candidate-commit', status: 'FAILED', reason: 'sha not found' });
  else if (tree !== candidate.tree)
    candidateChecks.push({ check: 'candidate-tree', status: 'FAILED', reason: `tree is ${tree}` });
  else candidateChecks.push({ check: 'candidate-tree', status: 'PASSED' });
  for (const [ref, expected] of Object.entries(candidate.refs)) {
    const actual = io.resolveRef(ref);
    candidateChecks.push(
      actual === expected
        ? { check: `ref ${ref}`, status: 'PASSED' }
        : { check: `ref ${ref}`, status: 'FAILED', reason: `moved to ${actual ?? 'nothing'}` },
    );
  }

  const byFamily = new Map();
  const unknown = [];
  for (const { source, receipt } of receipts) {
    const id = isObject(receipt) ? receipt.family : undefined;
    if (!families.some((f) => f.id === id)) {
      unknown.push({ source, family: id ?? null });
      continue;
    }
    byFamily.set(id, [...(byFamily.get(id) ?? []), { source, receipt }]);
  }

  // The published manifest anchors every artifact comparison, but only when
  // its own receipt is singular; a conflicting manifest anchors nothing.
  const manifestReceipts = byFamily.get(families.find((f) => f.kind === 'artifacts')?.id) ?? [];
  const manifest =
    manifestReceipts.length === 1 && isObject(manifestReceipts[0].receipt.artifacts)
      ? manifestReceipts[0].receipt.artifacts
      : null;
  const ctx = {
    now,
    artifacts: manifest,
    artifactManifestDigest: manifest ? `sha256:${io.sha256(canonicalJson(manifest))}` : null,
    digestEvidence: io.digestEvidence,
  };

  const results = families.map((family) => {
    const found = byFamily.get(family.id) ?? [];
    const base = { family: family.id, owner: family.owner, action: family.action };
    if (found.length === 0) return { ...base, status: 'MISSING', problems: ['no receipt'] };
    if (found.length > 1)
      return {
        ...base,
        status: 'CONFLICT',
        sources: found.map((f) => f.source),
        problems: ['more than one receipt for this family; keep exactly one'],
      };
    const [{ source, receipt }] = found;
    const problems = validateReceipt(receipt, family, candidate, ctx);
    if (problems.length) return { ...base, status: 'INVALID', source, problems };
    if (receipt.status !== 'PASSED')
      return {
        ...base,
        status: 'FAILED',
        source,
        problems: receipt.problems ?? ['receipt reports FAILED'],
      };
    return { family: family.id, owner: family.owner, status: 'PASSED', source };
  });

  const go =
    candidateChecks.every((c) => c.status === 'PASSED') &&
    unknown.length === 0 &&
    results.every((r) => r.status === 'PASSED');
  return {
    schema: 'carwash.release-barrier-report/v1',
    evaluatedAt: new Date(now).toISOString(),
    candidate: { sha: candidate.sha, tree: candidate.tree, configDigest: candidate.configDigest },
    artifactManifestDigest: ctx.artifactManifestDigest,
    verdict: go ? 'GO' : 'NO_GO',
    deployment: go ? 'AUTHORIZED_PENDING_RUNBOOK' : 'NOT_PERMITTED',
    candidateChecks,
    unknownReceipts: unknown,
    families: results,
    blockers: results
      .filter((r) => r.status !== 'PASSED')
      .map((r) => ({
        family: r.family,
        status: r.status,
        owner: r.owner,
        action: r.action,
        problems: r.problems,
      })),
  };
}
