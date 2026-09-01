import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

const SPRITE_NAMES = [
  'idle', 'happy', 'greet',
  'think', 'walk-1', 'walk-2',
  'back-1', 'back-2', 'sleep',
] as const

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface PreparedSprite {
  name: typeof SPRITE_NAMES[number]
  buffer: Buffer
  width: number
  height: number
  anchorX: number
  anchorY: number
  sourceCell: { row: number; column: number; left: number; top: number; width: number; height: number }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function findSource(sourceDir: string): Promise<string> {
  const explicit = argValue('--input')
  if (explicit) return resolve(explicit)
  const preferred = join(sourceDir, 'deepseek-girl-poses.png')
  const files = (await readdir(sourceDir)).filter(file => file.toLowerCase().endsWith('.png')).sort()
  if (files.includes('deepseek-girl-poses.png')) return preferred
  if (files.length === 1) return join(sourceDir, files[0]!)
  throw new Error(`Expected assets/source/deepseek-girl-poses.png or exactly one PNG in ${sourceDir}.`)
}

function alphaBounds(data: Buffer, width: number, height: number): Bounds {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) throw new Error('A sprite cell is fully transparent.')
  return { left, top, right, bottom }
}

function footAnchor(data: Buffer, width: number, bounds: Bounds): { x: number; y: number } {
  // Use the lower body rather than only the final scanlines. A lifted foot can
  // end a few pixels above the other one, while detached symbols live higher
  // in the cell; the lower 35% gives a stable support silhouette for both.
  const bandTop = bounds.top + Math.floor((bounds.bottom - bounds.top + 1) * 0.65)
  let left = bounds.right
  let right = bounds.left
  for (let y = bandTop; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      if (data[(y * width + x) * 4 + 3]! < 24) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }
  const x = right >= left ? Math.round((left + right) / 2) : Math.round((bounds.left + bounds.right) / 2)
  return { x, y: bounds.bottom }
}

async function main(): Promise<void> {
  const projectRoot = resolve(import.meta.dirname, '..')
  const sourceDir = join(projectRoot, 'assets', 'source')
  const outputDir = resolve(argValue('--output') ?? join(projectRoot, 'assets', 'sprites'))
  const input = await findSource(sourceDir)
  const metadata = await sharp(input).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read image dimensions: ${input}`)

  const prepared: PreparedSprite[] = []
  for (let index = 0; index < SPRITE_NAMES.length; index += 1) {
    const row = Math.floor(index / 3)
    const column = index % 3
    const left = Math.round(column * metadata.width / 3)
    const right = Math.round((column + 1) * metadata.width / 3)
    const top = Math.round(row * metadata.height / 3)
    const bottom = Math.round((row + 1) * metadata.height / 3)
    const cellWidth = right - left
    const cellHeight = bottom - top
    const { data, info } = await sharp(input)
      .extract({ left, top, width: cellWidth, height: cellHeight })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const bounds = alphaBounds(data, info.width, info.height)
    const anchor = footAnchor(data, info.width, bounds)
    const width = bounds.right - bounds.left + 1
    const height = bounds.bottom - bounds.top + 1
    const buffer = await sharp(data, { raw: info })
      .extract({ left: bounds.left, top: bounds.top, width, height })
      .png()
      .toBuffer()
    prepared.push({
      name: SPRITE_NAMES[index]!,
      buffer,
      width,
      height,
      anchorX: anchor.x - bounds.left,
      anchorY: anchor.y - bounds.top,
      sourceCell: { row, column, left, top, width: cellWidth, height: cellHeight },
    })
  }

  const padding = 12
  const leftExtent = Math.max(...prepared.map(sprite => sprite.anchorX))
  const rightExtent = Math.max(...prepared.map(sprite => sprite.width - 1 - sprite.anchorX))
  const topExtent = Math.max(...prepared.map(sprite => sprite.anchorY))
  const bottomExtent = Math.max(...prepared.map(sprite => sprite.height - 1 - sprite.anchorY))
  const anchor = { x: padding + leftExtent, y: padding + topExtent }
  const canvas = {
    width: padding * 2 + leftExtent + rightExtent + 1,
    height: padding * 2 + topExtent + bottomExtent + 1,
  }

  await mkdir(outputDir, { recursive: true })
  for (const sprite of prepared) {
    await sharp({
      create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: sprite.buffer, left: anchor.x - sprite.anchorX, top: anchor.y - sprite.anchorY }])
      .png()
      .toFile(join(outputDir, `${sprite.name}.png`))
  }

  const manifest = {
    source: basename(input),
    sourceSize: { width: metadata.width, height: metadata.height },
    grid: { columns: 3, rows: 3 },
    canvas,
    anchor: { ...anchor, kind: 'foot-center' },
    sprites: prepared.map(sprite => ({
      name: sprite.name,
      sourceCell: sprite.sourceCell,
      trimmedSize: { width: sprite.width, height: sprite.height },
      trimmedAnchor: { x: sprite.anchorX, y: sprite.anchorY },
    })),
  }
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Processed ${prepared.length} sprites from ${input}`)
  console.log(`Canvas ${canvas.width}x${canvas.height}, anchor (${anchor.x}, ${anchor.y})`)
}

await main()
