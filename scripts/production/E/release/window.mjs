// Initial operating window evaluation (P08-E2). Pure: policy, observations and
// clock are inputs. The policy is the owner-approved `ext.operating-window-policy`
// receipt details from the release barrier; nothing here has a default.
//
// Decisions:
//   ROLLBACK / STOP / FORWARD_RECOVERY  a threshold with that onBreach was breached
//   STOP                                 observation gap or missing metric (unobservable)
//   OBSERVING                            window still open, nothing breached
//   VERIFIED_IN_OPERATION                full window observed, every sample within bounds,
//                                        no unacknowledged or unresolved incident
// A rollback outranks a stop, which outranks forward recovery.

export const OBSERVATIONS_SCHEMA = 'carwash.operating-window-observations/v1';
const SEVERITY = { rollback: 3, stop: 2, 'forward-recovery': 1 };
const DECISION = { rollback: 'ROLLBACK', stop: 'STOP', 'forward-recovery': 'FORWARD_RECOVERY' };

export class WindowInputError extends Error {}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

function instant(value, label) {
  const ms = typeof value === 'string' && /Z$/.test(value) ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms)) throw new WindowInputError(`${label} must be a UTC instant`);
  return ms;
}

function validatePolicy(policy) {
  if (!policy || !Number.isSafeInteger(policy.durationMinutes) || policy.durationMinutes <= 0)
    throw new WindowInputError('policy.durationMinutes is required');
  if (!Number.isSafeInteger(policy.maxSampleGapMinutes) || policy.maxSampleGapMinutes <= 0)
    throw new WindowInputError('policy.maxSampleGapMinutes is required');
  if (!isObject(policy.thresholds))
    throw new WindowInputError('policy.thresholds must be an object');
  const entries = Object.entries(policy.thresholds ?? {});
  if (entries.length === 0) throw new WindowInputError('policy.thresholds is required');
  for (const [name, rule] of entries)
    if (
      !nonEmpty(name) ||
      !isObject(rule) ||
      !['max', 'min'].includes(rule.bound) ||
      !Number.isFinite(rule?.limit) ||
      typeof rule.onBreach !== 'string' ||
      !Object.hasOwn(SEVERITY, rule.onBreach)
    )
      throw new WindowInputError(`threshold ${name} is malformed`);
  return entries;
}

/**
 * @param {object} input
 * @param {object} input.policy        window-policy details (durationMinutes, maxSampleGapMinutes, thresholds)
 * @param {object} input.observations  carwash.operating-window-observations/v1
 * @param {number} input.now           epoch ms
 */
