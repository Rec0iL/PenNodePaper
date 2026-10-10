import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// PNP_PORT / PNP_WEB_PORT: a second dev instance (e.g. to try something against a scratch campaign) next to your own
const api = process.env.PNP_PORT ?? '4317';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: Number(process.env.PNP_WEB_PORT ?? 5273),
    proxy: {
      '/api': `http://127.0.0.1:${api}`,
      '/ws': { target: `ws://127.0.0.1:${api}`, ws: true },
    },
  },
});
