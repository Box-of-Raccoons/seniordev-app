<script setup lang="ts">
import { ref } from 'vue'
import TerminalView from './TerminalView.vue'
import YoloView from './YoloView.vue'
import Composer from './Composer.vue'
import NewTabMenu from './NewTabMenu.vue'
import EmptyState from './EmptyState.vue'
import raccoonAsleepUrl from '../assets/raccoon-asleep.png'
import type { ComposerLaunch } from './composer-types'

interface Prefill {
  input?: string
  folder?: string
  role?: string
}

interface Term {
  id: string
  title: string
  kind: 'composer' | 'terminal' | 'yolo' | 'shell'
  variant?: 'agent' | 'terminal'
  prefill?: Prefill
  prompt?: { name?: string; text?: string }
  input?: string
  tool?: string
  ticketKey?: string
  shell?: string
  exited?: boolean
  resume?: { sessionId: string }
  cwdOverride?: string
}
const terms = ref<Term[]>([])
const activeId = ref<string | null>(null)
let counter = 0

function addTerm(t: Omit<Term, 'id'>): void {
  counter += 1
  const id = `t${counter}-${Date.now()}`
  terms.value.push({ id, ...t })
  activeId.value = id
}

// Programmatic new tab (boot / reset / deep-link): a default agent composer on
// the default CLI tool. The New-tab menu drives the explicit tool/terminal choice.
function newTab(): void {
  addTerm({ title: 'New session', kind: 'composer', variant: 'agent' })
}

function onPick(p: { variant: 'agent' | 'terminal'; tool?: string }): void {
  const title = p.variant === 'terminal' ? 'New shell' : p.tool ? p.tool[0].toUpperCase() + p.tool.slice(1) : 'New session'
  addTerm({ title, kind: 'composer', variant: p.variant, tool: p.tool })
}

// Open a prefilled agent composer (used by the deep-link entry point). The user
// reviews the prefill and launches it themselves.
function openComposer(prefill: Prefill): void {
  addTerm({ title: 'New session', kind: 'composer', variant: 'agent', prefill })
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}
function short(s: string, n = 22): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Morph a composer tab in place into the session it launched. Mutating the Term
// flips the slot's v-if, so Composer unmounts and the run view mounts + spawns.
function launch(t: Term, p: ComposerLaunch): void {
  t.cwdOverride = p.folder
  if (p.mode === 'terminal') {
    t.kind = 'shell'
    t.shell = p.shell
    t.title = `${p.shell ?? 'shell'} · ${basename(p.folder)}`
    return
  }
  t.kind = p.yolo ? 'yolo' : 'terminal'
  t.tool = p.tool ?? t.tool
  t.prompt = p.role ? { name: p.role } : undefined
  t.input = p.input
  t.ticketKey = p.ticketKey
  const subject = p.ticketKey ?? (p.input ? short(p.input) : basename(p.folder))
  t.title = `${p.role ?? 'session'} · ${subject}`
}

function startStartupSession(
  s: { mode: 'interactive' | 'yolo'; promptName?: string; promptText?: string; tool?: string },
  ticketKey?: string
): void {
  const prompt = s.promptName ? { name: s.promptName } : s.promptText ? { text: s.promptText } : undefined
  addTerm({
    title: `${s.promptName ?? (s.mode === 'yolo' ? 'yolo' : 'session')} ${counter + 1}`,
    kind: s.mode === 'yolo' ? 'yolo' : 'terminal',
    prompt,
    tool: s.tool,
    ticketKey,
    input: ticketKey
  })
}

function closeAll(): void {
  for (const t of [...terms.value]) closeTerm(t.id)
}

function hasSessions(): boolean {
  return terms.value.length > 0
}

defineExpose({ newTab, openComposer, startStartupSession, closeAll, hasSessions })

function resumeYolo(from: Term, p: { sessionId: string; cwd: string; tool: string }): void {
  addTerm({
    title: `${from.title} (resumed)`,
    kind: 'terminal',
    tool: p.tool || undefined,
    resume: { sessionId: p.sessionId },
    cwdOverride: p.cwd || undefined
  })
}

function closeTerm(id: string): void {
  const i = terms.value.findIndex((t) => t.id === id)
  if (i === -1) return
  terms.value.splice(i, 1)
  if (activeId.value === id) activeId.value = terms.value.at(-1)?.id ?? null
}

function markExited(id: string): void {
  const t = terms.value.find((t) => t.id === id)
  if (t) t.exited = true
}
</script>

<template>
  <section class="workbench">
    <div class="term-bar">
      <nav class="term-tabs">
        <div
          v-for="t in terms"
          :key="t.id"
          class="term-tab"
          :class="{ 'term-tab--active': t.id === activeId, 'term-tab--dead': t.exited }"
        >
          <button class="term-tab__label" @click="activeId = t.id">{{ t.title }}</button>
          <button class="term-tab__close" :aria-label="`Close ${t.title}`" @click="closeTerm(t.id)">×</button>
        </div>
      </nav>
      <NewTabMenu @pick="onPick" />
    </div>

    <div class="term-body">
      <EmptyState v-if="!terms.length" :image="raccoonAsleepUrl" caption='No sessions — start one with "+".' />
      <div
        v-for="t in terms"
        v-show="t.id === activeId"
        :key="t.id"
        class="term-slot"
      >
        <Composer
          v-if="t.kind === 'composer'"
          :variant="t.variant ?? 'agent'"
          :tool="t.tool"
          :initial-input="t.prefill?.input"
          :initial-folder="t.prefill?.folder"
          :initial-role="t.prefill?.role"
          @launch="launch(t, $event)"
        />
        <YoloView
          v-else-if="t.kind === 'yolo'"
          :id="t.id"
          :ticket-key="t.ticketKey ?? null"
          :input="t.input"
          :prompt="t.prompt"
          :tool="t.tool"
          @exited="markExited(t.id)"
          @resume="resumeYolo(t, $event)"
        />
        <TerminalView
          v-else-if="t.kind === 'shell'"
          :id="t.id"
          :shell="t.shell"
          :cwd-override="t.cwdOverride"
          @exited="markExited(t.id)"
        />
        <TerminalView
          v-else
          :id="t.id"
          :ticket-key="t.ticketKey ?? null"
          :input="t.input"
          :prompt="t.prompt"
          :tool="t.tool"
          :resume="t.resume"
          :cwd-override="t.cwdOverride"
          @exited="markExited(t.id)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.workbench { display: flex; flex-direction: column; height: 100%; flex: 1; min-width: 0; background: var(--surface); }
.term-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--hairline); }
.term-tabs { display: flex; gap: 4px; flex: 1; flex-wrap: wrap; }
.term-tab {
  display: inline-flex; align-items: center;
  background: var(--surface); color: var(--ink-soft);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
}
.term-tab--active { background: var(--surface-2); color: var(--ink); }
.term-tab--dead .term-tab__label { color: var(--ink-muted); text-decoration: line-through; }
.term-tab__label {
  background: transparent; border: 0; color: inherit; font: inherit;
  padding: 5px 4px 5px 10px; cursor: pointer;
}
.term-tab__close {
  background: transparent; border: 0; color: var(--ink-muted); font: inherit; line-height: 1;
  padding: 5px 8px; cursor: pointer;
}
.term-tab__close:hover { color: var(--ink); }
.term-tab__label:focus-visible, .term-tab__close:focus-visible {
  outline: 2px solid var(--teal); outline-offset: -2px; border-radius: var(--radius-sm);
}
.term-body { flex: 1; position: relative; overflow: hidden; }
.term-slot { position: absolute; inset: 0; padding: 6px; }
</style>
