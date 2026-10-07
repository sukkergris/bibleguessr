import { describe, expect, it } from 'vitest'
import { positionAtPoint, type SliderGeometry } from './slider-position'

// 0..4 over a 216px slider whose 16px thumb travels 200px: one position
// every 50px, from x = 108 (position 0) to x = 308 (position 4).
const SLIDER: SliderGeometry = { left: 100, width: 216, thumbWidth: 16 }
const MAX_POSITION = 4

describe('positionAtPoint', () => {
  it('picks the position whose thumb center is under the point', () => {
    expect(positionAtPoint(108, SLIDER, MAX_POSITION)).toBe(0)
    expect(positionAtPoint(158, SLIDER, MAX_POSITION)).toBe(1)
    expect(positionAtPoint(208, SLIDER, MAX_POSITION)).toBe(2)
    expect(positionAtPoint(308, SLIDER, MAX_POSITION)).toBe(4)
  })

  it('rounds to the nearest position', () => {
    expect(positionAtPoint(132, SLIDER, MAX_POSITION)).toBe(0)
    expect(positionAtPoint(134, SLIDER, MAX_POSITION)).toBe(1)
  })

  it('keeps to the ends, where the thumb stops before the edge', () => {
    expect(positionAtPoint(100, SLIDER, MAX_POSITION)).toBe(0)
    expect(positionAtPoint(0, SLIDER, MAX_POSITION)).toBe(0)
    expect(positionAtPoint(316, SLIDER, MAX_POSITION)).toBe(4)
    expect(positionAtPoint(1000, SLIDER, MAX_POSITION)).toBe(4)
  })

  it('has only position 0 when there is nothing else to pick', () => {
    expect(positionAtPoint(308, SLIDER, 0)).toBe(0)
  })

  it('has only position 0 when the slider is no wider than its thumb', () => {
    expect(positionAtPoint(108, { left: 100, width: 16, thumbWidth: 16 }, MAX_POSITION)).toBe(0)
  })
})
