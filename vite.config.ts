import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    VitePWA({
      // 'prompt', not 'autoUpdate'. autoUpdate swaps the app out from under
      // whoever is reading it, and — worse for a bug hunt — does it silently,
      // so a reader testing a fix cannot tell an old build from a new one. The
      // reader is asked instead, and nothing changes until they say so.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Bookworm',
        short_name: 'Bookworm',
        description: 'Your bookshelf, with an LLM living inside it.',
        theme_color: '#f0ae2f',
        background_color: '#050506',
        display: 'standalone',
        // No start_url or scope here on purpose: the plugin fills both from
        // the build's `base`. That is '/' at bookworm.talk and locally, and
        // '/Bookworm/' in the sub-path build — hard-coding either one installs
        // an app that opens the wrong site.
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,mjs}'],
        // The pdf.js worker chunk is ~1.3 MB; leave headroom.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