export function evaluateWindow({ policy, observations, now }) {
  const thresholds = validatePolicy(policy);
  if (observations?.schema !== OBSERVATIONS_SCHEMA)
    throw new WindowInputError(`observations must declare schema ${OBSERVATIONS_SCHEMA}`);
  if (!Number.isFinite(now)) throw new WindowInputError('now must be an injected epoch ms');
  const openedAt = instant(observations.openedAt, 'openedAt');
  const closesAt = openedAt + policy.durationMinutes * 60_000;
  const gapMs = policy.maxSampleGapMinutes * 60_000;
  if (openedAt > now) throw new WindowInputError('openedAt must not be in the future');
  if (!Number.isFinite(new Date(closesAt).getTime()) || !Number.isSafeInteger(gapMs))
    throw new WindowInputError('policy window is outside the supported time range');
  const contacts = observations.contacts ?? {};
  if (
    !nonEmpty(contacts.primary) ||
    !nonEmpty(contacts.backup) ||
    contacts.primary.trim().toLowerCase() === contacts.backup.trim().toLowerCase()
  )
    throw new WindowInputError(
      'observations must name distinct primary and backup incident contacts',
    );
  if (!Array.isArray(observations.samples ?? []))
    throw new WindowInputError('observations.samples must be an array');
  const samples = (observations.samples ?? [])
    .map((s, i) => {
      if (!isObject(s)) throw new WindowInputError(`samples[${i}] must be an object`);
      return { ...s, at: instant(s.at, `samples[${i}].at`) };
    })
    .filter((s) => s.at >= openedAt && s.at <= Math.min(now, closesAt))
    .sort((a, b) => a.at - b.at);

  const breaches = [];
  const unobservable = [];
  for (const sample of samples)
    for (const [name, rule] of thresholds) {
      const value = sample.metrics?.[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        unobservable.push({
          at: new Date(sample.at).toISOString(),
          metric: name,
          reason: 'missing or non-finite',
        });
        continue;
      }
      const breached = rule.bound === 'max' ? value > rule.limit : value < rule.limit;
      if (breached)
        breaches.push({
          at: new Date(sample.at).toISOString(),
          metric: name,
          value,
          limit: rule.limit,
          bound: rule.bound,
          onBreach: rule.onBreach,
        });
    }

  // Coverage: from opening to the evaluated edge, no gap may exceed the policy.
  const edge = Math.min(now, closesAt);
  if (samples.length === 0)
    unobservable.push({
      from: new Date(openedAt).toISOString(),
      to: new Date(edge).toISOString(),
      reason: 'no samples in the evaluated window',
    });
  let cursor = openedAt;
  for (const sample of samples) {
    if (sample.at - cursor > gapMs)
      unobservable.push({
        from: new Date(cursor).toISOString(),
        to: new Date(sample.at).toISOString(),
        reason: 'sample gap',
      });
    cursor = sample.at;
  }
  if (edge - cursor > gapMs)
    unobservable.push({
      from: new Date(cursor).toISOString(),
      to: new Date(edge).toISOString(),
      reason: 'sample gap',
    });

  const incidents = observations.incidents ?? [];
  if (!Array.isArray(incidents))
    throw new WindowInputError('observations.incidents must be an array');
  const incidentIds = new Set();
  for (const [index, incident] of incidents.entries()) {
    if (!isObject(incident) || !nonEmpty(incident.id) || incidentIds.has(incident.id.trim()))
      throw new WindowInputError(`incidents[${index}] must have a distinct nonempty id`);
    incidentIds.add(incident.id.trim());
    if (incident.acknowledgedBy != null && !nonEmpty(incident.acknowledgedBy))
      throw new WindowInputError(`incidents[${index}].acknowledgedBy must name a person`);
    if (incident.resolvedAt != null) {
      const resolvedAt = instant(incident.resolvedAt, `incidents[${index}].resolvedAt`);
      if (resolvedAt > now)
        throw new WindowInputError(`incidents[${index}].resolvedAt must not be in the future`);
    }
  }
  const openIncidents = incidents.filter((i) => !i.resolvedAt);
  const unacknowledged = incidents.filter((i) => !i.acknowledgedBy);

  let decision;
  let reason;
  const worst = breaches.map((b) => b.onBreach).sort((a, b) => SEVERITY[b] - SEVERITY[a])[0];
  if (worst === 'rollback') {
    decision = 'ROLLBACK';
    reason = `${breaches.length} threshold breach(es)`;
  } else if (unobservable.length) {
    decision = 'STOP';
    reason = 'window not fully observable; acceptance cannot be established';
  } else if (worst) {
    decision = DECISION[worst];
    reason = `${breaches.length} threshold breach(es)`;
  } else if (now < closesAt) {
    decision = 'OBSERVING';
    reason = 'window still open';
  } else if (openIncidents.length || unacknowledged.length) {
    decision = 'OBSERVING';
    reason = 'window elapsed but incidents remain unresolved or unacknowledged';
  } else {
    decision = 'VERIFIED_IN_OPERATION';
    reason = 'full window observed within every approved threshold';
  }
  return {
    schema: 'carwash.operating-window-report/v1',
    evaluatedAt: new Date(now).toISOString(),
    openedAt: new Date(openedAt).toISOString(),
    closesAt: new Date(closesAt).toISOString(),
    contacts: { primary: contacts.primary.trim(), backup: contacts.backup.trim() },
    samples: samples.length,
    decision,
    reason,
    breaches,
    unobservable,
    openIncidents: openIncidents.map((i) => i.id ?? null),
    unacknowledgedIncidents: unacknowledged.map((i) => i.id ?? null),
  };
}
