// jsdom does not implement <canvas>. @xterm/xterm probes getContext('2d') at
// module-eval time (its color parser), which jsdom logs as a noisy
// "Not implemented" error even when we never open a real Terminal in tests.
// Provide a minimal no-op 2D context so test output stays pristine.
const noopCtx = {
  fillRect: () => {},
  clearRect: () => {},
  getImageData: () => ({ data: [0, 0, 0, 0] }),
  putImageData: () => {},
  createImageData: () => ({ data: [0, 0, 0, 0] }),
  drawImage: () => {},
  fillText: () => {},
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => ({ addColorStop: () => {} }),
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  scale: () => {}
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => noopCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext
}
