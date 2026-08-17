import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    // Bundle chokidar (and its transitive readdirp) INTO the main process instead
    // of leaving it external. Both are pure ESM JS, so rollup inlines them. Under
    // pnpm, readdirp lives only as a nested symlink under .pnpm/chokidar/node_modules,
    // which electron-builder's asar collector does not follow — so an externalized
    // chokidar ships without readdirp and throws ERR_MODULE_NOT_FOUND at launch.
    // Bundling removes the runtime node_modules dependency entirely. node-pty stays
    // external (native — cannot be bundled).
    // electron-updater is excluded for the same reason: its transitives
    // (builder-util-runtime, js-yaml, semver, …) live only as nested symlinks under
    // .pnpm, so leaving it external ships an updater that throws at launch — the
    // exact failure the chokidar fix above was for, and one no test catches.
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar', 'electron-updater'] })],
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
