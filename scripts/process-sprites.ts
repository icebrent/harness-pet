import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

const SPRITE_NAMES = [
  'idle', 'happy', 'greet',
  'think', 'walk-1', 'walk-2',
  'back-1', 'back-2', 'sleep',
] as const

const CHARACTERS = [
  { id: 'deepseek-blue', displayName: 'deepseek' },
  { id: 'claude-orange', displayName: 'claude' },
  { id: 'gpt-white', displayName: 'gpt' },
] as const

const REFERENCE_CHARACTER_ID = 'deepseek-blue'
const PADDING = 12
const LEGACY_CANVAS = { width: 637, height: 386, anchorX: 335, anchorY: 373 }
const ALPHA_THRESHOLD = 24
const COMPONENT_ALPHA_THRESHOLD = 24
const MIN_DETACHED_PIXELS = 48

type SpriteName = typeof SPRITE_NAMES[number]
type CharacterConfig = typeof CHARACTERS[number]

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface RawSprite {
  name: SpriteName
  data: Buffer
  width: number
  height: number
  bounds: Bounds
  bodyBounds: Bounds
  bodyMask: Uint8Array
  sourceCell: { row: number; column: number; left: number; top: number; width: number; height: number }
}

interface AlphaComponent {
  bounds: Bounds
  pixels: number[]
  centroid: { x: number; y: number }
  opaquePixels: number
}

interface CharacterSource {
  config: CharacterConfig
  input: string
  sourceSize: { width: number; height: number }
  sprites: RawSprite[]
  idleBodyHeight: number
  scale: number
}

interface PreparedSprite {
  name: SpriteName
  buffer: Buffer
  width: number
  height: number
  anchorX: number
  anchorY: number
  sourceCell: RawSprite['sourceCell']
  sourceBounds: Bounds
  sourceBodyBounds: Bounds
}

interface PreparedCharacter {
  source: CharacterSource
  sprites: PreparedSprite[]
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function alphaBounds(data: Buffer, width: number, height: number, threshold = 0): Bounds {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! <= threshold) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) throw new Error('A sprite cell is fully transparent.')
  return { left, top, right, bottom }
}

function alphaComponents(data: Buffer, width: number, height: number): AlphaComponent[] {
  const visible = new Uint8Array(width * height)
  for (let index = 0; index < visible.length; index += 1) {
    visible[index] = data[index * 4 + 3]! >= COMPONENT_ALPHA_THRESHOLD ? 1 : 0
  }

  const visited = new Uint8Array(visible.length)
  const queue = new Int32Array(visible.length)
  const components: AlphaComponent[] = []

  for (let start = 0; start < visible.length; start += 1) {
    if (!visible[start] || visited[start]) continue
    let head = 0
    let tail = 0
    const pixels: number[] = []
    queue[tail++] = start
    visited[start] = 1
    while (head < tail) {
      const index = queue[head++]!
      pixels.push(index)
      const x = index % width
      const y = Math.floor(index / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nextX = x + dx
          const nextY = y + dy
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
          const next = nextY * width + nextX
          if (!visible[next] || visited[next]) continue
          visited[next] = 1
          queue[tail++] = next
        }
      }
    }
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    let sumX = 0
    let sumY = 0
    let opaquePixels = 0
    for (const index of pixels) {
      const x = index % width
      const y = Math.floor(index / width)
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
      sumX += x
      sumY += y
      if (data[index * 4 + 3]! >= ALPHA_THRESHOLD) opaquePixels += 1
    }
    components.push({
      bounds: { left, top, right, bottom },
      pixels,
      centroid: { x: sumX / pixels.length, y: sumY / pixels.length },
      opaquePixels,
    })
  }
  return components.sort((a, b) => b.pixels.length - a.pixels.length)
}

