import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseDisplayMode, randomMovementEnabled } from '../src/shared/display-mode.js'

describe('display mode', () => {
  it.each([
    { argv: ['electron', 'app'], expected: 'chibi' },
    { argv: ['electron', 'app', '--mode=chibi'], expected: 'chibi' },
    { argv: ['electron', 'app', '--mode=kanban'], expected: 'kanban' },
    { argv: ['electron', 'app', '--mode', 'kanban'], expected: 'kanban' },
  ] as const)('parses $argv as $expected', ({ argv, expected }) => {
    expect(parseDisplayMode(argv)).toBe(expected)
  })

  it('warns and falls back safely for an unknown mode', () => {
    const warn = vi.fn()
    expect(parseDisplayMode(['electron', 'app', '--mode=live2d'], warn)).toBe('chibi')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown display mode 'live2d'"))
  })

  it('only enables random desktop movement in chibi mode', () => {
    expect(randomMovementEnabled('chibi')).toBe(true)
    expect(randomMovementEnabled('kanban')).toBe(false)
  })

  it('keeps a forwarding separator in the pnpm dev script', async () => {
    const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      scripts: { dev: string }
    }
    expect(packageJson.scripts.dev).toBe('electron-vite dev --')
  })
})
