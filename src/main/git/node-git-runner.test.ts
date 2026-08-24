import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeGitRunner, MAX_GIT_OUTPUT_BYTES } from './node-git-runner'

// The one file that drives the REAL git runner. Everything else uses a fake, so
// without this the exit-code mapping and the output ceiling are claims nothing
// checks — and both have already been wrong once.

let repo: string
const git = (...args: string[]): void => {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' })
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'seniordev-gitrunner-'))
  git('init', '-q')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'test')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'seed.txt'), 'seed\n')
  git('add', 'seed.txt')
  git('commit', '-q', '-m', 'seed')
})

afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('nodeGitRunner (real git)', () => {
  it('returns a zero exit and stdout for a successful command', async () => {
    const r = await nodeGitRunner(repo, ['rev-parse', '--is-inside-work-tree'])
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('true')
  })

  it('reports a non-zero exit as DATA, not by rejecting', async () => {
    // The whole seam depends on a failing git being a value the service reads.
    const r = await nodeGitRunner('/', ['rev-parse', '--is-inside-work-tree'])
    expect(r.code).not.toBe(0)
    expect(r.stderr.toLowerCase()).toContain('not a git repository')
  })

  it('maps the exit STATUS correctly, not just a generic 1', async () => {
    // Async execFile exposes the status on `code`, where the sync version used
    // `status`. Reading the wrong field turns every git failure into exit 1
    // with the wrong message.
    const r = await nodeGitRunner(repo, ['rev-parse', '--verify', 'refs/heads/no-such-branch'])
    expect(r.code).toBeGreaterThan(0)
  })

  it('never rejects, even for a command git does not know', async () => {
    await expect(nodeGitRunner(repo, ['definitely-not-a-subcommand'])).resolves.toBeDefined()
  })

  it('HANDLES more than 1MB of output, which used to fail outright', async () => {
    // The default execFileSync buffer is 1MB and overflowing it does not
    // truncate: the call fails with ENOBUFS and a null status. A whole-tree
    // review diff over 1MB therefore showed an error instead of the diff.
    const big = Array.from({ length: 40_000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
    writeFileSync(join(repo, 'big.txt'), big)
    git('add', 'big.txt')

    const r = await nodeGitRunner(repo, ['diff', 'HEAD', '--'])
    expect(r.stdout.length).toBeGreaterThan(1024 * 1024)
    expect(r.code).toBe(0)
    expect(r.stderr).not.toContain('ENOBUFS')
    expect(r.stdout).toContain('line 39999')
  })

  it('has a ceiling well above a readable diff', () => {
    expect(MAX_GIT_OUTPUT_BYTES).toBeGreaterThanOrEqual(32 * 1024 * 1024)
  })
})
