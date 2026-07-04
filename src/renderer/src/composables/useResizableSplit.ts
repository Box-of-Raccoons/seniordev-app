import { computed, ref, type Ref } from 'vue'

export interface SplitOptions {
  /** Minimum width (px) the left panel may shrink to. */
  minLeft?: number
  /** Minimum width (px) the right panel may shrink to. */
  minRight?: number
  /** Width (px) of the divider handle itself. */
  dividerWidth?: number
  /** Keyboard nudge distance (px) per arrow-key press. */
  step?: number
}

export const DEFAULTS = { minLeft: 320, minRight: 320, dividerWidth: 6, step: 24 } as const

/**
 * Clamp a desired left-panel width so both panels keep their minimums and the
 * divider stays on-screen. When the container is too narrow to honour both
 * minimums, we pin the left panel to its minimum rather than collapsing it.
 */
export function clampLeftWidth(
  desired: number,
  containerWidth: number,
  minLeft: number,
  minRight: number,
  dividerWidth: number
): number {
  const max = containerWidth - dividerWidth - minRight
  if (max <= minLeft) {
    // Not enough room for both minimums — favour the left minimum but never
    // exceed what the container can physically hold.
    return Math.max(0, Math.min(minLeft, Math.max(0, containerWidth - dividerWidth)))
  }
  return Math.min(Math.max(desired, minLeft), max)
}

/**
 * Drives a two-panel horizontal split. `leftWidth` is `null` until the user
 * first interacts, which keeps the initial layout an even flex split; once
 * dragged (or nudged) it becomes a pixel width the left panel is pinned to
 * while the right panel flexes into the remaining space.
 */
export function useResizableSplit(container: Ref<HTMLElement | null>, opts: SplitOptions = {}) {
  const minLeft = opts.minLeft ?? DEFAULTS.minLeft
  const minRight = opts.minRight ?? DEFAULTS.minRight
  const dividerWidth = opts.dividerWidth ?? DEFAULTS.dividerWidth
  const step = opts.step ?? DEFAULTS.step

  const leftWidth = ref<number | null>(null)
  const dragging = ref(false)

  function containerWidth(): number {
    return container.value?.getBoundingClientRect().width ?? 0
  }

  /** Current left width in px, resolving the even-split default when unset. */
  function currentLeft(): number {
    if (leftWidth.value != null) return leftWidth.value
    const cw = containerWidth()
    return cw > 0 ? (cw - dividerWidth) / 2 : minLeft
  }

  function setLeft(desired: number): void {
    leftWidth.value = clampLeftWidth(desired, containerWidth(), minLeft, minRight, dividerWidth)
  }

  let startX = 0
  let startWidth = 0

  function onPointerMove(e: PointerEvent): void {
    setLeft(startWidth + (e.clientX - startX))
  }

  function onPointerUp(): void {
    dragging.value = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  function onPointerDown(e: PointerEvent): void {
    e.preventDefault()
    startX = e.clientX
    startWidth = currentLeft()
    dragging.value = true
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft') {
      setLeft(currentLeft() - step)
      e.preventDefault()
    } else if (e.key === 'ArrowRight') {
      setLeft(currentLeft() + step)
      e.preventDefault()
    }
  }

  /** Inline style for the left panel: even flex by default, pinned px once driven. */
  const leftStyle = computed(() =>
    leftWidth.value == null ? { flex: '1 1 0' } : { flex: `0 0 ${leftWidth.value}px` }
  )

  /** Left share as a 0–100 integer for `aria-valuenow` (50 until measurable). */
  const leftPercent = computed(() => {
    const cw = containerWidth()
    if (cw <= 0) return 50
    return Math.round((currentLeft() / (cw - dividerWidth)) * 100)
  })

  return {
    leftWidth,
    dragging,
    leftStyle,
    leftPercent,
    minLeft,
    minRight,
    dividerWidth,
    onPointerDown,
    onPointerUp,
    onKeydown,
    setLeft,
    currentLeft
  }
}
