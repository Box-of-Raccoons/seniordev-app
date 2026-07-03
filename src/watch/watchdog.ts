// Resolve/reject exactly like `p`, but if it hasn't settled within warnMs, call
// onWarn once — e.g. to notify the user (with a click-to-kill action) that a
// classify or YOLO run is taking unusually long. warnMs <= 0 disables the timer.
export async function runWithWarning<T>(p: Promise<T>, warnMs: number, onWarn: () => void): Promise<T> {
  if (warnMs <= 0) return p
  const timer = setTimeout(onWarn, warnMs)
  try {
    return await p
  } finally {
    clearTimeout(timer)
  }
}
