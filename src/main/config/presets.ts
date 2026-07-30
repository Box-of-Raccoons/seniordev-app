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
    resumeArgs: ['--resume', '{{sessionId}}'],
    // S3 pre-assign: claude 2.1.212 accepts `--session-id <uuid>` to fix the
    // conversation id at spawn (verified this machine 2026-07-30). SeniorDev passes
    // the tab's conversationId here, so the session id is known before any output —
    // no post-hoc scrape, and interactive + headless share one path. codex has no
    // equivalent flag, so it carries no sessionIdArgs and is discovered instead.
    sessionIdArgs: ['--session-id', '{{sessionId}}'],
    // An approval prompt's selection menu: the cursor glyph, a NUMBERED option, a
    // word. Validated 2026-07-29 against captured claude 2.1.212 prompts (❯ U+276F)
    // and codex 0.146.0 (› U+203A). The numbered-option requirement is what keeps
    // it off slash-command menus like /mcp, which use the same cursor but list
    // names ("❯ claude.ai Gmail") with no "N." Structure by Hardy; chars from capture.
    approvalPatterns: ['[❯›]\\s+\\d+\\.\\s+\\w']
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
    resumeArgs: ['resume', '{{sessionId}}'],
    // Same tool-agnostic selection-menu pattern as claude (see there). Codex's
    // cursor glyph is › (U+203A); the pattern's char class covers both.
    approvalPatterns: ['[❯›]\\s+\\d+\\.\\s+\\w']
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
