# Product

## Register

product

## Users

Working software engineers, the people who read a Jira ticket and then do the
work. They live between an issue tracker and a terminal all day, are fluent in
CLI agents (Claude Code, Codex), git, and PRs, and expect a tool to keep up with
them rather than explain itself. Their context when using SeniorDev is active and
task-focused: they open the composer, decide how to work ("drive an interactive
session, drop into a raw terminal, or hand a role-based prompt off to run"), point
it at a folder, and give it a ticket key or a sentence of intent. Something is
usually running. They value speed, density, and trust over hand-holding. The
interface has to be legible at a glance and safe to leave running.

## Product Purpose

SeniorDev is a cross-platform desktop multiplexer for driving CLI coding agents:
a single-region, prompt-driven surface where every tab is a session you launched.
From a New-tab menu you pick what to open: an agent tool (Claude, and Codex once it
is installed) or a raw Terminal. The choice opens an inline composer as a new tab.
For an agent you pick a Folder and a Role (default `orchestrator`) drawn from a
config-driven prompt library, then type a smart input that is either a Jira ticket
key or a free-text description of the work; a YOLO checkbox flips the run to
auto-execute and open a PR. On Launch the composer tab morphs in place into the
live agent terminal. Terminal opens a raw shell (pwsh, cmd, bash, or wsl) in the
chosen folder.

SeniorDev does not read Jira itself. Given a ticket key it hands that key to the
agent, which reads the ticket through its own Atlassian MCP, so the app holds no
Jira credentials and never renders the issue. A deep-link trigger (`seniordev://`)
can prefill the composer from a Jira issue in one click; it never auto-runs, so
the developer always reviews and launches the work themselves.

It exists to make an engineer meaningfully more productive by turning routine
SDLC work into supervised, one-launch agent runs, without ever hiding what the
agent is doing. Success is when a developer trusts the tool enough to leave a YOLO
run going, glances back, and sees exactly what happened: the live log, the PR
cards, the recap. The multiplexer should feel like a capable colleague, not a
control panel.

## Brand Personality

**Capable, quietly confident, transparent.** SeniorDev carries itself like a
senior teammate: precise, unflashy, and trustworthy. It states what it's doing in
plain language, never guesses-and-runs (a deep link only prefills the composer; the
human always launches), and always shows its work. The "raccourier" raccoon mascot adds a note
of warmth and identity (a hard-hat-wearing courier who does the grunt work), but
it appears in moments (splash, about, empty states), never as decoration smeared
across the task surface. Voice is direct and low-ceremony: short labels, honest
error messages, no marketing gloss. The tool earns confidence by getting out of
the way.

## Anti-references

- **Generic SaaS dashboard.** No card grids, hero-metric tiles, gradient accents,
  or cloud-console blandness. This is a workbench, not an analytics product.
- **Consumer-cute / toy-like.** The mascot is warmth, not a theme. No
  rounded-everything, no over-mascoting, nothing that undercuts a serious dev tool.
- **Heavy IDE chrome.** No cluttered toolbars, deeply nested panels, or
  config-overload. Density is earned per task, never piled on for its own sake.
- **Flashy / over-animated.** No choreographed page loads, decorative motion, or
  glassmorphism. Motion conveys state (a running session, a composer morphing into
  its terminal, a splash handoff) and nothing else. Spectacle that slows the task
  is a bug.

## Design Principles

1. **Show the work, always.** Every autonomous action is visible and inspectable:
   live logs, tool one-liners, PR cards, structured recaps. Never hide what an
   agent is doing; the interface's job is legibility of machine work.
2. **Never guess-and-run.** The human launches every run: a deep link only
   prefills the composer, it never auto-runs. Safe, explicit defaults beat clever
   autonomy. The UI should make the safe path the obvious one.
3. **The tool disappears into the task.** Earned familiarity over novelty:
   standard affordances, consistent component vocabulary, density where the work
   needs it and calm everywhere else. A developer fluent in Linear/Raycast/a good
   terminal should trust it on sight.
4. **Warmth in moments, not everywhere.** Personality (the raccoon, the palette's
   warmth) lives in deliberate touchpoints (splash, empty states, about) and
   stays out of the working surface, where clarity wins.
5. **Respect the developer's flow.** Fast transitions (150-250ms), keyboard-first
   where it matters, non-destructive by default (prompt seeding, config saves, and
   session resets never clobber running work without asking).

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text meets 4.5:1 contrast against its surface (the
dark warm-charcoal palette must be checked at every accent, including muted ink on
tinted surfaces); large/bold text meets 3:1. Every interactive element has a
visible focus state and is reachable and operable by keyboard: the app is a power
tool for people who live on the keyboard. Honor `prefers-reduced-motion` on every
animation (the composer-to-terminal transition and the splash handoff) with a
crossfade or instant fallback. State is never conveyed by color alone (a running
vs. finished session, an error vs. success line); pair it with text, icon, or
shape.
