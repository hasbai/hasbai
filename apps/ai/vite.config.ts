import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({mode})=>({
  plugins: [tailwindcss(), svelte()],
  resolve: { conditions: ['browser'] },
  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/v1': 'http://127.0.0.1:8787' } },
  build: mode === 'e2e' ? {outDir:'dist-e2e',rollupOptions:{input:new URL('./e2e/index.html',import.meta.url).pathname}} : undefined,
  test: { include: ['worker/**/*.test.ts'], environment: 'node' },
}));
