import { beforeEach, describe, expect, it } from 'vitest'
import { getRepository } from '../lib/repo'
import { assignSeat, getReservation, getReservationByCode } from '../lib/seats'

beforeEach(async () => {
  await getRepository().resetDemo()
})

describe('getReservation', () => {
  it('finds the demo booking by its code and last name', async () => {
    const reservation = await getReservation('NVA7K2', 'Altman')
    expect(reservation?.code).toBe('NVA7K2')
    expect(reservation?.flight.flightNumber).toBe('NA 214')
    expect(reservation?.flight.originCode).toBe('SFO')
    expect(reservation?.flight.destinationCode).toBe('JFK')
    expect(reservation?.flight.departureDate).toBe('2026-09-19')
  })

  it('returns the party in order with their seats', async () => {
    const reservation = await getReservation('NVA7K2', 'Altman')
    expect(
      reservation?.passengers.map((passenger) => [passenger.index, passenger.firstName, passenger.type, passenger.seatId]),
    ).toEqual([
      [0, 'Sam', 'adult', '12A'],
      [1, 'Elon', 'child', '18C'],
      [2, 'Zuck', 'child', '24F'],
    ])
  })

  it('ignores the case and the padding of the code and the name', async () => {
    expect(await getReservation('  nva7k2 ', ' altman ')).not.toBeNull()
  })

  it('refuses the wrong last name', async () => {
    expect(await getReservation('NVA7K2', 'Smith')).toBeNull()
  })

  it('refuses a code that does not exist', async () => {
    expect(await getReservation('ZZZZZZ', 'Altman')).toBeNull()
  })
})

describe('the whole seat change flow', () => {
  it('moves the party to 21A, 21B and 21C one passenger at a time and keeps them there', async () => {
    const before = await getReservation('NVA7K2', 'Altman')
    expect(before?.passengers.map((passenger) => passenger.seatId)).toEqual(['12A', '18C', '24F'])

    expect((await assignSeat('PAX-1', '21A')).ok).toBe(true)
    expect((await assignSeat('PAX-2', '21B')).ok).toBe(true)
    expect((await assignSeat('PAX-3', '21C')).ok).toBe(true)

    const after = await getReservationByCode('NVA7K2')
    expect(after?.passengers.map((passenger) => passenger.seatId)).toEqual(['21A', '21B', '21C'])
  })

  it('leaves the seats the party left behind free again', async () => {
    await assignSeat('PAX-1', '21A')
    const reservation = await getReservationByCode('NVA7K2')
    expect(reservation?.passengers[0]?.seatId).toBe('21A')
    const second = await assignSeat('PAX-2', '12A')
    expect(second.ok).toBe(true)
  })
})
