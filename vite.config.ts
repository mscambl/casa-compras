import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lo pone el workflow de GitHub Pages (/<repo>/); en local es /.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Casa · Compras',
        short_name: 'Compras',
        description: 'Lista de la compra, inventario y gasto del hogar',
        lang: 'es',
        theme_color: '#1f7a5a',
        background_color: '#f6f5f1',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Fotos de productos: se guardan para verlas sin conexión.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/sign/product-photos/'),
            handler: 'CacheFirst',
            options: { cacheName: 'fotos', expiration: { maxEntries: 400, maxAgeSeconds: 7 * 86400 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'images.openfoodfacts.org',
            handler: 'CacheFirst',
            options: { cacheName: 'fotos-off', expiration: { maxEntries: 400, maxAgeSeconds: 30 * 86400 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
})
