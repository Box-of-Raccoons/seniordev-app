// Pure resolution of one gate run: exit code plus output to a state and a single
// line fit for a tab. No spawning here (gate-runner.ts owns that), so this is
// unit-testable against captured output with no child process.

export type GateOutcome = 'pass' | 'fail' | 'error'

export interface GateRun {
  code: number | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut?: boolean
}

export interface GateResult {
  outcome: GateOutcome
  code: number | null
  summary: string
  output: string
  durationMs: number
}

// The tab strip is tight; anything longer is truncated rather than allowed to
// push the layout around.
export const SUMMARY_MAX = 90

// Test runners colour their output. Rendering the raw escape codes on a tab
// would be worse than useless, so they come off before anything else.
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g

// A tally line from a test runner: vitest/jest ("Tests 3 passed"), go, cargo,
// pytest. Matched loosely on purpose — the exact wording varies per runner and
// per version, and a near-miss just falls through to the last-line rule.
const TALLY = /^.*\b\d+\s+(passed|failed|passing|failing|ok|error(?:s)?)\b.*$/i

function clean(s: string): string[] {
  return s
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter(Boolean)
}

function cap(s: string): string {
  return s.length <= SUMMARY_MAX ? s : s.slice(0, SUMMARY_MAX - 1) + '…'
}

export function gateSummary(stdout: string, stderr: string, code: number | null): string {
  const out = clean(stdout)
  const err = clean(stderr)

  // A tally line is the most informative thing a runner prints, and it is what a
  // human would look for. Search stdout first, then stderr.
  for (const lines of [out, err]) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (TALLY.test(lines[i])) return cap(lines[i])
    }
  }

  const last = out[out.length - 1] ?? err[err.length - 1]
  if (last) return cap(last)

  if (code === 0) return 'passed'
  return code === null ? 'did not run' : `failed (exit ${code})`
}

export function resolveGate(run: GateRun): GateResult {
  const output = [run.stdout, run.stderr].filter(Boolean).join('\n')

  // A null exit code means the command never produced one: it was killed, timed
  // out, or could not be spawned. That is a broken GATE, not failing code, and
  // conflating the two would blame the work for the harness.
  if (run.timedOut) {
    return {
      outcome: 'error',
      code: null,
      summary: `gate timed out after ${Math.round(run.durationMs / 1000)}s`,
      output,
      durationMs: run.durationMs
    }
  }
  if (run.code === null) {
    return {
      outcome: 'error',
      code: null,
      summary: gateSummary(run.stdout, run.stderr, null),
      output,
      durationMs: run.durationMs
    }
  }

  return {
    outcome: run.code === 0 ? 'pass' : 'fail',
    code: run.code,
    summary: gateSummary(run.stdout, run.stderr, run.code),
    output,
    durationMs: run.durationMs
  }
}
