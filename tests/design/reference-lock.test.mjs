import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import { tmpdir } from 'node:os';
import {join} from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyReference, MANIFEST } from '../../scripts/check-design-reference.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'washgo-reference-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/design'), {recursive:true});
  mkdirSync(join(root, 'design'), {recursive:true});
  const text = '<html lang="ar" dir="rtl">WashGo</html>';
  writeFileSync(join(root, 'design/approved.html'), text);
  const m = {schemaVersion:1, artifacts:[{path:'design/approved.html',sha256:hash(text),bytes:Buffer.byteLength(text)}],frozenPolicyPaths:[]};
  const save = () => writeFileSync(join(root, MANIFEST), JSON.stringify(m)); save();
  return {root, m, save};
}
test('unaltered reference passes', t => { const f=fixture(t);assert.equal(verifyReference(f.root).ok,true); });
test('changed byte fails', t => { const f=fixture(t);writeFileSync(join(f.root,'design/approved.html'),'changed');assert.equal(verifyReference(f.root).ok,false); });
test('deleted reference fails', t => { const f=fixture(t);rmSync(join(f.root,'design/approved.html'));assert.equal(verifyReference(f.root).ok,false); });
test('truncated/invalid manifest fails', t => { const f=fixture(t);writeFileSync(join(f.root,MANIFEST),'{');assert.equal(verifyReference(f.root).ok,false); });
test('empty manifest fails closed', t => { const f=fixture(t);f.m.artifacts=[];f.save();assert.equal(verifyReference(f.root).ok,false); });
test('bad hash syntax fails', t => { const f=fixture(t);f.m.artifacts[0].sha256='wrong';f.save();assert.equal(verifyReference(f.root).ok,false); });
test('duplicate reference fails', t => { const f=fixture(t);f.m.artifacts.push({...f.m.artifacts[0]});f.save();assert.equal(verifyReference(f.root).ok,false); });
test('path traversal rejected', t => { const f=fixture(t);f.m.artifacts[0].path='../outside';f.save();assert.equal(verifyReference(f.root).ok,false); });
test('symlink rejected', t => { const f=fixture(t);const p=join(f.root,'design/approved.html');rmSync(p);symlinkSync(join(f.root,MANIFEST),p);assert.equal(verifyReference(f.root).ok,false); });
test('base-ref option is validated', t => { const f=fixture(t);assert.equal(verifyReference(f.root,'main; echo nope').ok,false); });
test('trusted base rejects changing both reference and its manifest', t => {
  const f=fixture(t);
  const git=(...args)=>execFileSync('git',['-C',f.root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('add','.');git('-c','user.name=Test Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');
  const base=git('rev-parse','HEAD');assert.equal(verifyReference(f.root,base).ok,true);
  const changed='Changed appearance';writeFileSync(join(f.root,'design/approved.html'),changed);
  f.m.artifacts[0].sha256=hash(changed);f.m.artifacts[0].bytes=Buffer.byteLength(changed);f.save();
  assert.equal(verifyReference(f.root).ok,true); // demonstrates why standalone mutable checksums are insufficient
  assert.equal(verifyReference(f.root,base).ok,false);
});
test('trusted base rejects policy tampering', t => {
  const f=fixture(t);writeFileSync(join(f.root,'AGENTS.md'),'Do not redesign');f.m.frozenPolicyPaths=['AGENTS.md'];f.save();
  const git=(...args)=>execFileSync('git',['-C',f.root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('add','.');git('-c','user.name=Test Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');
  const base=git('rev-parse','HEAD');writeFileSync(join(f.root,'AGENTS.md'),'Redesign freely');
  assert.equal(verifyReference(f.root,base).ok,false);
});
