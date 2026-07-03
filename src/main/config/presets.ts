export const CLI_PRESETS = {
  claude: {
    command: 'claude',
    interactiveArgs: [],
    // 'auto' eliminates permission prompts via a background safety classifier and
    // starts straight into an interactive session — unlike 'bypassPermissions',
    // which can present a one-time acceptance screen that a piped launcher trips.
    // Override per-tool in config.yaml if you want a different YOLO posture.
    yoloArgs: ['--permission-mode', 'auto'],
    promptDelivery: 'stdin'
  },
  codex: {
    command: 'codex',
    interactiveArgs: [],
    yoloArgs: ['--yolo'],
    promptDelivery: 'arg',
    promptArg: '{{prompt}}'
  }
} as const

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
