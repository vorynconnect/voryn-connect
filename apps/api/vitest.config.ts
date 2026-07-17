import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration suites share one local database; running files sequentially
    // keeps fixtures from racing each other's serializable transactions.
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
  },
});