function cleanCell(
  data: Buffer,
  width: number,
  height: number,
  components: AlphaComponent[],
): { data: Buffer; bounds: Bounds; bodyBounds: Bounds; bodyMask: Uint8Array } {
  const body = components[0]
  if (!body) throw new Error('A sprite cell has no visible main component.')
  const minDetachedPixels = Math.max(MIN_DETACHED_PIXELS, Math.round(body.pixels.length * 0.001))
  const kept = components.filter((component, index) => index === 0 || component.pixels.length >= minDetachedPixels)

  const cleaned = Buffer.from(data)
  const keepMask = new Uint8Array(width * height)
  let frontier: number[] = []
  for (const component of kept) {
    for (const index of component.pixels) {
      keepMask[index] = 1
      frontier.push(index)
    }
  }
  for (let step = 0; step < 2; step += 1) {
    const nextFrontier: number[] = []
    for (const index of frontier) {
      const x = index % width
      const y = Math.floor(index / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextX = x + dx
          const nextY = y + dy
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
          const next = nextY * width + nextX
          if (keepMask[next] || data[next * 4 + 3]! === 0) continue
          keepMask[next] = 1
          nextFrontier.push(next)
        }
      }
    }
    frontier = nextFrontier
  }
  for (let index = 0; index < keepMask.length; index += 1) {
    if (keepMask[index]) continue
    cleaned[index * 4] = 0
    cleaned[index * 4 + 1] = 0
    cleaned[index * 4 + 2] = 0
    cleaned[index * 4 + 3] = 0
  }

  const mask = new Uint8Array(width * height)
  let bodyLeft = width
  let bodyTop = height
  let bodyRight = -1
  let bodyBottom = -1
  for (const index of body.pixels) {
    if (cleaned[index * 4 + 3]! < ALPHA_THRESHOLD) continue
    mask[index] = 1
    const x = index % width
    const y = Math.floor(index / width)
    bodyLeft = Math.min(bodyLeft, x)
    bodyTop = Math.min(bodyTop, y)
    bodyRight = Math.max(bodyRight, x)
    bodyBottom = Math.max(bodyBottom, y)
  }
  if (bodyRight < bodyLeft || bodyBottom < bodyTop) throw new Error('A sprite body has no opaque pixels.')
  return {
    data: cleaned,
    bounds: alphaBounds(cleaned, width, height),
    bodyBounds: { left: bodyLeft, top: bodyTop, right: bodyRight, bottom: bodyBottom },
    bodyMask: mask,
  }
}

function footAnchor(sprite: RawSprite): { x: number; y: number } {
  const bodyHeight = sprite.bodyBounds.bottom - sprite.bodyBounds.top + 1
  const bandTop = sprite.bodyBounds.top + Math.floor(bodyHeight * 0.65)
  let left = sprite.bodyBounds.right
  let right = sprite.bodyBounds.left
  for (let y = bandTop; y <= sprite.bodyBounds.bottom; y += 1) {
    for (let x = sprite.bodyBounds.left; x <= sprite.bodyBounds.right; x += 1) {
      if (!sprite.bodyMask[y * sprite.width + x]) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }
  const x = right >= left
    ? Math.round((left + right) / 2)
    : Math.round((sprite.bodyBounds.left + sprite.bodyBounds.right) / 2)
  return { x, y: sprite.bodyBounds.bottom }
}

async function readCharacter(projectRoot: string, config: CharacterConfig): Promise<CharacterSource> {
  const input = join(projectRoot, 'assets', 'characters', config.id, 'source', 'poses.png')
  const metadata = await sharp(input).metadata()
  if (!metadata.width || !metadata.height) throw new Error(`Cannot read image dimensions: ${input}`)

  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const assigned = Array.from({ length: SPRITE_NAMES.length }, () => [] as AlphaComponent[])
  for (const component of alphaComponents(data, info.width, info.height)) {
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < SPRITE_NAMES.length; index += 1) {
      const row = Math.floor(index / 3)
      const column = index % 3
      const centerX = (column + 0.5) * info.width / 3
      const centerY = (row + 0.5) * info.height / 3
      const distance = (component.centroid.x - centerX) ** 2 + (component.centroid.y - centerY) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    assigned[bestIndex]!.push(component)
  }

  const sprites: RawSprite[] = []
  for (let index = 0; index < SPRITE_NAMES.length; index += 1) {
    const row = Math.floor(index / 3)
    const column = index % 3
    const left = Math.round(column * metadata.width / 3)
    const right = Math.round((column + 1) * metadata.width / 3)
    const top = Math.round(row * metadata.height / 3)
    const bottom = Math.round((row + 1) * metadata.height / 3)
    const cellWidth = right - left
    const cellHeight = bottom - top
    const cellComponents = assigned[index]!.sort((a, b) => b.opaquePixels - a.opaquePixels)
    const cleaned = cleanCell(data, info.width, info.height, cellComponents)
    sprites.push({
      name: SPRITE_NAMES[index]!,
      data: cleaned.data,
      width: info.width,
      height: info.height,
      bounds: cleaned.bounds,
      bodyBounds: cleaned.bodyBounds,
      bodyMask: cleaned.bodyMask,
      sourceCell: { row, column, left, top, width: cellWidth, height: cellHeight },
    })
  }

  const idle = sprites[0]!
  return {
    config,
    input,
    sourceSize: { width: metadata.width, height: metadata.height },
    sprites,
    idleBodyHeight: idle.bodyBounds.bottom - idle.bodyBounds.top + 1,
    scale: 1,
  }
}

async function prepareCharacter(source: CharacterSource): Promise<PreparedCharacter> {
  const sprites: PreparedSprite[] = []
  for (const sprite of source.sprites) {
    const anchor = footAnchor(sprite)
    const sourceWidth = sprite.bounds.right - sprite.bounds.left + 1
    const sourceHeight = sprite.bounds.bottom - sprite.bounds.top + 1
    const width = Math.max(1, Math.round(sourceWidth * source.scale))
    const height = Math.max(1, Math.round(sourceHeight * source.scale))
    const cropped = sharp(sprite.data, { raw: { width: sprite.width, height: sprite.height, channels: 4 } })
      .extract({ left: sprite.bounds.left, top: sprite.bounds.top, width: sourceWidth, height: sourceHeight })
    const buffer = source.scale === 1
      ? await cropped.png().toBuffer()
      : await cropped.resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 }).png().toBuffer()
    sprites.push({
      name: sprite.name,
      buffer,
      width,
      height,
      anchorX: Math.round((anchor.x - sprite.bounds.left) * source.scale),
      anchorY: Math.round((anchor.y - sprite.bounds.top) * source.scale),
      sourceCell: sprite.sourceCell,
      sourceBounds: sprite.bounds,
      sourceBodyBounds: sprite.bodyBounds,
    })
  }
  return { source, sprites }
}

