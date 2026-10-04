import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // Two pages: the schedule app, and SimproSync (admin-only Simpro asset
  // sync at /simprosync/ - see simprosync/main.js). Same Firebase project
  // and Microsoft sign-in.
  build: {
    rollupOptions: {
      input: {
        main:       fileURLToPath(new URL('./index.html', import.meta.url)),
        simprosync: fileURLToPath(new URL('./simprosync/index.html', import.meta.url)),
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
        globIgnores: ['**/exceljs*.js']
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
