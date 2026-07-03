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

export const DEFAULT_YOLO_RECAP = `When you are completely finished, end your final message with:
1. "## Changes made" — every file you changed and a one-line why.
2. "## Pull requests" — the URL of each PR/MR you created (one per project if this repo is a monorepo).`

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
