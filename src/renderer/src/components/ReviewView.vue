<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import type { ReviewTreeInfo, ReviewDiffInfo } from '../../../shared/ipc'
import {
  treeLabel,
  describeChanges,
  describeSessions,
  statusMark,
  statusLabel,
  lineMark,
  lineNumberWidth
} from '../review-view'

// Supervision epic, slice 1. A Review tab: every working tree with uncommitted
// changes, and the unified diff for one of them. READ-ONLY by design — there is
// no stage, commit, or discard here, because "non-destructive by default" is a
// product principle and a surface that can throw work away is a separate
// decision (see the epic design doc).
//
// Two levels in one column rather than two panes: DESIGN.md rejects nested IDE
// chrome, and the tab itself is the surface.

const trees = ref<ReviewTreeInfo[]>([])
const loading = ref(false)
const listError = ref<string | null>(null)

const openCwd = ref<string | null>(null)
const openPath = ref<string | null>(null)
const diff = ref<ReviewDiffInfo | null>(null)
const diffLoading = ref(false)

const openTree = computed(() => trees.value.find((t) => t.cwd === openCwd.value) ?? null)
const gutter = computed(() => lineNumberWidth(diff.value?.files ?? []))

async function refresh(): Promise<void> {
  loading.value = true
  listError.value = null
  try {
    trees.value = await window.api.listReview()
    // The open tree may have been committed away while the tab sat idle.
    if (openCwd.value && !trees.value.some((t) => t.cwd === openCwd.value)) close()
  } catch (e) {
    listError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function open(cwd: string, path: string | null): Promise<void> {
  openCwd.value = cwd
  openPath.value = path
  diffLoading.value = true
  diff.value = null
  try {
    diff.value = await window.api.reviewDiff(cwd, path)
  } catch (e) {
    diff.value = { files: [], error: e instanceof Error ? e.message : String(e) }
  } finally {
    diffLoading.value = false
  }
}

function close(): void {
  openCwd.value = null
  openPath.value = null
  diff.value = null
}

onMounted(refresh)
</script>

<template>
  <section class="review" aria-label="Review">
    <header class="rv-head">
      <h2 class="rv-title">{{ openTree ? treeLabel(openTree.cwd) : 'Review' }}</h2>
      <span v-if="openTree" class="rv-sub">{{ openTree.branch ?? 'no branch' }}</span>
      <span class="rv-spacer" />
      <button v-if="openTree" class="ghost" @click="close">Back</button>
      <button class="primary" :disabled="loading" @click="refresh">
        {{ loading ? 'Reading…' : 'Refresh' }}
      </button>
    </header>

    <p v-if="listError" class="rv-error" role="alert">Could not read reviews: {{ listError }}</p>

    <!-- Level 1: every tree with pending work. -->
    <div v-if="!openTree" class="rv-body">
      <p v-if="!loading && trees.length === 0" class="rv-empty">
        Nothing uncommitted. Every session's tree is clean.
      </p>
      <ul v-else class="rv-trees">
        <li v-for="t in trees" :key="t.cwd">
          <button class="rv-tree" @click="open(t.cwd, null)">
            <span class="rv-name">{{ treeLabel(t.cwd) }}</span>
            <span class="rv-branch">{{ t.branch ?? 'no branch' }}</span>
            <span v-if="t.error" class="rv-bad">unreadable: {{ t.error }}</span>
            <span v-else class="rv-counts">{{ describeChanges(t) }}</span>
            <span class="rv-sessions">{{ describeSessions(t.sessions) }}</span>
          </button>
        </li>
      </ul>
    </div>

    <!-- Level 2: one tree — its files, then the diff. -->
    <div v-else class="rv-body">
      <ul class="rv-files">
        <li v-for="e in openTree.entries" :key="e.path">
          <button
            class="rv-file"
            :class="{ on: openPath === e.path }"
            :aria-current="openPath === e.path ? 'true' : undefined"
            @click="open(openTree!.cwd, e.path)"
          >
            <span class="rv-path">{{ e.path }}</span>
            <span v-if="e.untracked" class="rv-new" title="untracked">new</span>
            <span v-if="e.binary" class="rv-bin">binary</span>
            <span v-else class="rv-stat">
              <span class="add">+{{ e.insertions }}</span>
              <span class="del">-{{ e.deletions }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="openTree.untrackedTruncated > 0" class="rv-note">
        {{ openTree.untrackedTruncated }} further untracked files not listed.
      </p>

      <p v-if="diffLoading" class="rv-note">Reading diff…</p>
      <p v-else-if="diff?.error" class="rv-error" role="alert">{{ diff.error }}</p>
      <div v-else-if="diff" class="rv-diff">
        <article v-for="f in diff.files" :key="f.path" class="rv-fdiff">
          <h3 class="rv-fhead">
            <span class="rv-mark" :class="f.status" role="img" :aria-label="statusLabel(f.status)">{{ statusMark(f.status) }}</span>
            <span v-if="f.oldPath">{{ f.oldPath }} → </span>{{ f.path }}
          </h3>
          <p v-if="f.binary" class="rv-note">Binary file, not shown.</p>
          <div v-for="(h, hi) in f.hunks" :key="hi" class="rv-hunk">
            <div class="rv-hhead">{{ h.header }}</div>
            <div
              v-for="(l, li) in h.lines"
              :key="li"
              class="rv-line"
              :class="l.kind"
            >
              <span class="rv-num" :style="{ width: gutter + 'ch' }">{{ l.oldLine ?? '' }}</span>
              <span class="rv-num" :style="{ width: gutter + 'ch' }">{{ l.newLine ?? '' }}</span>
              <span class="rv-sign" aria-hidden="true">{{ lineMark(l.kind) }}</span>
              <span class="rv-text">{{ l.text }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.review {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-ui, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif);
  font-size: 14px;
}

.rv-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline);
  flex: 0 0 auto;
}
.rv-title { font-size: 15px; font-weight: 600; margin: 0; }
.rv-sub {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 11px;
  color: var(--ink-muted);
}
.rv-spacer { flex: 1 1 auto; }

button { font: inherit; border-radius: var(--radius-sm); cursor: pointer; }
button:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
.primary {
  background: var(--teal);
  color: var(--bg);
  border: none;
  font-weight: 600;
  padding: 6px 14px;
}
.primary:disabled { opacity: 0.6; cursor: default; }
.ghost {
  background: transparent;
  border: 1px solid var(--hairline-strong);
  color: var(--ink-soft);
  padding: 6px 14px;
}
.ghost:hover { color: var(--ink); }

.rv-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 12px 16px; }
.rv-empty, .rv-note { color: var(--ink-muted); font-size: 13px; margin: 10px 2px; }
.rv-error { color: var(--rust); font-size: 13px; margin: 10px 2px; }

