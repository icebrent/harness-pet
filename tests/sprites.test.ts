import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const characterIds = ['deepseek-blue', 'claude-orange', 'gpt-white']
const displayNames = ['deepseek', 'claude', 'gpt']
const names = ['idle', 'happy', 'greet', 'think', 'walk-1', 'walk-2', 'back-1', 'back-2', 'sleep']

interface SpriteManifest {
  characterId: string
  displayName: string
  source: string
  canvas: { width: number; height: number }
  anchor: { x: number; y: number; kind: string }
  normalization: {
    referenceCharacterId: string
    referenceIdleBodyHeight: number
    idleBodyHeight: number
    scale: number
  }
  states: Record<string, { file: string }>
  sprites: Array<{ name: string; file: string }>
}

describe('character pack sprites', () => {
  it.each(characterIds)('%s has a complete manifest and nine matching sprite canvases', async (characterId) => {
    const root = resolve(import.meta.dirname, '..')
    const packDir = resolve(root, 'assets', 'characters', characterId)
    const manifest = JSON.parse(await readFile(resolve(packDir, 'sprites', 'manifest.json'), 'utf8')) as SpriteManifest

    expect(manifest.characterId).toBe(characterId)
    expect(manifest.displayName).toBe(displayNames[characterIds.indexOf(characterId)])
    expect(manifest.anchor.kind).toBe('foot-center')
    expect(manifest.anchor.x).toBeGreaterThanOrEqual(0)
    expect(manifest.anchor.x).toBeLessThan(manifest.canvas.width)
    expect(manifest.anchor.y).toBeGreaterThanOrEqual(0)
    expect(manifest.anchor.y).toBeLessThan(manifest.canvas.height)
    expect(manifest.normalization.referenceCharacterId).toBe('deepseek-blue')
    expect(manifest.normalization.referenceIdleBodyHeight).toBeGreaterThan(0)
    expect(manifest.normalization.idleBodyHeight).toBeGreaterThan(0)
    expect(manifest.normalization.scale).toBeGreaterThan(0)
    expect(Math.abs(
      manifest.normalization.idleBodyHeight * manifest.normalization.scale
        - manifest.normalization.referenceIdleBodyHeight,
    )).toBeLessThanOrEqual(1)
    expect(manifest.sprites.map(sprite => sprite.name)).toEqual(names)
    expect(Object.keys(manifest.states)).toEqual(names)
    await access(resolve(packDir, manifest.source))

    for (const name of names) {
      expect(manifest.states[name]?.file).toBe(`${name}.png`)
      const spritePath = resolve(packDir, 'sprites', `${name}.png`)
      await access(spritePath)
      const metadata = await sharp(spritePath).metadata()
      expect(metadata.width).toBe(manifest.canvas.width)
      expect(metadata.height).toBe(manifest.canvas.height)
      expect(metadata.hasAlpha).toBe(true)
      const { data, info } = await sharp(spritePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let left = info.width
      let top = info.height
      let right = -1
      let bottom = -1
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          if (data[(y * info.width + x) * 4 + 3]! === 0) continue
          left = Math.min(left, x)
          top = Math.min(top, y)
          right = Math.max(right, x)
          bottom = Math.max(bottom, y)
        }
      }
      expect(left).toBeGreaterThanOrEqual(10)
      expect(top).toBeGreaterThanOrEqual(10)
      expect(right).toBeLessThanOrEqual(info.width - 11)
      expect(bottom).toBeLessThanOrEqual(info.height - 11)
    }
  })

  it('uses shared canvas geometry across character packs', async () => {
    const root = resolve(import.meta.dirname, '..')
    const manifests = await Promise.all(characterIds.map(async characterId => JSON.parse(
      await readFile(resolve(root, 'assets', 'characters', characterId, 'sprites', 'manifest.json'), 'utf8'),
    ) as SpriteManifest))
    expect(new Set(manifests.map(manifest => JSON.stringify(manifest.canvas))).size).toBe(1)
    expect(new Set(manifests.map(manifest => JSON.stringify(manifest.anchor))).size).toBe(1)
  })
})
