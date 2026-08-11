import type { MetadataRoute } from 'next'

// Installable on the phones that actually run this restaurant.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'KitchenBooks — Thrayam',
    short_name: 'KitchenBooks',
    description: 'Bills, store, kitchen, cash and sales — the whole spine of the restaurant.',
    start_url: '/',
    display: 'standalone',
    background_color: '#eff3f7',
    theme_color: '#2f6b47',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
