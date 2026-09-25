import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(await readFile(path.join(root,'architecture/service-catalog.json'),'utf8'));
for(const field of ['id','database','runtimeRole','migrationRole']) {
 const values=catalog.services.map(s=>s[field]);
 if(new Set(values).size!==values.length) throw new Error(`Duplicated ${field}`);
}
async function walk(dir){
 const out=[];for(const e of await readdir(dir,{withFileTypes:true})) {
  if(['node_modules','dist','dist-tests','.git','generated'].includes(e.name))continue;
  const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);
 }return out;
}
async function exists(target){try{await stat(target);return true}catch{return false}}
let checked=0;
for(const svc of catalog.services){
 const dir=path.join(root,'services',svc.id);
 const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
 for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})) {
  if(catalog.services.some(s=>s.id!==svc.id&&name===`@carwash/${s.id}`))throw new Error('Service package dependency forbidden');
 }
 for(const file of await walk(dir)){
  if(!/\.(ts|js|mts|mjs)$/.test(file))continue;
  checked++;
  const text=await readFile(file,'utf8');
  const imports=[...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)['"]([^'"]+)['"]/g)];
  for(const [,specifier] of imports){
   if(catalog.services.some(s=>s.id!==svc.id&&(specifier===`@carwash/${s.id}`||specifier.startsWith(`@carwash/${s.id}/`))))throw new Error(`Cross-service import: ${file}`);
   if(specifier.startsWith('.')){
    const dest=path.resolve(path.dirname(file),specifier);
    if(dest.startsWith(path.join(root,'services')+path.sep)&&!dest.startsWith(dir+path.sep))throw new Error(`Cross-service relative import: ${file}`);
   }
  }
 }
}

/*
 * Sprint 0.2 architectural rules.
 *
 * Each check below exists because breaking it is easy, looks harmless in review
 * and is expensive to undo later. They are skipped when the corresponding path
 * is absent so that the checker still works on a minimal fixture.
 */
const architectural=[];

// 1. No shared business database layer. A shared Prisma client or schema is how
//    two services quietly end up reading each other's tables.
const packagesDir=path.join(root,'packages');
if(await exists(packagesDir)){
 for(const entry of await readdir(packagesDir,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const manifest=path.join(packagesDir,entry.name,'package.json');
  if(!await exists(manifest))continue;
  const pkg=JSON.parse(await readFile(manifest,'utf8'));
  const deps={...pkg.dependencies,...pkg.devDependencies};
  for(const forbidden of ['@prisma/client','prisma','@prisma/adapter-pg','pg']){
   if(deps[forbidden])throw new Error(`Shared package ${pkg.name} must not depend on ${forbidden}: database access is service-local`);
  }
  if(await exists(path.join(packagesDir,entry.name,'prisma')))throw new Error(`Shared package ${pkg.name} must not own a Prisma schema`);
  architectural.push(`shared package ${pkg.name} owns no database access`);
 }
}

// 2. Gateway and admin apps are not business-data owners.
const appsDir=path.join(root,'apps');
if(await exists(appsDir)){
 for(const entry of await readdir(appsDir,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const manifest=path.join(appsDir,entry.name,'package.json');
  if(!await exists(manifest))continue;
  const pkg=JSON.parse(await readFile(manifest,'utf8'));
  const deps={...pkg.dependencies,...pkg.devDependencies};
  for(const forbidden of ['@prisma/client','prisma']){
   if(deps[forbidden])throw new Error(`App ${pkg.name} must not depend on ${forbidden}: gateway and admin own no business data`);
  }
  architectural.push(`app ${pkg.name} owns no business database`);
 }
}

// 3. Event contracts are transport contracts, never database models.
const contractsManifest=path.join(packagesDir,'event-contracts','package.json');
if(await exists(contractsManifest)){
 const pkg=JSON.parse(await readFile(contractsManifest,'utf8'));
 const deps={...pkg.dependencies,...pkg.devDependencies};
 for(const forbidden of ['@prisma/client','prisma','@nestjs/common','amqplib']){
  if(deps[forbidden])throw new Error(`event-contracts must not depend on ${forbidden}`);
 }
 architectural.push('event contracts depend on no database or transport library');
}

// 4. Application startup must not run migrations. Replicas that migrate race
//    each other and make rollbacks unpredictable; migrations are a separate job.
// `$executeRaw` follows a `.`, so a leading \b could never match before it.
const MIGRATION_AT_STARTUP=/(\bmigrate\s+deploy\b|\bmigrateDeploy\b|\bprisma\s+migrate\b|\$(?:execute|query)Raw\w*[^\n]*\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|SCHEMA|INDEX)\b)/i;
for(const svc of catalog.services){
 const srcDir=path.join(root,'services',svc.id,'src');
 if(!await exists(srcDir))continue;
 for(const file of await walk(srcDir)){
  if(!/\.(ts|mts)$/.test(file))continue;
  const text=await readFile(file,'utf8');
  if(MIGRATION_AT_STARTUP.test(text))throw new Error(`Service runtime code must not run migrations: ${path.relative(root,file)}`);
 }
 architectural.push(`${svc.id} runtime code runs no migrations`);
}

// 5. Foundation shells must not advertise business readiness.
for(const svc of catalog.services){
 const moduleFile=path.join(root,'services',svc.id,'src','app.module.ts');
 if(!await exists(moduleFile))continue;
 const text=await readFile(moduleFile,'utf8');
 if(!/export const BUSINESS_READY = false;/.test(text))
  throw new Error(`${svc.id} must declare BUSINESS_READY = false while its business API is unimplemented`);
 architectural.push(`${svc.id} declares businessReady=false`);
}

// 6. Each service owns exactly one Prisma schema, and it names no other service.
for(const svc of catalog.services){
 const schemaFile=path.join(root,'services',svc.id,'prisma','schema.prisma');
 if(!await exists(schemaFile))continue;
 const text=await readFile(schemaFile,'utf8');
 for(const other of catalog.services){
  if(other.id===svc.id)continue;
  if(new RegExp(`\\b${other.database}\\b`).test(text))
   throw new Error(`${svc.id} schema references another service database: ${other.database}`);
 }
 if(/url\s*=/.test(text))throw new Error(`${svc.id} schema must not embed a connection URL`);
 architectural.push(`${svc.id} owns a single service-local schema`);
}

console.log(`Boundary smoke check passed: ${catalog.services.length} owners, ${checked} source files. This is not a complete AST/dependency/security audit.`);
if(architectural.length>0)console.log(`Architectural rules verified: ${architectural.length} (shared-package isolation, gateway/admin data ownership, contract purity, no migration on startup, foundation readiness, schema locality).`);
