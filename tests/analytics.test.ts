import { describe, expect, it } from 'vitest'
import {
  NOVAAIR_EVENT_NAMES,
  seatsAreContiguous,
  seatsAreSameRow,
} from '../lib/analytics/events'

describe('the analytics contract', () => {
  it('lists every event the site sends', () => {
    expect(NOVAAIR_EVENT_NAMES).toEqual([
      'seat_map_opened',
      'passenger_selected',
      'seat_hovered',
      'seat_selected',
      'seat_selection_rejected',
      'seat_assignment_confirmed',
      'help_article_viewed',
    ])
  })
})

describe('seatsAreSameRow', () => {
  it('is true when every seat is in one row', () => {
    expect(seatsAreSameRow(['21A', '21B', '21C'])).toBe(true)
  })

  it('is false across rows', () => {
    expect(seatsAreSameRow(['12A', '18C', '24F'])).toBe(false)
  })

  it('is false for no seats', () => {
    expect(seatsAreSameRow([])).toBe(false)
  })
})

describe('seatsAreContiguous', () => {
  it('is true for a block on one side of the aisle', () => {
    expect(seatsAreContiguous(['21A', '21B', '21C'])).toBe(true)
    expect(seatsAreContiguous(['9D', '9E', '9F'])).toBe(true)
    expect(seatsAreContiguous(['4A', '4B'])).toBe(true)
  })

  it('is false when the aisle is between the seats', () => {
    expect(seatsAreContiguous(['9C', '9D', '9E'])).toBe(false)
    expect(seatsAreContiguous(['22B', '22C', '22D'])).toBe(false)
    expect(seatsAreContiguous(['5C', '5D'])).toBe(false)
  })

  it('is false when a seat is missing from the block', () => {
    expect(seatsAreContiguous(['21A', '21C'])).toBe(false)
  })

  it('is false across rows', () => {
    expect(seatsAreContiguous(['21A', '22B', '23C'])).toBe(false)
  })

  it('is true for one seat', () => {
    expect(seatsAreContiguous(['21A'])).toBe(true)
  })
})
