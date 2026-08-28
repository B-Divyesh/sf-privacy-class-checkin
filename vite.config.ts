import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'frontend',
  build: { outDir: resolve(import.meta.dirname,'dist'), emptyOutDir: true, target: 'es2022', sourcemap: true },
  server: { proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' } }
});
