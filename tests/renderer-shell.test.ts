import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer shell', () => {
  it('keeps character switching out of the persistent pet UI', async () => {
    const root = resolve(import.meta.dirname, '..')
    const [html, script, styles] = await Promise.all([
      readFile(resolve(root, 'src/renderer/index.html'), 'utf8'),
      readFile(resolve(root, 'src/renderer/main.ts'), 'utf8'),
      readFile(resolve(root, 'src/renderer/styles.css'), 'utf8'),
    ])

    expect(html).not.toContain('character-select')
    expect(script).not.toContain('characterSelect')
    expect(styles).not.toContain('.character-picker')
  })
})
