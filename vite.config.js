import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// SplitLy uses a hand-crafted service worker (public/sw.js) that handles
// push notifications, offline caching, and notificationclick.
// vite-plugin-pwa / Workbox is intentionally NOT used: its generateSW strategy
// would overwrite the custom SW, and injectManifest requires bundling sw.js
// which conflicts with the Web Push VAPID registration already in place.
// The manual approach is production-ready and gives full control over caching.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Warn on chunks > 600 kB (default 500)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split i18n locales into a separate chunk
        manualChunks(id) {
          if (id.includes('/locales/')) return 'locales';
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) return 'i18n';
          if (id.includes('node_modules/@supabase')) return 'supabase';
        },
      },
    },
  },
})
