import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const names = ['idle', 'happy', 'greet', 'think', 'walk-1', 'walk-2', 'back-1', 'back-2', 'sleep']

describe('processed sprites', () => {
  it('share one transparent canvas and foot anchor', async () => {
    const root = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(await readFile(resolve(root, 'assets/sprites/manifest.json'), 'utf8')) as {
      canvas: { width: number; height: number }
      anchor: { x: number; y: number; kind: string }
      sprites: unknown[]
    }
    expect(manifest.anchor.kind).toBe('foot-center')
    expect(manifest.sprites).toHaveLength(9)

    for (const name of names) {
      const metadata = await sharp(resolve(root, `assets/sprites/${name}.png`)).metadata()
      expect(metadata.width).toBe(manifest.canvas.width)
      expect(metadata.height).toBe(manifest.canvas.height)
      expect(metadata.hasAlpha).toBe(true)
    }
  })
})
