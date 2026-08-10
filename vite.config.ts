import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      'next/image': path.resolve(__dirname, 'src/shims/next-image.ts'),
      '@jest/globals': 'vitest',
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts', 'src/solver/**/*.test.ts'],
    testTimeout: 30000,
  },
});
