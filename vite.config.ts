import { defineConfig } from 'vite';

// base is overridden in CI: vite build --base=/<repo>/
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
