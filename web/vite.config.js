import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@shared': new URL('../shared', import.meta.url).pathname },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
