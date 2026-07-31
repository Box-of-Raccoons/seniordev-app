<script setup lang="ts">
import { computed } from 'vue'
import type { UseWorkspace } from '../composables/useWorkspace'
import type { UseSubagents } from '../composables/useSubagents'
import type { SubagentTile, SubagentStatus } from '../composables/subagent-tiles'
import type { SubagentPanelPlacement } from '../../../shared/ipc'

// S8: a read-only, collapsible panel of live subagent activity (ported watchers
// feed it via useSubagents). Styled to sit beside the Projects sidebar — same
// recessed --bg plane, header, icon-buttons, and a collapsed icon rail. Placement
// is a right rail (default) or a bottom strip; the parent sizes the box via
// :style and this component owns the chrome, resize grip, and the persisted
// placement/collapse/appOnly controls.
const props = defineProps<{ subagents: UseSubagents; ws: UseWorkspace }>()

const panel = props.ws.subagentPanel
const tiles = computed(() => props.subagents.tiles.value)

const BOUNDS = { right: { min: 220, max: 560 }, bottom: { min: 120, max: 500 } }
const bounds = computed(() => BOUNDS[panel.placement])

// Chevrons point toward the edge the panel collapses to (right rail → right/left;
// bottom strip → down/up), mirroring the sidebar's collapse affordance.
const collapseChevron = computed(() => (panel.placement === 'right' ? 'M6 3.5 L10.5 8 L6 12.5' : 'M3.5 6 L8 10.5 L12.5 6'))
const expandChevron = computed(() => (panel.placement === 'right' ? 'M10 3.5 L5.5 8 L10 12.5' : 'M3.5 10 L8 5.5 L12.5 10'))

function setPlacement(p: SubagentPanelPlacement): void {
  panel.placement = p
  panel.size = Math.max(BOUNDS[p].min, Math.min(BOUNDS[p].max, panel.size))
}
function toggleCollapsed(): void {
  panel.collapsed = !panel.collapsed
}

const STATUS_LABEL: Record<SubagentStatus, string> = { active: 'active', idle: 'idle', stale: 'stale', done: 'done' }
function statusOf(tile: SubagentTile): SubagentStatus {
  return props.subagents.statusOf(tile)
}
function shortId(agent: string): string {
  return agent.length > 8 ? agent.slice(0, 8) : agent
}

// Resize: drag the inner edge (left for a right rail, top for a bottom strip).
let dragging = false
let startPos = 0
let startSize = 0
function onGripDown(e: PointerEvent): void {
  dragging = true
  startPos = panel.placement === 'right' ? e.clientX : e.clientY
  startSize = panel.size
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}
function onGripMove(e: PointerEvent): void {
  if (!dragging) return
  const delta = panel.placement === 'right' ? startPos - e.clientX : startPos - e.clientY
  panel.size = Math.max(bounds.value.min, Math.min(bounds.value.max, startSize + delta))
}
function onGripUp(e: PointerEvent): void {
  dragging = false
  try {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // capture may already be gone
  }
}
function onGripKey(e: KeyboardEvent): void {
  const step = 16
  const grow = panel.placement === 'right' ? 'ArrowLeft' : 'ArrowUp'
  const shrink = panel.placement === 'right' ? 'ArrowRight' : 'ArrowDown'
  if (e.key === grow) panel.size = Math.min(bounds.value.max, panel.size + step)
  else if (e.key === shrink) panel.size = Math.max(bounds.value.min, panel.size - step)
  else return
  e.preventDefault()
}

// Auto-scroll a tile's log to the newest line on mount and whenever it grows.
const vStick = {
  mounted: (el: HTMLElement): void => {
    el.scrollTop = el.scrollHeight
  },
  updated: (el: HTMLElement): void => {
    el.scrollTop = el.scrollHeight
  }
}
</script>

