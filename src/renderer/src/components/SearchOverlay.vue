<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { SearchHitInfo, SearchResultInfo } from '../../../shared/ipc'

// Supervision slice 5. A keyboard-summoned overlay for finding a past session
// by what was said in it. Command-palette idiom rather than one of the app's
// config modals: DESIGN.md reserves modals for config editors and confirm
// gates, and asks for keyboard-first behaviour, which this is.
//
// Search runs on SUBMIT, not per keystroke: a scan opens transcript files, and
// running that on every character typed would be wasteful and slow.

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', hit: SearchHitInfo): void
}>()

const query = ref('')
const result = ref<SearchResultInfo | null>(null)
const searching = ref(false)
const error = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)

// Whatever had focus before the overlay opened, so it can be given back. A
// keyboard-first tool that drops focus to <body> on close leaves the next Tab
// starting from nowhere.
let returnFocusTo: HTMLElement | null = null
const palette = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      returnFocusTo?.focus()
      returnFocusTo = null
      return
    }
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // A fresh query each time it opens; stale results from ten minutes ago
    // would read as answers to what was just typed.
    query.value = ''
    result.value = null
    error.value = null
    await nextTick()
    input.value?.focus()
  },
  // immediate, so an overlay mounted already-open still receives focus. Without
  // it the watcher fires only on a CHANGE, and a mount-open path would leave
  // focus outside the dialog with no way in but the mouse.
  { immediate: true }
)

// Tab containment. The overlay is modal in behaviour, so Tab must not walk out
// of it into the app behind the scrim.
function onTab(e: KeyboardEvent): void {
  const root = palette.value
  if (!root) return
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute('disabled'))
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

async function run(): Promise<void> {
  const q = query.value.trim()
  if (!q) return
  searching.value = true
  error.value = null
  try {
    result.value = await window.api.searchTranscripts(q)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    result.value = null
  } finally {
    searching.value = false
  }
}

// Split an excerpt around the match so the hit can be marked without a regex
// (a typed query is not an escaped pattern).
function parts(excerpt: string, offset: number, len: number): [string, string, string] {
  if (offset < 0 || offset > excerpt.length) return [excerpt, '', '']
  return [excerpt.slice(0, offset), excerpt.slice(offset, offset + len), excerpt.slice(offset + len)]
}
</script>

<template>
  <div v-if="props.open" class="scrim" @click.self="emit('close')">
    <div
      ref="palette"
      class="palette"
      role="dialog"
      aria-modal="true"
      aria-label="Search sessions"
      @keydown.esc="emit('close')"
      @keydown.tab="onTab"
    >
      <form class="row" @submit.prevent="run">
        <input
          ref="input"
          v-model="query"
          class="q"
          type="text"
          placeholder="Search every session, including closed ones…"
          aria-label="Search text"
        />
        <button class="primary" type="submit" :disabled="searching || !query.trim()">
          {{ searching ? 'Searching…' : 'Search' }}
        </button>
      </form>

      <p v-if="error" class="err" role="alert">{{ error }}</p>

      <template v-else-if="result">
        <p v-if="result.hits.length === 0" class="note">
          Nothing found in {{ result.sessionsScanned }} session{{ result.sessionsScanned === 1 ? '' : 's' }}.
        </p>
        <ul v-else class="hits">
          <li v-for="hit in result.hits" :key="hit.conversationId">
            <button class="hit" @click="emit('pick', hit)">
              <span class="hit-head">
                <span class="hit-title">{{ hit.title || 'session' }}</span>
                <span class="hit-tool">{{ hit.tool }}</span>
              </span>
              <span v-for="(m, i) in hit.matches" :key="i" class="m">
                <!-- The role is spelled out: "which session did I ask about X"
                     and "which session hit that error" are different questions,
                     and the answer is only useful if you can tell them apart. -->
                <span class="m-role" :class="`m-role--${m.role}`">{{ m.role === 'user' ? 'you' : 'agent' }}</span>
                <span class="m-text">
                  {{ parts(m.excerpt, m.offset, query.trim().length)[0]
                  }}<mark>{{ parts(m.excerpt, m.offset, query.trim().length)[1] }}</mark
                  >{{ parts(m.excerpt, m.offset, query.trim().length)[2] }}
                </span>
              </span>
            </button>
          </li>
        </ul>

        <!-- Never let a capped scan read as a complete one. -->
        <p v-if="result.sessionsSkipped > 0 || result.hitsTruncated" class="note">
          <template v-if="result.sessionsSkipped > 0">
            {{ result.sessionsSkipped }} older session{{ result.sessionsSkipped === 1 ? '' : 's' }} not searched.
          </template>
          <template v-if="result.hitsTruncated"> More matches exist than are shown.</template>
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  z-index: 50;
}
.palette {
  width: min(760px, 92vw);
  max-height: 70vh;
  overflow: auto;
  background: var(--surface-2);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-overlay);
  padding: 12px;
  color: var(--ink);
  font-family: var(--font-ui, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif);
}
.row { display: flex; gap: 8px; }
.q {
  flex: 1 1 auto;
  background: var(--surface);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  color: var(--ink);
  font: inherit;
}
.q::placeholder { color: var(--ink-muted); }
.q:focus { outline: 2px solid var(--teal); outline-offset: 1px; border-color: transparent; }
.primary {
  background: var(--teal);
  color: var(--bg);
  border: 0;
  border-radius: var(--radius-sm);
  padding: 6px 14px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.primary:disabled { opacity: 0.6; cursor: default; }
.primary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

.note { color: var(--ink-muted); font-size: 12px; margin: 10px 2px 2px; }
.err { color: var(--rust); font-size: 12px; margin: 10px 2px 2px; }

.hits { list-style: none; margin: 10px 0 0; padding: 0; }
.hit {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--hairline);
  color: var(--ink);
  font: inherit;
  padding: 8px 6px;
  cursor: pointer;
}
.hit:hover { background: var(--surface); }
.hit:focus-visible { outline: 2px solid var(--teal); outline-offset: -2px; }
.hit-head { display: flex; align-items: baseline; gap: 8px; }
.hit-title { font-weight: 600; }
.hit-tool {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 10.5px;
  color: var(--ink-muted);
}
.m { display: flex; gap: 8px; margin-top: 4px; align-items: baseline; }
.m-role {
  flex: 0 0 auto;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 10.5px;
  width: 4em;
  color: var(--ink-muted);
}
.m-role--user { color: var(--tan); }
.m-text {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Worn Tan, not amber. DESIGN.md reserves amber for attention STATE; tan is the
   sanctioned colour for secondary emphasis, which is exactly what a search
   highlight is. */
mark { background: color-mix(in oklch, var(--tan) 30%, transparent); color: var(--ink); }
</style>
