import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  resolve: {
    alias: {
      '@shared': path.resolve(process.cwd(), 'shared')
    }
  },
  server: {
    middlewareMode: true,
    fs: {
      allow: ['..']
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
