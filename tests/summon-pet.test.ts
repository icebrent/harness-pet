import { describe, expect, it } from 'vitest'
import { getSummonPosition, isWindowMeaningfullyVisible } from '../src/main/summon-pet.js'

const leftDisplay = { x: 0, y: 0, width: 1920, height: 1040 }
const rightDisplay = { x: 1920, y: 0, width: 2560, height: 1400 }
const offset = { right: 24, bottom: 12 }

describe('summonPet geometry', () => {
  it('does not move a pet that is already visible on any display', () => {
    const windowBounds = { x: 2100, y: 700, width: 430, height: 560 }
    expect(isWindowMeaningfullyVisible(windowBounds, [leftDisplay, rightDisplay])).toBe(true)
    expect(getSummonPosition(windowBounds, [leftDisplay, rightDisplay], leftDisplay, offset)).toBeUndefined()
  })

  it('recovers an off-screen pet to the cursor display workArea bottom-right', () => {
    const position = getSummonPosition(
      { x: 5000, y: -1800, width: 430, height: 560 },
      [leftDisplay, rightDisplay],
      rightDisplay,
      offset,
    )
    expect(position).toEqual({ x: 4026, y: 828 })
  })

  it('treats a tiny unreachable sliver as off-screen', () => {
    expect(isWindowMeaningfullyVisible(
      { x: 1900, y: 1020, width: 430, height: 560 },
      [leftDisplay],
    )).toBe(false)
  })
})
