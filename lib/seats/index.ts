import { getRepository } from '../repo'
import {
  AISLE_AFTER,
  COLUMNS,
  LEFT_COLUMNS,
  RIGHT_COLUMNS,
  UNACCOMPANIED_MINIMUM_AGE,
  parseSeatId,
} from './constants'
import type {
  AssignSeatResult,
  Passenger,
  PassengerRestrictions,
  Reservation,
  Seat,
  SeatMap,
  SeatRow,
  SeatState,
} from './types'

/**
 * The server-side seat primitives and approved seat-party compositions.
 *
 * Each primitive does a single job. `findSeatsForParty` composes the read primitives to rank
 * adjacent blocks, and `assignSeatsForParty` applies one validated block for the whole party.
 * `AGENTS.md`, under "Adding seat-party capabilities", documents the invariants, and
 * `tests/seat-party.test.ts` enforces them.
 */

export interface SeatPartyOption {
  row: number
  seatIds: string[]
  extraCostCents: number
}

export type AssignSeatsForPartyResult =
  | { ok: true; assignments: { passengerId: string; seatId: string }[] }
  | { ok: false; reason: string; message: string }

function effectiveState(baseState: Seat['baseState'], occupied: boolean): SeatState {
  if (baseState === 'blocked') return 'blocked'
  if (baseState === 'booked') return 'booked'
  return occupied ? 'occupied' : 'available'
}

/** Read the whole cabin: every row, every seat, and its state right now. */
export async function getSeatMap(flightId: string): Promise<SeatMap | null> {
  const repository = getRepository()
  const flight = await repository.getFlight(flightId)
  if (!flight) return null

  const [definitions, assignments] = await Promise.all([
    repository.getSeatDefinitions(flightId),
    repository.getAssignments(flightId),
  ])
  const occupantBySeat = new Map(assignments.map((entry) => [entry.seatId, entry.passengerId]))

  const rows: SeatRow[] = []
  for (let row = 1; row <= flight.rowCount; row += 1) {
    const inRow = definitions.filter((definition) => definition.row === row)
    if (inRow.length === 0) continue

    const seats: Seat[] = inRow.map((definition) => {
      const occupantPassengerId = occupantBySeat.get(definition.id) ?? null
      return {
        ...definition,
        occupantPassengerId,
        state: effectiveState(definition.baseState, occupantPassengerId !== null),
      }
    })
    const first = inRow[0]
    rows.push({
      row,
      isExitRow: first?.isExitRow ?? false,
      isExtraLegroom: first?.isExtraLegroom ?? false,
      left: LEFT_COLUMNS.map((column) => seats.find((seat) => seat.column === column)).filter(
        (seat): seat is Seat => seat !== undefined,
      ),
      right: RIGHT_COLUMNS.map((column) => seats.find((seat) => seat.column === column)).filter(
        (seat): seat is Seat => seat !== undefined,
      ),
    })
  }

  return {
    flightId: flight.id,
    cabinName: flight.cabinName,
    rowCount: flight.rowCount,
    columns: COLUMNS,
    aisleAfter: AISLE_AFTER,
    rows,
  }
}

/** The ids of every seat a passenger could take right now, in row then column order. */
export async function getAvailableSeats(flightId: string): Promise<string[]> {
  const map = await getSeatMap(flightId)
  if (!map) return []
  const available: string[] = []
  for (const row of map.rows) {
    for (const seat of [...row.left, ...row.right]) {
      if (seat.state === 'available') available.push(seat.id)
    }
  }
  return available
}

/** What one passenger is and is not allowed to do. */
export async function getPassengerRestrictions(
  passengerId: string,
): Promise<PassengerRestrictions | null> {
  const passenger = await getRepository().getPassenger(passengerId)
  if (!passenger) return null
  return {
    passengerId: passenger.id,
    type: passenger.type,
    age: passenger.age,
    canUseExitRow: passenger.type === 'adult',
    mustSitWithAdult: passenger.age < UNACCOMPANIED_MINIMUM_AGE,
  }
}

/** What one seat costs, in cents. Zero for a standard seat. */
export async function calculateSeatPrice(flightId: string, seatId: string): Promise<number | null> {
  const parsed = parseSeatId(seatId)
  if (!parsed) return null
  const definition = await getRepository().getSeatDefinition(flightId, seatId.trim().toUpperCase())
  return definition?.priceCents ?? null
}

/**
 * Move one passenger to one seat.
 *
 * Atomic: the store rejects a seat another passenger already holds.
 * Idempotent: calling it again with the same passenger and seat succeeds and changes nothing.
 * It moves one passenger. There is no bulk form of this call.
 */
