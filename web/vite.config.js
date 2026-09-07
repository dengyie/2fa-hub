import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@shared': new URL('../shared', import.meta.url).pathname },
  },
  server: {
    proxy: { '/api': process.env.API_PROXY || 'http://127.0.0.1:8000' },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
