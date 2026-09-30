/** Shell-free probes: output alone can never turn a failed Docker exec green. */
export const BAKED_SECRET_PROBE =
  "const fs=require('node:fs');const names=fs.readdirSync('/app');" +
  "const found=names.filter(n=>n.startsWith('.env')||n==='.acceptance'||n==='.git');" +
  'process.stdout.write(JSON.stringify(found));if(found.length)process.exitCode=1;';
export function verifiedNonRoot(result) {
  const uid = result.stdout?.trim();
  return result.code === 0 && /^[1-9][0-9]*$/.test(uid ?? '') && Number.isSafeInteger(Number(uid));
}
export function verifiedNoBakedSecrets(result) {
  return result.code === 0 && result.stdout?.trim() === '[]';
}
