import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

// v0.5.3 shipped a latest-mac.yml pointing at a zip the release did not carry:
// electron-builder built it, but the workflow's upload and publish globs listed
// only exe/dmg/yml, so auto-update would have fetched a 404. The run was green
// throughout — nothing else notices a feed that references a missing file.
//
// These assertions tie the two together: whatever mac targets electron-builder is
// configured to produce, the workflow must carry them to the Release.
describe('release workflow publishes everything the update feed references', () => {
  const wf = parse(readFileSync(resolve('.github/workflows/release.yml'), 'utf8')) as {
    jobs: Record<string, { steps: { name?: string; with?: { path?: string; files?: string } }[] }>
  }
  const builder = parse(readFileSync(resolve('electron-builder.yml'), 'utf8')) as {
    mac?: { target?: string[] }
  }

  const steps = Object.values(wf.jobs).flatMap((j) => j.steps)
  const uploadGlobs = steps.find((s) => s.name === 'Upload installer artifacts')?.with?.path ?? ''
  const publishGlobs = steps.find((s) => s.name === 'Publish to GitHub Release')?.with?.files ?? ''

  it('finds both the artifact upload and the release publish steps', () => {
    expect(uploadGlobs).not.toBe('')
    expect(publishGlobs).not.toBe('')
  })

  it.each([
    ['upload', () => uploadGlobs],
    ['publish', () => publishGlobs]
  ])('the %s step carries every configured mac target plus the feed', (_label, globs) => {
    const text = globs()
    for (const target of builder.mac?.target ?? []) {
      expect(text).toContain(`*.${target}`)
    }
    expect(text).toContain('latest*.yml')
  })
})
