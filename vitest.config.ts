import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    restoreMocks: true,
    environment: 'node',
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      // Baileys uses .js extensions in imports — resolve to .ts source files
    },
  },
});