export async function assignSeat(passengerId: string, seatId: string): Promise<AssignSeatResult> {
  const repository = getRepository()
  const normalizedSeatId = seatId.trim().toUpperCase()

  const passenger = await repository.getPassenger(passengerId)
  if (!passenger) {
    return { ok: false, reason: 'passenger_not_found', message: 'We cannot find that passenger.' }
  }

  const reservation = await repository.getReservationByCode(passenger.reservationCode)
  if (!reservation) {
    return { ok: false, reason: 'passenger_not_found', message: 'We cannot find that passenger.' }
  }

  const seat = await repository.getSeatDefinition(reservation.flightId, normalizedSeatId)
  if (!seat) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: `Seat ${normalizedSeatId} is not on this aircraft.`,
    }
  }

  if (seat.baseState === 'blocked') {
    return {
      ok: false,
      reason: 'seat_blocked',
      message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another seat.`,
    }
  }
  if (seat.baseState === 'booked') {
    return {
      ok: false,
      reason: 'seat_booked',
      message: `Seat ${seat.id} is already taken. Please pick another seat.`,
    }
  }
  if (seat.isExitRow && passenger.type !== 'adult') {
    return {
      ok: false,
      reason: 'exit_row_child',
      message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only, so ${passenger.firstName} cannot sit there.`,
    }
  }

  const result = await repository.assign(reservation.flightId, passenger.id, seat.id)
  if (!result.ok) {
    return {
      ok: false,
      reason: 'seat_booked',
      message: `Seat ${seat.id} was taken while you were choosing. Please pick another seat.`,
    }
  }

  return {
    ok: true,
    passengerId: passenger.id,
    seatId: seat.id,
    previousSeatId: result.previousSeatId,
    priceCents: seat.priceCents,
  }
}

/** Find one reservation by its confirmation code and the last name on it. */
export async function getReservation(code: string, lastName: string): Promise<Reservation | null> {
  const repository = getRepository()
  const record = await repository.findReservation(code, lastName)
  if (!record) return null

  const [flight, passengers] = await Promise.all([
    repository.getFlight(record.flightId),
    repository.getPassengers(record.code),
  ])
  if (!flight) return null

  return {
    code: record.code,
    lastName: record.lastName,
    flight,
    passengers,
    bookedOn: record.bookedOn,
    fareBrand: record.fareBrand,
    totalPaidUsd: record.totalPaidUsd,
  }
}

/** Read a reservation when the code is already trusted, for example from the URL of a trip page. */
export async function getReservationByCode(code: string): Promise<Reservation | null> {
  const record = await getRepository().getReservationByCode(code)
  if (!record) return null
  return getReservation(record.code, record.lastName)
}

/**
 * Find adjacent blocks for a booking party, with the lowest total extra cost first.
 *
 * Seats already held by this party may be included. Seats held by anyone else, booked seats and
 * seats reserved for accessible seating are excluded.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<SeatPartyOption[]> {
  if (
    passengerIds.length === 0 ||
    passengerIds.length > LEFT_COLUMNS.length ||
    new Set(passengerIds).size !== passengerIds.length
  ) {
    return []
  }

  const repository = getRepository()
  const passengers = await Promise.all(
    passengerIds.map((passengerId) => repository.getPassenger(passengerId)),
  )
  if (passengers.some((passenger) => passenger === null)) return []

  const resolvedPassengers = passengers.filter(
    (passenger): passenger is Passenger => passenger !== null,
  )
  const reservationCode = resolvedPassengers[0]?.reservationCode
  if (
    !reservationCode ||
    resolvedPassengers.some((passenger) => passenger.reservationCode !== reservationCode)
  ) {
    return []
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) return []

  const [map, availableSeatIds, restrictions] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!map || restrictions.some((restriction) => restriction === null)) return []

  const resolvedRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const partyHasAdult = resolvedRestrictions.some((restriction) => !restriction.mustSitWithAdult)
  if (
    resolvedRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !partyHasAdult
  ) {
    return []
  }

  const available = new Set(availableSeatIds)
  const party = new Set(passengerIds)
  const options: SeatPartyOption[] = []

  for (const row of map.rows) {
    if (row.isExitRow && resolvedRestrictions.some((restriction) => !restriction.canUseExitRow)) {
      continue
    }

    for (const side of [row.left, row.right]) {
      for (let start = 0; start <= side.length - passengerIds.length; start += 1) {
        const seats = side.slice(start, start + passengerIds.length)
        if (seats.length !== passengerIds.length) continue

        const canUseBlock = seats.every(
          (seat) =>
            seat.baseState === 'available' &&
            (available.has(seat.id) ||
              (seat.occupantPassengerId !== null && party.has(seat.occupantPassengerId))),
        )
        if (!canUseBlock) continue

        const prices = await Promise.all(
          seats.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        options.push({
          row: row.row,
          seatIds: seats.map((seat) => seat.id),
          extraCostCents: prices.reduce<number>(
            (total, price) => total + (price ?? 0),
            0,
          ),
        })
      }
    }
  }

  return options.sort(
    (left, right) =>
      left.extraCostCents - right.extraCostCents ||
      left.row - right.row ||
      left.seatIds.join(',').localeCompare(right.seatIds.join(',')),
  )
}

/**
 * Assign one validated adjacent block to a booking party.
 *
 * Every target is checked before the first move. Moves are ordered so a passenger leaves a seat
 * before another passenger in the party takes it. If a write fails, completed moves are restored
 * in reverse order.
 */
