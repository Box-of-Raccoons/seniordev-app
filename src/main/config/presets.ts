export const CLI_PRESETS = {
  claude: {
    command: 'claude',
    interactiveArgs: [],
    yoloArgs: ['--permission-mode', 'bypassPermissions'],
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
