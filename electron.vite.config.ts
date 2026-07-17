import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    // The copyright/build year, frozen at compile time so "built {year}" is literally
    // the year this bundle was produced (see Splash.vue / AboutModal.vue).
    define: { __BUILD_YEAR__: JSON.stringify(String(new Date().getFullYear())) },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [vue()]
  }
})
