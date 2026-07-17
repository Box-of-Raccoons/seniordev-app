export const CLI_PRESETS = {
  claude: {
    command: 'claude',
    interactiveArgs: [],
    promptDelivery: 'stdin',
    // claude takes `--model <id>`; the resolved model is substituted for {{model}}.
    modelArgs: ['--model', '{{model}}'],
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
    // codex's TUI submits on each embedded newline when a multi-line prompt is
    // typed in (the Windows .cmd shim forces arg->stdin downgrade). codex honors
    // bracketed paste, so wrap the typed prompt to keep it one composer block.
    bracketedPaste: true,
    // codex takes `-m/--model <id>`; the resolved model is substituted for {{model}}.
    modelArgs: ['--model', '{{model}}'],
    headless: {
      // '-' = read the prompt from stdin (developers.openai.com/codex/noninteractive).
      args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-'],
      outputParser: 'codex-jsonl'
    },
    resumeArgs: ['resume', '{{sessionId}}']
  }
} as const

export const DEFAULT_YOLO_PREAMBLE = `This is a headless, autonomous session with no human watching to answer questions. Work the task to completion to the best of your ability. When you hit ambiguity, make the most reasonable assumption, note it in your final recap, and keep going. Do not stop to ask for confirmation or clarification; stop only when the task is done or you are genuinely blocked.`

export const DEFAULT_YOLO_RECAP = `When you are completely finished, end your final message with:
1. "## Changes made": every file you changed and a one-line why.
2. "## Pull requests": the URL of each PR/MR you created (one per project if this repo is a monorepo).`

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
