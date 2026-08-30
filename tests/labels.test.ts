import { describe, expect, it } from 'vitest'
import { priceTag, seatAriaLabel } from '../lib/seats/labels'
import type { Seat } from '../lib/seats/types'

function seat(overrides: Partial<Seat>): Seat {
  return {
    id: '21A',
    row: 21,
    column: 'A',
    baseState: 'available',
    isExitRow: false,
    isExtraLegroom: false,
    priceCents: 0,
    state: 'available',
    occupantPassengerId: null,
    ...overrides,
  }
}

describe('seatAriaLabel', () => {
  it('names a free standard seat', () => {
    expect(seatAriaLabel(seat({}))).toBe('Seat 21A, available, no extra cost')
  })

  it('names a free seat that costs extra', () => {
    expect(
      seatAriaLabel(seat({ id: '2A', row: 2, isExtraLegroom: true, priceCents: 4500 })),
    ).toBe('Seat 2A, available, 45 dollars')
  })

  it('names a taken seat', () => {
    expect(seatAriaLabel(seat({ id: '12B', column: 'B', row: 12, baseState: 'booked', state: 'booked' })))
      .toBe('Seat 12B, booked')
  })

  it('names an exit row seat with its rule and its price', () => {
    expect(
      seatAriaLabel(
        seat({ id: '16C', row: 16, column: 'C', isExitRow: true, isExtraLegroom: true, priceCents: 3900 }),
      ),
    ).toBe('Seat 16C, exit row, adults only, 39 dollars')
  })

  it('names a seat held for accessible seating', () => {
    expect(
      seatAriaLabel(seat({ id: '20D', row: 20, column: 'D', baseState: 'blocked', state: 'blocked' })),
    ).toBe('Seat 20D, blocked for accessibility')
  })

  it('names a seat one of the party holds', () => {
    expect(
      seatAriaLabel(seat({ id: '12A', row: 12, state: 'occupied', occupantPassengerId: 'PAX-1' }), 'Sam'),
    ).toBe('Seat 12A, chosen for Sam')
  })
})

describe('priceTag', () => {
  it('is empty when the seat costs nothing extra', () => {
    expect(priceTag(0)).toBe('')
  })

  it('shows whole dollars', () => {
    expect(priceTag(3900)).toBe('$39')
    expect(priceTag(4500)).toBe('$45')
  })
})