function sharedCanvas(characters: PreparedCharacter[]): { canvas: { width: number; height: number }; anchor: { x: number; y: number } } {
  const sprites = characters.flatMap(character => character.sprites)
  const leftExtent = Math.max(...sprites.map(sprite => sprite.anchorX))
  const rightExtent = Math.max(...sprites.map(sprite => sprite.width - 1 - sprite.anchorX))
  const topExtent = Math.max(...sprites.map(sprite => sprite.anchorY))
  const bottomExtent = Math.max(...sprites.map(sprite => sprite.height - 1 - sprite.anchorY))
  const anchor = {
    x: Math.max(LEGACY_CANVAS.anchorX, PADDING + leftExtent),
    y: Math.max(LEGACY_CANVAS.anchorY, PADDING + topExtent),
  }
  return {
    anchor,
    canvas: {
      width: Math.max(LEGACY_CANVAS.width, anchor.x + rightExtent + PADDING + 1),
      height: Math.max(LEGACY_CANVAS.height, anchor.y + bottomExtent + PADDING + 1),
    },
  }
}

async function writeCharacter(
  projectRoot: string,
  character: PreparedCharacter,
  canvas: { width: number; height: number },
  anchor: { x: number; y: number },
  referenceIdleBodyHeight: number,
): Promise<void> {
  const outputDir = join(projectRoot, 'assets', 'characters', character.source.config.id, 'sprites')
  await mkdir(outputDir, { recursive: true })
  for (const sprite of character.sprites) {
    await sharp({
      create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: sprite.buffer, left: anchor.x - sprite.anchorX, top: anchor.y - sprite.anchorY }])
      .png()
      .toFile(join(outputDir, `${sprite.name}.png`))
  }

  const states = Object.fromEntries(character.sprites.map(sprite => [sprite.name, {
    file: `${sprite.name}.png`,
    sourceCell: sprite.sourceCell,
    sourceBounds: sprite.sourceBounds,
    sourceBodyBounds: sprite.sourceBodyBounds,
    normalizedSize: { width: sprite.width, height: sprite.height },
    normalizedAnchor: { x: sprite.anchorX, y: sprite.anchorY },
  }]))
  const manifest = {
    characterId: character.source.config.id,
    displayName: character.source.config.displayName,
    source: relative(join(projectRoot, 'assets', 'characters', character.source.config.id), character.source.input).replaceAll('\\', '/'),
    sourceSize: character.source.sourceSize,
    grid: { columns: 3, rows: 3 },
    canvas,
    anchor: { ...anchor, kind: 'foot-center' },
    normalization: {
      referenceCharacterId: REFERENCE_CHARACTER_ID,
      referenceIdleBodyHeight,
      idleBodyHeight: character.source.idleBodyHeight,
      scale: character.source.scale,
      basis: 'largest-alpha-component-of-idle',
    },
    states,
    sprites: character.sprites.map(sprite => ({ name: sprite.name, file: `${sprite.name}.png` })),
  }
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const projectRoot = resolve(import.meta.dirname, '..')
  const requestedId = argValue('--character')
  if (requestedId && !CHARACTERS.some(character => character.id === requestedId)) {
    throw new Error(`Unknown character '${requestedId}'. Expected one of: ${CHARACTERS.map(character => character.id).join(', ')}`)
  }

  const sources = await Promise.all(CHARACTERS.map(character => readCharacter(projectRoot, character)))
  const reference = sources.find(character => character.config.id === REFERENCE_CHARACTER_ID)!
  for (const source of sources) source.scale = reference.idleBodyHeight / source.idleBodyHeight
  const prepared = await Promise.all(sources.map(prepareCharacter))
  const geometry = sharedCanvas(prepared)
  const selected = requestedId
    ? prepared.filter(character => character.source.config.id === requestedId)
    : prepared

  for (const character of selected) {
    await writeCharacter(projectRoot, character, geometry.canvas, geometry.anchor, reference.idleBodyHeight)
    console.log(
      `Processed ${character.source.config.id}: ${SPRITE_NAMES.length} sprites, idle body ${character.source.idleBodyHeight}px, scale ${character.source.scale.toFixed(4)}`,
    )
  }
  console.log(`Shared canvas ${geometry.canvas.width}x${geometry.canvas.height}, anchor (${geometry.anchor.x}, ${geometry.anchor.y})`)
}

await main()
