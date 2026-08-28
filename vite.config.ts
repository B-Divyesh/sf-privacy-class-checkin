import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

function releaseId(): string {
  const value = process.env.BUILD_SHA?.trim();
  return value && /^[a-zA-Z0-9._-]+$/.test(value) ? value : 'local-development';
}

function versionedServiceWorker(): Plugin {
  return {
    name: 'versioned-service-worker',
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle)
        .filter((file) => file.fileName.startsWith('assets/') && !file.fileName.endsWith('.map'))
        .map((file) => `/${file.fileName}`);
      const cache = `pcc-shell-${releaseId()}`;
      const source = `const CACHE=${JSON.stringify(cache)};
const CORE=${JSON.stringify(['/', '/privacy', '/terms', '/open-export', '/botanical-checkin-hero.webp', ...assets])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('pcc-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')||url.pathname==='/health')return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response}).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('/'))));});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}
export default defineConfig({
  root: 'frontend',
  plugins: [versionedServiceWorker()],
  build: { outDir: resolve(import.meta.dirname,'dist'), emptyOutDir: true, target: 'es2022', sourcemap: true },
  server: { proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' } }
});
