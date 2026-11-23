import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
  // The reference CSS is shipped as written: no minifier rewrites selectors or colours.
  build: { target: 'es2023', outDir: 'dist', sourcemap: false, cssMinify: false },
});
