// Per-scenario sandbox builder. Each spec file gets a fresh HOME containing the
// app's whole config-dir surface: config.yaml with only the fake tool, plus the
// stores that stage the scenario. Records are written in the stores' persisted
// doc shapes (see src/main/store/*, src/main/schedule/schedules-store.ts).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  } else {
    throw new Error(`unknown e2e scenario: ${scenario}`)
  }
  return home
}
