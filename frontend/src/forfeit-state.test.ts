import { describe, expect, it } from 'vitest'
import { FORFEIT_RESPONSE_TIMEOUT_MS, forfeitOutcomeAfter } from './forfeit-state'

describe('forfeitOutcomeAfter', () => {
  it('keeps waiting while a normal round-trip is still plausible', () => {
    expect(forfeitOutcomeAfter(0).kind).toBe('waiting')
    expect(forfeitOutcomeAfter(FORFEIT_RESPONSE_TIMEOUT_MS - 1).kind).toBe('waiting')
  })

  // The actual bug: the server never answered (the opponent's disconnect
  // had already ended the game, so there was nothing left to forfeit) and
  // the dialog stayed disabled forever with no way out.
  it('hands control back once the server has clearly not answered', () => {
    expect(forfeitOutcomeAfter(FORFEIT_RESPONSE_TIMEOUT_MS).kind).toBe('recovered')
    expect(forfeitOutcomeAfter(FORFEIT_RESPONSE_TIMEOUT_MS * 10).kind).toBe('recovered')
  })

  it('explains what happened and what the player can do next', () => {
    const outcome = forfeitOutcomeAfter(FORFEIT_RESPONSE_TIMEOUT_MS)

    expect(outcome.kind).toBe('recovered')
    if (outcome.kind !== 'recovered') return
    // The player is stuck on a dialog: the message has to tell them both
    // why nothing happened and how to get out.
    expect(outcome.message).toMatch(/already ended/i)
    expect(outcome.message).toMatch(/try again/i)
    expect(outcome.message).toMatch(/back to chat selection/i)
  })

  it('never reports "waiting" indefinitely for an arbitrarily long wait', () => {
    // There is deliberately no outcome that leaves the dialog disabled
    // forever — that is the trap this rule exists to prevent.
    expect(forfeitOutcomeAfter(Number.MAX_SAFE_INTEGER).kind).toBe('recovered')
  })
})
