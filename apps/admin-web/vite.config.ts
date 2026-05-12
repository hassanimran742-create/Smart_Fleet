import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@smartfleet/shared-types': path.resolve(__dirname, '../../packages/shared-types/src'),
      '@smartfleet/shared-utils': path.resolve(__dirname, '../../packages/shared-utils/src'),
      '@smartfleet/shared-validation': path.resolve(__dirname, '../../packages/shared-validation/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
