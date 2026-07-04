import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Freeze the build year to a fixed value under test so assertions on the
  // credit line stay deterministic (independent of the wall-clock year).
  define: { __BUILD_YEAR__: JSON.stringify('2026') },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts']
  }
})
