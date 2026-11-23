// Source provenance shared by release gates, image builds and recovery drills.
// A successful command is evidence for a commit only while that exact source
// remains clean. Generated reports may be untracked; executable source may not.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export class SourceProvenanceError extends Error {}

function git(root, ...args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new SourceProvenanceError('source must be an accessible git checkout');
  }
}

// The release CLI deliberately writes these reports beside a clean checkout.
// Keep the exception narrow: an untracked script, Dockerfile or package under
// either directory is still source drift. Normal ignored build outputs are
// already excluded by git (dist, node_modules, generated Prisma, .acceptance).
function generatedReport(file) {
  return /^(?:evidence|release|\.acceptance)\/(?:[^/]+\/)*[^/]+\.(?:json|log|md|txt)$/i.test(file);
}

function regularGeneratedReport(root, file) {
  if (!generatedReport(file)) return false;
  try {
    // A symlink named *.json can route later output into source. Never exempt
    // symlinks, directories, pipes or other special files as generated reports.
    return lstatSync(path.join(root, file)).isFile();
  } catch {
    return false;
  }
}

/** Receipt outputs must not overwrite or introduce source after it was checked. */
export function assertReportDestination(root, file) {
  const base = realpathSync(root);
  const absolute = path.resolve(base, file);
  const relative = path.relative(base, absolute).split(path.sep).join('/');
  if (!generatedReport(relative))
    throw new SourceProvenanceError(
      'report output must be inside release/, evidence/ or .acceptance/',
    );
  // Resolve the nearest existing ancestor too: a report directory may be a
  // symlink to a source directory or outside the checkout.
  let ancestor = absolute;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const canonical = path.resolve(realpathSync(ancestor), path.relative(ancestor, absolute));
  const canonicalRelative = path.relative(base, canonical).split(path.sep).join('/');
  if (!generatedReport(canonicalRelative))
    throw new SourceProvenanceError(
      'report output resolves outside the generated report directories',
    );
  if (
    git(base, 'ls-files', '--', relative).trim() ||
    git(base, 'ls-files', '--', canonicalRelative).trim()
  )
    throw new SourceProvenanceError('report output must not overwrite tracked source');
  return absolute;
}

/** Capture a clean committed checkout, including every tracked build input. */
export function assertExactSource(root) {
  const sha = git(root, 'rev-parse', '--verify', 'HEAD').trim();
  const tree = git(root, 'rev-parse', '--verify', `${sha}^{tree}`).trim();
  const dirty = git(root, 'status', '--porcelain', '--untracked-files=no');
  if (dirty)
    throw new SourceProvenanceError(
      'tracked files are modified; evidence requires an exact committed tree',
    );
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter((file) => file && !regularGeneratedReport(root, file));
  if (untracked.length)
    throw new SourceProvenanceError(`untracked source files are present: ${untracked.join(', ')}`);
  if (git(root, 'rev-parse', '--verify', 'HEAD').trim() !== sha)
    throw new SourceProvenanceError('source changed while its provenance was being captured');
  return { sha, tree };
}

/** Refuse a passing result if the source was edited, added to, or moved. */
export function assertSameSource(root, expected) {
  const current = assertExactSource(root);
  if (current.sha !== expected.sha || current.tree !== expected.tree)
    throw new SourceProvenanceError('source commit or tree changed during execution');
  return current;
}
