import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const BASE_PATH = '/Bookworm/';

export default defineConfig(() => ({
  base: BASE_PATH,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Bookworm',
        short_name: 'Bookworm',
        description:
          'A premium local-first PWA for reading books and grounding AI chat in book content.',
        theme_color: '#1a1714',
        background_color: '#f6f1e8',
        display: 'standalone',
        orientation: 'any',
        scope: BASE_PATH,
        start_url: BASE_PATH,
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: `${BASE_PATH}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
    cors: true,
  },
}));
