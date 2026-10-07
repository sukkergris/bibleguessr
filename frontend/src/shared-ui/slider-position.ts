// Which position of a range slider a point on screen lands on — for the
// guess bar's tap fallback (see guess-form.ts and docs/web/book-picker).
// A pure function, so it can be tested without rendering anything.

/** Where a slider is on screen, in CSS pixels. */
export interface SliderGeometry {
  left: number
  width: number
  /** The thumb's center travels from `left + thumbWidth / 2` to
   * `left + width - thumbWidth / 2`, never out to the edges. */
  thumbWidth: number
}

const FIRST_POSITION = 0

/** The position, 0..maxPosition, whose thumb center is nearest `x`. */
export function positionAtPoint(x: number, slider: SliderGeometry, maxPosition: number): number {
  const travel = slider.width - slider.thumbWidth
  if (maxPosition <= FIRST_POSITION || travel <= 0) return FIRST_POSITION

  const share = (x - slider.left - slider.thumbWidth / 2) / travel
  return Math.round(Math.min(1, Math.max(0, share)) * maxPosition)
}
