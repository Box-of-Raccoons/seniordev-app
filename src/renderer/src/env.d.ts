/// <reference types="vite/client" />
import type { Api } from '../../preload/index'

declare global {
  interface Window {
    api: Api
  }
  /** Copyright/build year, injected at build time via Vite `define`. */
  const __BUILD_YEAR__: string
}

export {}
