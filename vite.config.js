import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // SimproSync used to be a second input here. It moved to the internal hub,
  // at internal.chsnz.co.nz/simprosync/, and was removed rather than left
  // running in two places — there is only one version of it now.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The Excel library (Out of town → Download) loads on demand instead —
        // no reason for every phone to download ~1 MB it may never use.
        // Same reasoning for the Ansur PDF builder: a ~590 KB self-contained
        // page only the service team opens, and leaving it out of the
        // precache means it's always fetched fresh rather than going stale
        // behind the worker the way /simprosync/ did.
        globIgnores: ['**/exceljs*.js', '**/ansurtopdf/**']
      },
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'CMCHS Staff Schedule',
        short_name: 'CMCHS Staff Schedule',
        description: 'Team weekly location scheduler',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
