import {readFile,readdir} from 'node:fs/promises';
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
  if(['node_modules','dist','.git'].includes(e.name))continue;
  const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);
 }return out;
}
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
console.log(`Boundary smoke check passed: ${catalog.services.length} owners, ${checked} source files. This is not a complete AST/dependency/security audit.`);
