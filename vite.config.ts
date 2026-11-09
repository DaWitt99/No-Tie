import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function offlineAssets(): Plugin {
  let outputDirectory = ''
  let publicDirectory = ''
  let cacheVersion = ''

  return {
    name: 'no-tie-offline-assets',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
      publicDirectory = resolve(config.root, config.publicDir)
      cacheVersion = Date.now().toString()
    },
    writeBundle(_options, bundle) {
      const emittedAssets = Object.keys(bundle)
        .filter(file => /\.(js|css|woff2|png|svg)$/i.test(file))
        .map(file => `/${file}`)
      const precache = [...new Set(['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/pwa-192x192.png', '/pwa-512x512.png', ...emittedAssets])]
      writeFileSync(resolve(outputDirectory, 'precache-manifest.json'), JSON.stringify(precache))
      const serviceWorker = readFileSync(resolve(publicDirectory, 'sw.js'), 'utf8')
        .replace('__CACHE_VERSION__', cacheVersion)
      writeFileSync(resolve(outputDirectory, 'sw.js'), serviceWorker)
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineAssets()],
})
