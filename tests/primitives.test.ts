import { beforeEach, describe, expect, it } from 'vitest'
import { getRepository } from '../lib/repo'
import {
  assignSeat,
  calculateSeatPrice,
  getAvailableSeats,
  getPassengerRestrictions,
  getSeatMap,
} from '../lib/seats'
import { FLIGHT_ID } from '../lib/seats/constants'

beforeEach(async () => {
  await getRepository().resetDemo()
})

describe('getSeatMap', () => {
  it('returns 30 rows of 3-3 seats with the aisle after C', async () => {
    const map = await getSeatMap(FLIGHT_ID)
    expect(map).not.toBeNull()
    expect(map?.rows).toHaveLength(30)
    expect(map?.aisleAfter).toBe('C')
    for (const row of map?.rows ?? []) {
      expect(row.left.map((seat) => seat.column)).toEqual(['A', 'B', 'C'])
      expect(row.right.map((seat) => seat.column)).toEqual(['D', 'E', 'F'])
    }
  })

  it('shows the seats the party holds as occupied', async () => {
    const map = await getSeatMap(FLIGHT_ID)
    const seats = map?.rows.flatMap((row) => [...row.left, ...row.right]) ?? []
    const occupied = seats.filter((seat) => seat.state === 'occupied').map((seat) => seat.id)
    expect(occupied.sort()).toEqual(['12A', '18C', '24F'])
  })

  it('returns null for a flight that does not exist', async () => {
    expect(await getSeatMap('NA999')).toBeNull()
  })
})

describe('getAvailableSeats', () => {
  it('leaves out taken, blocked and occupied seats', async () => {
    const available = await getAvailableSeats(FLIGHT_ID)
    expect(available).toContain('21A')
    expect(available).not.toContain('20D')
    expect(available).not.toContain('12A')
    expect(new Set(available).size).toBe(available.length)
  })

  it('drops a seat once a passenger takes it', async () => {
    expect(await getAvailableSeats(FLIGHT_ID)).toContain('21A')
    await assignSeat('PAX-1', '21A')
    expect(await getAvailableSeats(FLIGHT_ID)).not.toContain('21A')
  })
})

describe('getPassengerRestrictions', () => {
  it('lets an adult use an exit row', async () => {
    const restrictions = await getPassengerRestrictions('PAX-1')
    expect(restrictions).toMatchObject({ type: 'adult', canUseExitRow: true, mustSitWithAdult: false })
  })

  it('keeps a child out of an exit row and next to an adult', async () => {
    const restrictions = await getPassengerRestrictions('PAX-3')
    expect(restrictions).toMatchObject({ type: 'child', age: 6, canUseExitRow: false, mustSitWithAdult: true })
  })

  it('returns null for a passenger that does not exist', async () => {
    expect(await getPassengerRestrictions('PAX-404')).toBeNull()
  })
})

describe('calculateSeatPrice', () => {
  it('charges nothing for a standard seat', async () => {
    expect(await calculateSeatPrice(FLIGHT_ID, '21A')).toBe(0)
  })

  it('charges for a bulkhead row and an exit row', async () => {
    expect(await calculateSeatPrice(FLIGHT_ID, '2A')).toBe(4500)
    expect(await calculateSeatPrice(FLIGHT_ID, '16C')).toBe(3900)
  })

  it('accepts a lower case seat id', async () => {
    expect(await calculateSeatPrice(FLIGHT_ID, '16c')).toBe(3900)
  })

  it('returns null for a seat that is not on the aircraft', async () => {
    expect(await calculateSeatPrice(FLIGHT_ID, '99Z')).toBeNull()
  })
})

describe('assignSeat', () => {
  it('moves one passenger and reports the seat they left', async () => {
    const result = await assignSeat('PAX-1', '21A')
    expect(result).toMatchObject({ ok: true, seatId: '21A', previousSeatId: '12A', priceCents: 0 })
  })

  it('is idempotent for the same passenger and seat', async () => {
    await assignSeat('PAX-1', '21A')
    const again = await assignSeat('PAX-1', '21A')
    expect(again.ok).toBe(true)
    const available = await getAvailableSeats(FLIGHT_ID)
    expect(available).not.toContain('21A')
    expect(available).toContain('12A')
  })

  it('refuses a seat another passenger already holds', async () => {
    await assignSeat('PAX-1', '21A')
    const result = await assignSeat('PAX-2', '21A')
    expect(result).toMatchObject({ ok: false, reason: 'seat_booked' })
  })

  it('refuses a seat that is booked by somebody else', async () => {
    const map = await getSeatMap(FLIGHT_ID)
    const booked = map?.rows
      .flatMap((row) => [...row.left, ...row.right])
      .find((seat) => seat.state === 'booked')
    expect(booked).toBeDefined()
    const result = await assignSeat('PAX-1', booked?.id ?? '')
    expect(result).toMatchObject({ ok: false, reason: 'seat_booked' })
  })

  it('refuses the seat held for accessible seating', async () => {
    const result = await assignSeat('PAX-1', '20D')
    expect(result).toMatchObject({ ok: false, reason: 'seat_blocked' })
  })

  it('refuses an exit row seat for a child', async () => {
    const result = await assignSeat('PAX-2', '15A')
    expect(result).toMatchObject({ ok: false, reason: 'exit_row_child' })
  })

  it('allows an exit row seat for an adult', async () => {
    const result = await assignSeat('PAX-1', '15A')
    expect(result).toMatchObject({ ok: true, seatId: '15A', priceCents: 3900 })
  })

  it('refuses a passenger that does not exist', async () => {
    const result = await assignSeat('PAX-404', '21A')
    expect(result).toMatchObject({ ok: false, reason: 'passenger_not_found' })
  })

  it('refuses a seat that is not on the aircraft', async () => {
    const result = await assignSeat('PAX-1', '99Z')
    expect(result).toMatchObject({ ok: false, reason: 'seat_not_found' })
  })

  it('only ever moves one passenger for each call', async () => {
    await assignSeat('PAX-1', '21A')
    const map = await getSeatMap(FLIGHT_ID)
    const occupied = (map?.rows.flatMap((row) => [...row.left, ...row.right]) ?? [])
      .filter((seat) => seat.state === 'occupied')
      .map((seat) => seat.id)
      .sort()
    expect(occupied).toEqual(['18C', '21A', '24F'])
  })
})
