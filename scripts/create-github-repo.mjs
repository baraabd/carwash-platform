/** Optional USER-SIDE bootstrap. Default is a no-write dry run. Never handles raw tokens. */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyReference } from './check-design-reference.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'baraabd/carwash-platform';
function run(command, args, allowFailure = false) {
  const r = spawnSync(command, args, {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],shell:false});
  if (r.error) throw new Error(`${command} unavailable: ${r.error.message}`);
  if (r.status !== 0 && !allowFailure) throw new Error(`${command} failed (${r.status}): ${r.stderr.trim()}`);
  return r;
}
try {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--create') || args.length > 1) throw new Error('Usage: node scripts/create-github-repo.mjs [--create]');
  const verified = verifyReference(root);
  if (!verified.ok) throw new Error(`Reference verification failed: ${verified.errors.join('; ')}`);
  console.log(`Target: ${repo}\nVisibility: PRIVATE\nLocal source: ${root}`);
  if (!args.includes('--create')) {
    console.log('DRY RUN ONLY. No git init, network request, repository creation or push occurred.');
    console.log('To execute from your authenticated computer: node scripts/create-github-repo.mjs --create');
    process.exit(0);
  }
  run('git',['--version']);run('gh',['--version']);
  const login=run('gh',['api','user','--jq','.login']).stdout.trim();
  if (login!=='baraabd') throw new Error(`Authenticated as ${login}; expected baraabd. Stop without creating a repository.`);
  if (existsSync(resolve(root,'.git'))) throw new Error('A local .git already exists. Do not rerun blindly; inspect existing state and use documented recovery.');
  const parent=run('git',['rev-parse','--show-toplevel'],true);
  if (parent.status===0) throw new Error('This folder is inside an existing Git repository. Extract outside it; never nest inside homeservicemarketplace.');
  for(const key of ['user.name','user.email']) if(!run('git',['config','--get',key],true).stdout.trim())
    throw new Error(`Set your Git ${key} locally on your computer before continuing. No author identity is fabricated.`);
  run('git',['init','--initial-branch=main']);run('git',['add','.']);
  run('git',['commit','-m','chore: bootstrap carwash microservices with frozen WashGo design']);
  // GitHub itself rejects an already existing name. Do not treat arbitrary network failures as nonexistence.
  const created=run('gh',['repo','create',repo,'--private','--source',root,'--remote','origin','--push','--description','WashGo mobile car wash — microservices foundation and approved design reference']);
  if(created.stdout.trim()) console.log(created.stdout.trim());
  const remote=JSON.parse(run('gh',['repo','view',repo,'--json','nameWithOwner,isPrivate,url,defaultBranchRef']).stdout);
  if(remote.nameWithOwner!==repo || remote.isPrivate!==true) throw new Error('Remote verification differs from intended private repository. Inspect before continuing.');
  const localSha=run('git',['rev-parse','HEAD']).stdout.trim();
  const refs=run('git',['ls-remote','origin','refs/heads/main']).stdout.trim();
  if(refs.split(/\s+/)[0]!==localSha) throw new Error('Remote main does not match local commit. Push not verified.');
  console.log(`VERIFIED remote: ${remote.url}\nmain commit: ${localSha}\nPrivate: true`);
  console.log('Branch protection, release CI and deployment were NOT configured by this script.');
} catch(e) {
  console.error(`STOP: ${e.message}`);
  console.error('Some earlier local/remote steps may have completed. No rollback, deletion, force-push or overwrite was attempted.');
  process.exitCode=1;
}
