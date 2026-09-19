import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function runFixture(source,duplicateDatabase=false){
 const dir=await mkdtemp(path.join(tmpdir(),'cw-boundary-'));
 try{
  for(const sub of ['architecture','scripts','services/one/src','services/two/src'])await mkdir(path.join(dir,sub),{recursive:true});
  await writeFile(path.join(dir,'scripts/check-boundaries.mjs'),await readFile(path.join(root,'scripts/check-boundaries.mjs')));
  await writeFile(path.join(dir,'architecture/service-catalog.json'),JSON.stringify({services:[{id:'one',database:'one',runtimeRole:'one_app',migrationRole:'one_migrate'},{id:'two',database:duplicateDatabase?'one':'two',runtimeRole:'two_app',migrationRole:'two_migrate'}]}));
  for(const name of ['one','two'])await writeFile(path.join(dir,`services/${name}/package.json`),JSON.stringify({name:`@carwash/${name}`,private:true}));
  await writeFile(path.join(dir,'services/one/src/example.ts'),source);
  return spawnSync(process.execPath,[path.join(dir,'scripts/check-boundaries.mjs')],{encoding:'utf8'});
 }finally{await rm(dir,{recursive:true,force:true})}
}
test('boundary guard: local/contract imports allowed',async()=>assert.equal((await runFixture("import type { X } from '@carwash/event-contracts';")).status,0));
test('boundary guard: cross-service alias blocked',async()=>assert.notEqual((await runFixture("import { X } from '@carwash/two/private';")).status,0));
test('boundary guard: cross-service relative path blocked',async()=>assert.notEqual((await runFixture("import { X } from '../../two/src/private';")).status,0));
test('boundary guard: shared business database rejected',async()=>assert.notEqual((await runFixture('',true)).status,0));