.rv-trees, .rv-files { list-style: none; margin: 0; padding: 0; }

/* A row, not a card: DESIGN.md rejects card grids. Tone and a hairline do the
   separating; hover firms rather than lifts. */
.rv-tree, .rv-file {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--hairline);
  color: var(--ink);
  padding: 8px 6px;
  transition: background 120ms var(--ease-out);
}
.rv-tree:hover, .rv-file:hover { background: var(--surface); }
.rv-file.on { background: var(--surface-2); }

.rv-name { font-weight: 600; }
.rv-branch, .rv-path {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  color: var(--ink-soft);
}
.rv-path { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-counts, .rv-stat {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  color: var(--ink-muted);
}
.rv-sessions {
  flex: 1 1 auto;
  color: var(--ink-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rv-bad { color: var(--rust); font-size: 12px; }
.rv-new, .rv-bin {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 10.5px;
  color: var(--ink-muted);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius-sm);
  padding: 0 5px;
}
.rv-stat { display: inline-flex; gap: 6px; }
.add { color: var(--green); }
.del { color: var(--rust); }

.rv-diff { margin-top: 14px; }
.rv-fhead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  margin: 14px 0 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--hairline);
}
/* The letter carries the status; colour only reinforces it. */
.rv-mark {
  font-weight: 700;
  width: 1.2em;
  text-align: center;
  color: var(--ink-soft);
}
.rv-mark.added { color: var(--green); }
.rv-mark.deleted { color: var(--rust); }
.rv-mark.renamed { color: var(--tan); }

.rv-hunk { margin-bottom: 10px; }
.rv-hhead {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 11.5px;
  color: var(--ink-muted);
  background: var(--surface);
  padding: 2px 8px;
}
.rv-line {
  display: flex;
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 13px;
  line-height: 1.4;
  white-space: pre;
}
/* No opacity here. ink-muted already clears 4.5:1 on its plane; dimming it
   further pushes 13px body text under the AA floor, and worse on the tinted
   add/delete rows. Muting is what the token is for. */
.rv-num {
  flex: 0 0 auto;
  text-align: right;
  padding-right: 8px;
  color: var(--ink-muted);
  user-select: none;
}
.rv-sign { flex: 0 0 auto; width: 2ch; user-select: none; }
.rv-text { flex: 1 1 auto; overflow-wrap: anywhere; white-space: pre-wrap; }

/* Tint plus the +/- sign, never the tint alone. */
.rv-line.add { background: color-mix(in oklch, var(--green) 12%, transparent); }
.rv-line.add .rv-sign, .rv-line.add .rv-text { color: var(--green); }
.rv-line.del { background: color-mix(in oklch, var(--rust) 12%, transparent); }
.rv-line.del .rv-sign, .rv-line.del .rv-text { color: var(--rust); }

@media (prefers-reduced-motion: reduce) {
  .rv-tree, .rv-file { transition: none; }
}
</style>
