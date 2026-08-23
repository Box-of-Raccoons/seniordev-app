// A stand-in agent CLI: enough TUI behaviour for prompt delivery to work against
// a real pty. It prints a banner (delivery's readiness watch needs output before
// quiet), then logs every stdin chunk to $HOME/fake-cli.log so a spec can assert
// what actually reached the session — argv (resume flags) and typed prompts.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const log = join(process.env.HOME ?? '.', 'fake-cli.log')
const record = (ev, data) => appendFileSync(log, JSON.stringify({ ev, data, at: Date.now() }) + '\n')

record('spawn', process.argv.slice(2))
process.stdout.write('fake-cli ready\n')
process.stdin.on('data', (d) => record('stdin', d.toString()))
