import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(await readFile(path.join(root,'architecture/service-catalog.json'),'utf8'));
const secret=()=>randomBytes(24).toString('hex');
let text='# LOCAL DISPOSABLE DEVELOPMENT ONLY. Do not commit or deploy.\n';
for(const key of ['POSTGRES_PASSWORD','REDIS_PASSWORD','RABBITMQ_PASSWORD'])text+=`${key}=${secret()}\n`;
for(const svc of catalog.services){
 text+=`${svc.id.toUpperCase()}_DB_PASSWORD=${secret()}\n`;
 text+=`${svc.id.toUpperCase()}_MIGRATION_PASSWORD=${secret()}\n`;
}
await writeFile(path.join(root,'.env.local'),text,{flag:'wx',mode:0o600});
console.log('Created .env.local without printing secrets. Existing files are never overwritten.');
