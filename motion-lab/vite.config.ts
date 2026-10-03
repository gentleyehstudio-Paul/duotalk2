import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Build-time configuration only. Analysis thresholds live in src/config/thresholds.ts.
const PRECACHE_MAX_FILE_BYTES = 20 * 1024 * 1024; // the pose model (~9.4 MB) must be precached for offline use

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['models/*.task', 'wasm/*'],
      manifest: {
        name: 'MOTION LAB — Form Shooting',
        short_name: 'MOTION LAB',
        description: '個人投籃動作研究工具：影片 → 骨架時間序列 → 指標 → 比較 → 建議',
        lang: 'zh-Hant',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: PRECACHE_MAX_FILE_BYTES,
        globPatterns: ['**/*.{js,css,html,svg,wasm,task}'],
      },
    }),
  ],
  server: {
    headers: {
      // Not strictly required by tasks-vision 1.x, but keeps SharedArrayBuffer paths available.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
