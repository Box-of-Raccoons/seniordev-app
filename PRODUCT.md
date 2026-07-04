# Product

## Register

product

## Users

Working software engineers — the people who read a Jira ticket and then do the
work. They live between an issue tracker and a terminal all day, are fluent in
CLI agents (Claude Code, Codex), git, and PRs, and expect a tool to keep up with
them rather than explain itself. Their context when using SeniorDev is active and
task-focused: a ticket is open, a decision is being made ("read it myself, drive
an interactive session, or YOLO a prebuilt playbook"), and something is usually
running. They value speed, density, and trust over hand-holding. A secondary mode
is unattended: SeniorDevWatch dispatches work from a system tray while the user is
elsewhere, so the interface also has to be legible at a glance and safe to leave
running.

## Product Purpose

SeniorDev is a cross-platform desktop workbench that collapses the ticket → agent
→ PR loop into one window: a tabbed Jira ticket reader on the left, a tabbed
interactive CLI-agent terminal multiplexer on the right. From an open ticket a
developer can read it, spin up a Claude Code / Codex session in the mapped repo,
or "YOLO" a prebuilt role-based prompt (BA, tech-lead, developer, QA, reviewer,
docs) that runs the agent headless and ends in a PR. A Jira Orchestrator classifies
a ticket against the prompt library and runs the right playbook; a background tray
poller can watch for labeled work and dispatch it into a visible, watchable tab.

It exists to make an engineer meaningfully more productive by turning routine
SDLC work into supervised, one-click agent runs — without ever hiding what the
agent is doing. Success is when a developer trusts the tool enough to leave a YOLO
run going, glances back, and sees exactly what happened: the live log, the PR
cards, the recap. The workbench should feel like a capable colleague, not a
control panel.

## Brand Personality

**Capable, quietly confident, transparent.** SeniorDev carries itself like a
senior teammate: precise, unflashy, and trustworthy. It states what it's doing in
plain language, never guesses-and-runs (the orchestrator refuses rather than
inventing a playbook), and always shows its work. The "raccourier" raccoon mascot
adds a note of warmth and identity — a hard-hat-wearing courier who does the
grunt work — but it appears in moments (splash, about, empty states, tray icon),
never as decoration smeared across the task surface. Voice is direct and
low-ceremony: short labels, honest error messages, no marketing gloss. The tool
earns confidence by getting out of the way.

## Anti-references

- **Generic SaaS dashboard.** No card grids, hero-metric tiles, gradient accents,
  or cloud-console blandness. This is a workbench, not an analytics product.
- **Consumer-cute / toy-like.** The mascot is warmth, not a theme. No
  rounded-everything, no over-mascoting, nothing that undercuts a serious dev tool.
- **Heavy IDE chrome.** No cluttered toolbars, deeply nested panels, or
  config-overload. Density is earned per task, never piled on for its own sake.
- **Flashy / over-animated.** No choreographed page loads, decorative motion, or
  glassmorphism. Motion conveys state (a running session, a resize seam, a splash
  handoff) and nothing else. Spectacle that slows the task is a bug.

## Design Principles

1. **Show the work, always.** Every autonomous action is visible and inspectable —
   live logs, tool one-liners, PR cards, structured recaps. Never hide what an
   agent is doing; the interface's job is legibility of machine work.
2. **Never guess-and-run.** When intent is ambiguous, confirm (the deep-link YOLO
   gate) or refuse with a reason (the orchestrator on a bad classify). Safe,
   explicit defaults beat clever autonomy. The UI should make the safe path the
   obvious one.
3. **The tool disappears into the task.** Earned familiarity over novelty:
   standard affordances, consistent component vocabulary, density where the work
   needs it and calm everywhere else. A developer fluent in Linear/Raycast/a good
   terminal should trust it on sight.
4. **Warmth in moments, not everywhere.** Personality (the raccoon, the palette's
   warmth) lives in deliberate touchpoints — splash, empty states, about — and
   stays out of the working surface, where clarity wins.
5. **Respect the developer's flow.** Fast transitions (150–250ms), keyboard-first
   where it matters, non-destructive by default (prompt seeding, config saves, and
   session resets never clobber running work without asking).

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text meets 4.5:1 contrast against its surface (the
dark warm-charcoal palette must be checked at every accent, including muted ink on
tinted surfaces); large/bold text meets 3:1. Every interactive element has a
visible focus state and is reachable and operable by keyboard — the app is a power
tool for people who live on the keyboard. Honor `prefers-reduced-motion` on every
animation (already done on the resize seam and splash) with a crossfade or instant
fallback. State is never conveyed by color alone (a running vs. finished session,
an error vs. success line) — pair it with text, icon, or shape.