export async function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult> {
  if (
    passengerIds.length === 0 ||
    passengerIds.length !== seatIds.length ||
    new Set(passengerIds).size !== passengerIds.length
  ) {
    return {
      ok: false,
      reason: 'invalid_party',
      message: 'Choose one seat for every passenger and try again.',
    }
  }

  const normalizedSeatIds = seatIds.map((seatId) => seatId.trim().toUpperCase())
  if (
    normalizedSeatIds.some((seatId) => !parseSeatId(seatId)) ||
    new Set(normalizedSeatIds).size !== normalizedSeatIds.length
  ) {
    return {
      ok: false,
      reason: 'invalid_seat_block',
      message: 'Choose a valid block of adjacent seats and try again.',
    }
  }

  const repository = getRepository()
  const passengers = await Promise.all(
    passengerIds.map((passengerId) => repository.getPassenger(passengerId)),
  )
  if (passengers.some((passenger) => passenger === null)) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find one or more passengers in this booking.',
    }
  }

  const resolvedPassengers = passengers.filter(
    (passenger): passenger is Passenger => passenger !== null,
  )
  const reservationCode = resolvedPassengers[0]?.reservationCode
  if (
    !reservationCode ||
    resolvedPassengers.some((passenger) => passenger.reservationCode !== reservationCode)
  ) {
    return {
      ok: false,
      reason: 'passengers_not_in_same_booking',
      message: 'All passengers must be on the same booking.',
    }
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation) {
    return {
      ok: false,
      reason: 'reservation_not_found',
      message: 'We cannot find that booking.',
    }
  }

  const options = await findSeatsForParty(reservation.flight.id, passengerIds)
  const selectedOption = options.find(
    (option) =>
      option.seatIds.length === normalizedSeatIds.length &&
      option.seatIds.every((seatId, index) => seatId === normalizedSeatIds[index]),
  )
  if (!selectedOption) {
    return {
      ok: false,
      reason: 'invalid_seat_block',
      message:
        'Those seats are no longer available together. Find seats together again to see current options.',
    }
  }

  const originalSeatByPassenger = new Map(
    resolvedPassengers.map((passenger) => [passenger.id, passenger.seatId]),
  )
  const targetByPassenger = new Map(
    passengerIds.map((passengerId, index) => [passengerId, normalizedSeatIds[index] ?? null]),
  )
  const movers = resolvedPassengers.filter(
    (passenger) => targetByPassenger.get(passenger.id) !== passenger.seatId,
  )

  if (movers.some((passenger) => passenger.seatId === null)) {
    return {
      ok: false,
      reason: 'atomic_apply_unavailable',
      message: 'We could not move everyone together without changing existing seats. Please try again.',
    }
  }

  const occupancy = new Map<string, string>()
  for (const passenger of resolvedPassengers) {
    if (passenger.seatId) occupancy.set(passenger.seatId, passenger.id)
  }

  const order: Passenger[] = []
  const remaining = [...movers]
  while (remaining.length > 0) {
    const movableIndex = remaining.findIndex((passenger) => {
      const target = targetByPassenger.get(passenger.id)
      if (!target) return false
      const holder = occupancy.get(target)
      return !holder || holder === passenger.id
    })

    if (movableIndex === -1) {
      return {
        ok: false,
        reason: 'seat_swap_not_supported',
        message: 'We could not move everyone together from their current seats. Choose another block.',
      }
    }

    const [passenger] = remaining.splice(movableIndex, 1)
    if (!passenger) continue

    if (passenger.seatId) occupancy.delete(passenger.seatId)
    const target = targetByPassenger.get(passenger.id)
    if (target) occupancy.set(target, passenger.id)
    order.push(passenger)
  }

  const completed: Passenger[] = []
  for (const passenger of order) {
    const target = targetByPassenger.get(passenger.id)
    if (!target) continue

    const result = await assignSeat(passenger.id, target)
    if (!result.ok) {
      for (const movedPassenger of [...completed].reverse()) {
        const originalSeat = originalSeatByPassenger.get(movedPassenger.id)
        if (originalSeat) await assignSeat(movedPassenger.id, originalSeat)
      }

      return {
        ok: false,
        reason: result.reason,
        message: `${result.message} No one in your party was moved.`,
      }
    }

    completed.push(passenger)
  }

  return {
    ok: true,
    assignments: passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: normalizedSeatIds[index] as string,
    })),
  }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
