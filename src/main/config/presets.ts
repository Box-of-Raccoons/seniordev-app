export const CLI_PRESETS = {
  claude: {
    command: 'claude',
    interactiveArgs: [],
    promptDelivery: 'stdin',
    headless: {
      // Verified against claude 2.1.191: stdin prompt + stream-json output;
      // session_id arrives in the system/init event.
      args: ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto'],
      outputParser: 'claude-stream-json'
    },
    resumeArgs: ['--resume', '{{sessionId}}']
  },
  codex: {
    command: 'codex',
    interactiveArgs: [],
    promptDelivery: 'arg',
    promptArg: '{{prompt}}',
    headless: {
      // '-' = read the prompt from stdin (developers.openai.com/codex/noninteractive).
      args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-'],
      outputParser: 'codex-jsonl'
    },
    resumeArgs: ['resume', '{{sessionId}}']
  }
} as const

export const DEFAULT_YOLO_PREAMBLE = `This is a headless, autonomous session — no human is watching to answer questions. Work the task to completion to the best of your ability. When you hit ambiguity, make the most reasonable assumption, note it in your final recap, and keep going. Do not stop to ask for confirmation or clarification; stop only when the task is done or you are genuinely blocked.`

export const DEFAULT_YOLO_RECAP = `When you are completely finished, end your final message with:
1. "## Changes made" — every file you changed and a one-line why.
2. "## Pull requests" — the URL of each PR/MR you created (one per project if this repo is a monorepo).`

export const DEFAULT_ORCHESTRATOR_PROMPT = `You are the Jira Orchestrator — a router that matches a Jira ticket to the best prebuilt playbook.

## Ticket

Key: {{ticket.key}}
Type: {{ticket.type}}
Status: {{ticket.status}}
Summary: {{ticket.summary}}

{{ticket.description}}

Acceptance criteria:
{{ticket.acceptanceCriteria}}

Comments:
{{ticket.comments}}

## Available playbooks

{{prompts.catalog}}

## Your task

Read the ticket and choose the single playbook best suited to work it. Do not execute the playbook, do not modify any files, and do not run any commands — this is a classification turn only.

Reply with ONLY a JSON object and no other text:
- {"prompt": "<playbook name>"} — the best match
- {"prompt": null, "reason": "<one line>"} — if no playbook fits`

export const FORGE_PRESETS = {
  github: {
    prCommand: 'gh pr create',
    term: 'PR',
    urlPattern: 'https://github\\.com/[^/]+/[^/]+/pull/\\d+'
  },
  gitlab: {
    prCommand: 'glab mr create',
    term: 'MR',
    urlPattern: 'https://gitlab\\.com/.+/-/merge_requests/\\d+'
  }
} as const
