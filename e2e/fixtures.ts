// Per-scenario sandbox builder. Each spec file gets a fresh HOME containing the
// app's whole config-dir surface: config.yaml with only the fake tool, plus the
// stores that stage the scenario. Records are written in the stores' persisted
// doc shapes (see src/main/store/*, src/main/schedule/schedules-store.ts).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const e2eDir = dirname(fileURLToPath(import.meta.url))

export const CONV_ID = 'e2e-conversation-1'
export const AGENT_SESSION_ID = '11111111-1111-4111-8111-111111111111'
export const LAUNCH_PROMPT = 'hello from the e2e launch schedule'
export const RESUME_PROMPT = 'hello from the e2e resume schedule'

function baseSchedule(overrides: Record<string, unknown>): Record<string, unknown> {
  const past = Date.now() - 60_000
  return {
    id: 'e2e-schedule-1',
    enabled: true,
    title: 'e2e schedule',
    prompt: 'unused',
    trigger: { kind: 'once', atMs: past },
    catchUp: true,
    maxFirings: null,
    stopOnFailure: false,
    firedCount: 0,
    nextDueAt: past,
    lastFiredAt: null,
    lastOutcome: null,
    lastReason: null,
    deferredSinceAt: null,
    createdAt: past - 60_000,
    ...overrides
  }
}

function writeCommon(home: string): string {
  const cfgDir = join(home, '.config', 'SeniorDev')
  mkdirSync(cfgDir, { recursive: true })
  const fakeCli = join(e2eDir, 'fake-cli.mjs')
  writeFileSync(
    join(cfgDir, 'config.yaml'),
    [
      'defaultTool: fake',
      'cliTools:',
      '  fake:',
      '    command: node',
      '    interactiveArgs:',
      `      - ${fakeCli}`,
      '    promptDelivery: stdin',
      '    resumeArgs:',
      '      - "--resume"',
      '      - "{{sessionId}}"',
      ''
    ].join('\n')
  )
  return cfgDir
}

function writeConversation(cfgDir: string, home: string, agentSessionId: string | null): void {
  const now = Date.now()
  writeFileSync(
    join(cfgDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [
        {
          id: 'e2e-project-1',
          title: 'e2e',
          path: home,
          defaultTool: 'fake',
          worktreeDefault: false,
          lastActiveAt: now,
          archivedAt: null,
          createdAt: now,
          updatedAt: now
        }
      ]
    })
  )
  writeFileSync(
    join(cfgDir, 'conversations.json'),
    JSON.stringify({
      version: 1,
      conversations: [
        {
          id: CONV_ID,
          projectId: 'e2e-project-1',
          title: 'e2e resumable conversation',
          tool: 'fake',
          agentSessionId,
          cwd: home,
          worktreePath: null,
          branch: null,
          autoTitle: false,
          lastActiveAt: now,
          createdAt: now,
          archivedAt: null
        }
      ]
    })
  )
}

// A REAL git repo for the review scenario: one commit, then a tracked edit and an
// untracked file left behind, which is exactly the state an agent leaves. The
// unit tests drive review-service with a fake GitRunner, so this is the only
// place the actual `git` integration is exercised.
export const REVIEW_TRACKED = 'tracked.txt'
export const REVIEW_UNTRACKED = 'untracked.txt'

function seedGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const git = (...args: string[]): void => {
    execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  }
  git('init', '-q')
  // Identity and hooks are set locally so the run never depends on, or touches,
  // the machine's global git config.
  git('config', 'user.email', 'e2e@example.invalid')
  git('config', 'user.name', 'e2e')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, REVIEW_TRACKED), 'one\ntwo\n')
  git('add', REVIEW_TRACKED)
  git('commit', '-q', '-m', 'seed')
  // The uncommitted work under review: one changed line, one new file.
  writeFileSync(join(dir, REVIEW_TRACKED), 'one\nCHANGED\n')
  writeFileSync(join(dir, REVIEW_UNTRACKED), 'brand new\n')
}

// scenario is the spec file's basename without extension, e.g. 'boot-launch'.
export function seedHome(scenario: string): string {
  const home = join(e2eDir, '.tmp', scenario)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  const cfgDir = writeCommon(home)

  if (scenario === 'boot-launch') {
    writeFileSync(
      join(cfgDir, 'schedules.json'),
      JSON.stringify({
        version: 1,
        schedules: [
          baseSchedule({
            target: {
              kind: 'launch',
              session: { mode: 'interactive', promptText: LAUNCH_PROMPT, tool: 'fake', folder: home }
            }
          })
        ]
      })
    )
  } else if (scenario === 'resume') {
    writeConversation(cfgDir, home, AGENT_SESSION_ID)
    writeFileSync(
      join(cfgDir, 'schedules.json'),
      JSON.stringify({
        version: 1,
        schedules: [
          baseSchedule({ prompt: RESUME_PROMPT, target: { kind: 'conversation', conversationId: CONV_ID } })
        ]
      })
    )
  } else if (scenario === 'skip') {
    writeConversation(cfgDir, home, null)
    writeFileSync(
      join(cfgDir, 'schedules.json'),
      JSON.stringify({
        version: 1,
        schedules: [baseSchedule({ target: { kind: 'conversation', conversationId: CONV_ID } })]
      })
    )
  } else if (scenario === 'review') {
    const repo = join(home, 'repo')
    seedGitRepo(repo)
    writeConversation(cfgDir, home, AGENT_SESSION_ID)
    // Point the seeded conversation at the git repo rather than at HOME, which
    // is not a repo. No schedules: this scenario only reads.
    const file = join(cfgDir, 'conversations.json')
    const doc = JSON.parse(readFileSync(file, 'utf8')) as {
      conversations: Record<string, unknown>[]
    }
    doc.conversations[0].cwd = repo
    // A second session pointing at a folder that is NOT a repo. This is the
    // reachable version of the failure case: the review list must report it as
    // unreadable rather than omitting it, which would read as "nothing changed".
    //
    // It has to live OUTSIDE the sandbox: e2e/.tmp/ sits inside the seniordev-app
    // checkout, so a folder there is genuinely inside a work tree and git answers
    // for the whole repo. (Worth knowing about the feature too: a session whose
    // cwd is a subdirectory of a repo reviews that entire repo, which is git's
    // behaviour and the right one, but it is not obvious.)
    const notRepo = join(tmpdir(), 'seniordev-e2e-not-a-repo')
    rmSync(notRepo, { recursive: true, force: true })
    mkdirSync(notRepo, { recursive: true })
    doc.conversations.push({
      ...doc.conversations[0],
      id: 'e2e-conversation-2',
      title: 'e2e non-repo conversation',
      cwd: notRepo
    })
    writeFileSync(file, JSON.stringify(doc))
  } else {
    throw new Error(`unknown e2e scenario: ${scenario}`)
  }
  return home
}
