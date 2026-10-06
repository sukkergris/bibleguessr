import { describe, expect, it } from 'vitest'
import { buildInfoText, LOADING, NOT_SET, UNAVAILABLE, type BuildInfoState } from './build-info'

// The nerd panel's "API image" rows — see build-info.ts and
// docs/web/build-info.

const loaded: BuildInfoState = {
  kind: 'loaded',
  info: { buildSha: 'e99dae2', buildContext: null, imageTag: '0.0.7' },
}

describe('buildInfoText', () => {
  it('shows each value the API reports', () => {
    expect(buildInfoText(loaded, 'buildSha')).toBe('e99dae2')
    expect(buildInfoText(loaded, 'imageTag')).toBe('0.0.7')
  })

  it('says a value is not set when the API reports null', () => {
    expect(buildInfoText(loaded, 'buildContext')).toBe(NOT_SET)
  })

  it('says it is loading until the API answers', () => {
    expect(buildInfoText({ kind: 'loading' }, 'imageTag')).toBe(LOADING)
  })

  it('says the values are unavailable when the request failed', () => {
    expect(buildInfoText({ kind: 'failed', reason: 'down' }, 'buildSha')).toBe(UNAVAILABLE)
  })
})
