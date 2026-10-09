const DEFAULT_OFFICIAL_LIBRARY_MIRRORS = ['public.ecr.aws/docker/library'];

function truthy(value) {
  if (value === undefined || value === null || value === '') return false;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function configuredMirrors() {
  return (process.env.CW_OFFICIAL_IMAGE_MIRRORS ?? DEFAULT_OFFICIAL_LIBRARY_MIRRORS.join(','))
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function shouldPreferMirror() {
  if (process.env.CW_PREFER_OFFICIAL_IMAGE_MIRROR !== undefined) {
    return truthy(process.env.CW_PREFER_OFFICIAL_IMAGE_MIRROR);
  }
  return truthy(process.env.CI);
}

export function isOfficialLibraryImage(reference) {
  const withoutDigest = reference.split('@')[0];
  if (withoutDigest.includes('/')) return false;
  const name = withoutDigest.replace(/:[^:]+$/, '');
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name);
}

export function officialImagePullCandidates(reference) {
  if (!isOfficialLibraryImage(reference)) return [reference];

  const mirrored = configuredMirrors().map((mirror) => `${mirror}/${reference}`);
  const ordered = shouldPreferMirror() ? [...mirrored, reference] : [reference, ...mirrored];
  return [...new Set(ordered)];
}

function successful(result) {
  return result?.code === 0 && (result.outcome === undefined || result.outcome === 'exited');
}

function summarizeFailure({ image, result }) {
  const status = `code=${result?.code ?? 'unknown'} outcome=${result?.outcome ?? 'exited'}`;
  const detail = String(result?.stderr || result?.stdout || '')
    .trim()
    .slice(-1000);
  return `${image} (${status})${detail ? `: ${detail}` : ''}`;
}

export async function pullImageWithMirrors(reference, docker, options = {}) {
  const failures = [];
  const quiet = options.quiet ?? false;
  const tagCanonical = options.tagCanonical ?? true;
  const candidates = officialImagePullCandidates(reference);

  for (const image of candidates) {
    const result = await docker(['pull', ...(quiet ? ['--quiet'] : []), image], options);
    if (!successful(result)) {
      failures.push({ image, result });
      continue;
    }

    if (image !== reference && tagCanonical && !reference.includes('@')) {
      const tagged = await docker(['tag', image, reference], options);
      if (!successful(tagged)) {
        failures.push({ image: `${image} -> ${reference}`, result: tagged });
        continue;
      }
    }

    return {
      reference,
      pullReference: image,
      mirrored: image !== reference,
      result,
    };
  }

  const result = failures.at(-1)?.result;
  const error = new Error(
    `IMAGE_PULL_FAILED: ${reference}\n${failures.map(summarizeFailure).join('\n')}`,
  );
  error.result = result;
  throw error;
}
