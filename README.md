# SeniorDev

A cross-platform desktop workbench: a tabbed Jira ticket reader (left) and a tabbed interactive CLI-agent terminal multiplexer (right). Read a ticket, spin up a Claude Code / Codex session in the mapped repo, or "YOLO" a prebuilt prompt that ends in a PR.

## Configure

Copy `config.example.yaml` to your OS config dir and fill it in:

- Windows: `%APPDATA%\SeniorDev\config.yaml`
- macOS/Linux: `~/.config/SeniorDev/config.yaml`

Override the config path with the `SENIORDEV_CONFIG` environment variable.

Prompts default to a `prompts/` folder next to `config.yaml` (same dir), overridable via the `promptsDir` config key. One markdown file per prompt with `name`/`description` frontmatter and `{{ticket.*}}` / `{{forge.*}}` placeholders.

## Develop

```bash
pnpm install
pnpm dev          # launch the app (electron-vite)
pnpm test         # vitest
pnpm typecheck
```

> node-pty is native; on first run electron-builder/electron-rebuild aligns it to the Electron ABI.

## Command line

```
seniordev [tickets...] [--interactive] [--yolo <prompt>] [--prompt <text|@file>] [--tool <name>]
```

- `seniordev PROJ-123 PROJ-124` — open both tickets.
- `seniordev PROJ-123 --yolo fix-bug` — open the ticket and auto-run the `fix-bug` prompt with bypassed permissions.
- `--tool codex` — override the default CLI tool.

## Package

```bash
pnpm dist         # installers into release/ (per-OS: NSIS / dmg / AppImage)
pnpm dist:dir     # unpacked app dir
```
