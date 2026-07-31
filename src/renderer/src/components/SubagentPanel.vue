<script setup lang="ts">
import { computed } from 'vue'
import type { UseWorkspace } from '../composables/useWorkspace'
import type { UseSubagents } from '../composables/useSubagents'
import type { SubagentTile, SubagentStatus } from '../composables/subagent-tiles'
import type { SubagentPanelPlacement } from '../../../shared/ipc'

// S8: a read-only, collapsible panel of live subagent activity (ported watchers
// feed it via useSubagents). Placement is a right rail (default) or a bottom
// strip; either way the parent sizes the box via :style and this component owns
// the internal chrome, the resize grip, and the placement/collapse/appOnly
// controls (which mutate the persisted ws.subagentPanel).
const props = defineProps<{ subagents: UseSubagents; ws: UseWorkspace }>()

const panel = props.ws.subagentPanel
const tiles = computed(() => props.subagents.tiles.value)

// Per-axis resize bounds: width for the right rail, height for the bottom strip.
const BOUNDS = { right: { min: 220, max: 560 }, bottom: { min: 120, max: 500 } }
const bounds = computed(() => BOUNDS[panel.placement])

function setPlacement(p: SubagentPanelPlacement): void {
  panel.placement = p
  // Clamp the carried-over size into the new axis's bounds.
  panel.size = Math.max(BOUNDS[p].min, Math.min(BOUNDS[p].max, panel.size))
}
function toggleCollapsed(): void {
  panel.collapsed = !panel.collapsed
}

// A short, readable status word (never color alone: the dot's color is paired
// with this label + the relative time).
const STATUS_LABEL: Record<SubagentStatus, string> = {
  active: 'active',
  idle: 'idle',
  stale: 'stale',
  done: 'done'
}
function statusOf(tile: SubagentTile): SubagentStatus {
  return props.subagents.statusOf(tile)
}
function shortId(agent: string): string {
  return agent.length > 8 ? agent.slice(0, 8) : agent
}

// Resize: drag the inner edge (left for a right rail, top for a bottom strip).
// Mirrors the sidebar grip — pointer capture + keyboard nudge, size persists via
// ws.subagentPanel → workspace.json.
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
  // Right rail grows as the pointer moves LEFT (grip is on the left edge); bottom
  // strip grows as the pointer moves UP (grip is on the top edge).
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
    <!-- Resize grip on the inner edge (hidden while collapsed). -->
    <div
      v-if="!panel.collapsed"
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

    <!-- Collapsed: a slim strip with an expand control and the running count. -->
    <button
      v-if="panel.collapsed"
      class="collapsed-toggle"
      aria-label="Expand subagents panel"
      title="Expand subagents panel"
      @click="toggleCollapsed"
    >
      <span class="collapsed-title">Subagents</span>
      <span v-if="tiles.length" class="count">{{ tiles.length }}</span>
    </button>

    <template v-else>
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
            :title="panel.placement === 'right' ? 'Move to bottom' : 'Move to right'"
            @click="setPlacement(panel.placement === 'right' ? 'bottom' : 'right')"
          >
            {{ panel.placement === 'right' ? '⇧' : '⇥' }}
          </button>
          <button
            class="icon-btn"
            aria-label="Clear finished subagents"
            title="Clear finished"
            @click="subagents.clearFinished()"
          >
            ⌫
          </button>
          <button class="icon-btn" aria-label="Collapse subagents panel" title="Collapse" @click="toggleCollapsed">
            ×
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
.subpanel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
  color: var(--ink);
  overflow: hidden;
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

/* Collapsed strip. */
.collapsed-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
}
.place-right .collapsed-toggle {
  flex-direction: column;
}
.collapsed-toggle:hover {
  color: var(--ink);
}
.place-right .collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

/* Header. */
.sp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--hairline);
  flex: 0 0 auto;
}
.sp-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.count {
  font-size: 12px;
  color: var(--bg);
  background: var(--teal);
  border-radius: 999px;
  padding: 0 6px;
  line-height: 18px;
  min-width: 18px;
  text-align: center;
}
.sp-controls {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.app-only {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
  margin-right: 2px;
}
.app-only input {
  accent-color: var(--teal);
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ink-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}
.icon-btn:hover {
  color: var(--ink);
  background: var(--surface-2);
}
.icon-btn:focus-visible,
.grip:focus-visible {
  outline: 2px solid var(--teal);
  outline-offset: -2px;
}

/* Body + tiles. */
.sp-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px;
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
  margin: 12px 4px;
  color: var(--ink-muted);
  font-size: 13px;
}
.tile {
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
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
  font-family: Consolas, monospace;
  font-size: 12px;
  color: var(--ink-muted);
}
.tile-time {
  margin-left: auto;
  font-size: 12px;
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
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.4;
  color: var(--ink-soft);
}
.log-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