<template>
  <section class="subpanel" :class="[`place-${panel.placement}`, { collapsed: panel.collapsed }]" aria-label="Subagents">
    <!-- Collapsed: a slim icon rail (mirrors the Projects sidebar's rail) — an
         expand control plus one status dot per running subagent. -->
    <div v-if="panel.collapsed" class="sp-rail">
      <button class="icon-btn" aria-label="Expand subagents panel" title="Expand subagents panel" @click="toggleCollapsed">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path :d="expandChevron" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="sp-rail-dots">
        <span
          v-for="tile in tiles"
          :key="tile.agent"
          class="dot"
          :class="`st-${statusOf(tile)}`"
          :title="`${tile.agentType || 'subagent'} · ${STATUS_LABEL[statusOf(tile)]}`"
        />
      </div>
    </div>

    <template v-else>
      <!-- Resize grip on the inner edge. -->
      <div
        class="grip"
        role="separator"
        :aria-orientation="panel.placement === 'right' ? 'vertical' : 'horizontal'"
        aria-label="Resize subagents panel"
        tabindex="0"
        @pointerdown="onGripDown"
        @pointermove="onGripMove"
        @pointerup="onGripUp"
        @keydown="onGripKey"
      />

      <header class="sp-head">
        <span class="sp-title">Subagents</span>
        <span v-if="tiles.length" class="count">{{ tiles.length }}</span>
        <div class="sp-controls">
          <label class="app-only" title="Show only subagents from sessions launched in this app">
            <input type="checkbox" v-model="panel.appOnly" />
            <span>this app</span>
          </label>
          <button
            class="icon-btn"
            :aria-label="panel.placement === 'right' ? 'Move panel to bottom' : 'Move panel to right'"
            :title="panel.placement === 'right' ? 'Dock at bottom' : 'Dock at right'"
            @click="setPlacement(panel.placement === 'right' ? 'bottom' : 'right')"
          >
            <svg v-if="panel.placement === 'right'" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3" />
              <rect x="2.5" y="9.5" width="11" height="4" fill="currentColor" />
            </svg>
            <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3" />
              <rect x="9.5" y="2.5" width="4" height="11" fill="currentColor" />
            </svg>
          </button>
          <button class="icon-btn" aria-label="Clear finished subagents" title="Clear finished" @click="subagents.clearFinished()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 4.5 H13 M6.5 4.5 V3.5 A1 1 0 0 1 7.5 2.5 H8.5 A1 1 0 0 1 9.5 3.5 V4.5 M4.5 4.5 L5.1 12.5 A1 1 0 0 0 6.1 13.4 H9.9 A1 1 0 0 0 10.9 12.5 L11.5 4.5"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button class="icon-btn" aria-label="Collapse subagents panel" title="Collapse" @click="toggleCollapsed">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path :d="collapseChevron" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      <div class="sp-body">
        <p v-if="!tiles.length" class="sp-empty">No subagents running.</p>

        <article v-for="tile in tiles" :key="tile.agent" class="tile" :class="`st-${statusOf(tile)}`">
          <div class="tile-head">
            <span class="dot" :class="`st-${statusOf(tile)}`" aria-hidden="true" />
            <span class="tile-type">{{ tile.agentType || 'subagent' }}</span>
            <span class="tile-id">{{ shortId(tile.agent) }}</span>
            <span class="tile-time">
              <span v-if="statusOf(tile) !== 'active'" class="tile-status">{{ STATUS_LABEL[statusOf(tile)] }}</span>
              {{ subagents.labelOf(tile) }}
            </span>
          </div>
          <p v-if="tile.description" class="tile-desc">{{ tile.description }}</p>
          <div v-if="tile.lines.length" v-stick class="tile-log">
            <div v-for="(line, i) in tile.lines" :key="i" class="log-line">{{ line }}</div>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Matches the Projects sidebar: recessed --bg plane with a hairline seam on the
   inner edge, so the two panels read as a pair around the work area. */
.subpanel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
  color: var(--ink);
  overflow: hidden;
  font-family: var(--font-ui, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif);
}
.place-right {
  border-left: 1px solid var(--hairline);
}
.place-bottom {
  border-top: 1px solid var(--hairline);
}

/* Resize grip — a thin hit-strip on the inner edge. */
.grip {
  position: absolute;
  z-index: 2;
  background: transparent;
}
.place-right .grip {
  left: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
}
.place-bottom .grip {
  top: 0;
  left: 0;
  height: 6px;
  width: 100%;
  cursor: row-resize;
}
.grip:hover,
.grip:focus-visible {
  background: var(--hairline-strong);
  outline: none;
}

/* Collapsed icon rail — the sidebar's .rail idiom (vertical for a right rail,
   horizontal for a bottom strip). */
.sp-rail {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 10px;
  gap: 12px;
}
.place-bottom .sp-rail {
  flex-direction: row;
  padding: 0 10px;
  gap: 12px;
}
.sp-rail .icon-btn {
  color: var(--ink-soft);
}
.sp-rail-dots {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
  align-items: center;
}
.place-bottom .sp-rail-dots {
  flex-direction: row;
  margin-top: 0;
}

/* Header — matches .sb-head (padding, hairline, ink-soft title). */
.sp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 8px 10px 12px;
  border-bottom: 1px solid var(--hairline);
  flex: 0 0 auto;
}
.sp-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
}
.count {
  font-size: 11px;
  color: var(--ink-muted);
  font-family: var(--font-mono, Consolas, monospace);
}
.sp-controls {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}
.app-only {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
  margin-right: 4px;
}
.app-only input {
  accent-color: var(--teal);
}

/* Icon buttons — identical treatment to the sidebar's .icon-btn. */
.icon-btn {
  background: transparent;
  border: 0;
  color: var(--ink-muted);
  cursor: pointer;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-btn:hover {
  color: var(--ink);
  background: var(--surface);
}
.icon-btn:focus-visible,
.grip:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: 2px;
}

/* Body + tiles. */
.sp-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.place-bottom .sp-body {
  flex-flow: row wrap;
  align-content: flex-start;
}
.place-bottom .tile {
  width: 280px;
}
.sp-empty {
  margin: 10px 10px;
  color: var(--ink-muted);
  font-size: 13px;
}

/* A tile lifts one tonal step off the recessed panel (like an open sidebar row).
   Stale/done tiles fade to signal they are winding down before auto-removal. */
.tile {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  transition: opacity 200ms var(--ease-out);
}
.tile.st-stale {
  opacity: 0.5;
}
.tile.st-done {
  opacity: 0.7;
}
.tile-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  border: 1.5px solid var(--ink-muted);
}
.dot.st-active {
  background: var(--teal);
  border-color: var(--teal);
}
.dot.st-idle {
  background: transparent;
  border-color: var(--amber);
}
.dot.st-stale {
  background: transparent;
  border-color: var(--ink-muted);
}
.dot.st-done {
  background: var(--green);
  border-color: var(--green);
}
.tile-type {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.tile-id {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 11px;
  color: var(--ink-muted);
}
.tile-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-muted);
  white-space: nowrap;
}
.tile-status {
  color: var(--ink-soft);
}
.st-idle .tile-status {
  color: var(--amber);
}
.st-done .tile-status {
  color: var(--green);
}
.tile-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tile-log {
  margin-top: 6px;
  max-height: 108px;
  overflow-y: auto;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  line-height: 1.4;
  color: var(--ink-soft);
}
.log-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
  .tile {
    transition: none;
  }
}
</style>
