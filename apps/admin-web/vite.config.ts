import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The approved admin reference is the ONLY source of the admin stylesheet.
 *
 * Its `<style>` block is loaded at build time, byte for byte, from the frozen
 * file registered in docs/design/f010-reference-manifest.json. There is no
 * copied or reformatted CSS that could drift: a changed reference fails the
 * build here instead of silently restyling the console.
 */
export const ADMIN_REFERENCE = fileURLToPath(
  new URL('../../design/reference/approved/washgo-admin-prototype.html', import.meta.url),
);
export const ADMIN_REFERENCE_SHA256 =
  'b13353195e914a7572ad033040d2a5112973e3eeabf2a584aa23282cd1ca8273';
/** The relative module index.ts imports; its bytes are replaced by the reference style. */
export const REFERENCE_MODULE = fileURLToPath(new URL('./src/reference.css', import.meta.url));

const normalised = (file: string): string => file.replaceAll('\\', '/').toLowerCase();

export function referenceStyle(html: string): string {
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  if (start < 0 || end < start || html.indexOf('<style>', start + 1) >= 0)
    throw new Error('ADMIN_REFERENCE_STYLE_BLOCK_NOT_UNIQUE');
  return html.slice(start + '<style>'.length, end);
}

function adminReferenceStyle(): Plugin {
  let replaced = false;
  const same = (id: string): boolean =>
    normalised(id.split('?')[0] ?? '') === normalised(REFERENCE_MODULE);
  return {
    name: 'washgo-admin-reference-style',
    enforce: 'pre',
    buildStart() {
      replaced = false;
    },
    buildEnd(error) {
      if (!error && !replaced && this.meta.watchMode === false)
        throw new Error('ADMIN_REFERENCE_STYLE_NOT_APPLIED');
    },
    load(id) {
      if (!same(id)) return undefined;
      replaced = true;
      const bytes = readFileSync(ADMIN_REFERENCE);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== ADMIN_REFERENCE_SHA256)
        throw new Error(`ADMIN_REFERENCE_HASH_MISMATCH ${digest}`);
      this.addWatchFile(ADMIN_REFERENCE);
      return referenceStyle(bytes.toString('utf8'));
    },
  };
}

export default defineConfig({
  plugins: [adminReferenceStyle()],
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
  // CSS is shipped unminified so the delivered stylesheet keeps the reference bytes.
  build: { target: 'es2023', outDir: 'dist', sourcemap: false, cssMinify: false },
});
