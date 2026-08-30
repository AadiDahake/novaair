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
 * The server-side seat primitives and the deliberate compositions built from them.
 *
 * Each primitive does a single job. The seat-party compositions use those primitives to find
 * ranked blocks of seats and move a whole party while preserving the cabin and passenger rules.
 * `AGENTS.md`, under "Maintaining seat-party capabilities", describes the invariants, and
 * `tests/seat-party.test.ts` enforces them.
 */

export interface PartySeatAssignment {
  passengerId: string
  seatId: string
}

export interface PartySeatOption {
  row: number
  seatIds: string[]
  seats: string[]
  assignments: PartySeatAssignment[]
  priceCents: number
  totalPriceCents: number
}

export type AssignSeatsForPartyResult =
  | {
      ok: true
      seatIds: string[]
      seats: string[]
      assignments: PartySeatAssignment[]
      priceCents: number
      totalPriceCents: number
    }
  | {
      ok: false
      reason: string
      message: string
    }

function effectiveState(baseState: Seat['baseState'], occupied: boolean): SeatState {
  if (baseState === 'blocked') return 'blocked'
  if (baseState === 'booked') return 'booked'
  return occupied ? 'occupied' : 'available'
}

function seatsInMap(seatMap: SeatMap): Seat[] {
  return seatMap.rows.flatMap((row) => [...row.left, ...row.right])
}

function normalizePartyIds(passengerIds: readonly string[]): string[] {
  return passengerIds.map((passengerId) => passengerId.trim()).filter(Boolean)
}

function normalizePartyAssignments(
  assignments: readonly PartySeatAssignment[],
): PartySeatAssignment[] {
  return assignments.map((assignment) => ({
    passengerId: assignment.passengerId.trim(),
    seatId: assignment.seatId.trim().toUpperCase(),
  }))
}

function isContiguousBlock(seats: readonly Seat[]): boolean {
  if (seats.length === 0) return false

  const row = seats[0]?.row
  if (row === undefined || seats.some((seat) => seat.row !== row)) return false

  const leftIndexes = seats.map((seat) => LEFT_COLUMNS.indexOf(seat.column))
  const rightIndexes = seats.map((seat) => RIGHT_COLUMNS.indexOf(seat.column))
  const indexes = leftIndexes.every((index) => index >= 0)
    ? leftIndexes
    : rightIndexes.every((index) => index >= 0)
      ? rightIndexes
      : null

  if (!indexes) return false

  const sorted = [...indexes].sort((a, b) => a - b)
  return sorted.every((index, position) => position === 0 || index === sorted[position - 1]! + 1)
}

function assignPassengersToBlock(
  passengerIds: readonly string[],
  seats: readonly Seat[],
): PartySeatAssignment[] {
  const partyIds = new Set(passengerIds)
  const assignedPassengers = new Set<string>()
  const assignmentBySeat = new Map<string, string>()

  for (const seat of seats) {
    const occupant = seat.occupantPassengerId
    if (occupant && partyIds.has(occupant) && !assignedPassengers.has(occupant)) {
      assignmentBySeat.set(seat.id, occupant)
      assignedPassengers.add(occupant)
    }
  }

  const remainingPassengers = passengerIds.filter(
    (passengerId) => !assignedPassengers.has(passengerId),
  )
  let nextPassenger = 0

  return seats.map((seat) => {
    const passengerId = assignmentBySeat.get(seat.id) ?? remainingPassengers[nextPassenger++]
    if (!passengerId) {
      throw new Error('The seat block does not match the party size.')
    }
    return { passengerId, seatId: seat.id }
  })
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
 * Find contiguous seat blocks for a party, ordered by lowest total extra cost.
 *
 * Seats already held by this party may remain in a block. Seats held by anyone outside the party,
 * booked seats and accessibility-held seats are never offered.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: readonly string[],
): Promise<PartySeatOption[]> {
  const normalizedPassengerIds = normalizePartyIds(passengerIds)
  if (
    normalizedPassengerIds.length === 0 ||
    new Set(normalizedPassengerIds).size !== normalizedPassengerIds.length
  ) {
    return []
  }

  const [seatMap, availableSeatIds, restrictions] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
    Promise.all(
      normalizedPassengerIds.map((passengerId) => getPassengerRestrictions(passengerId)),
    ),
  ])

  if (!seatMap || restrictions.some((restriction) => restriction === null)) return []

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return []
  }

  const available = new Set(availableSeatIds)
  const party = new Set(normalizedPassengerIds)
  const options: PartySeatOption[] = []

  for (const row of seatMap.rows) {
    for (const side of [row.left, row.right]) {
      for (
        let start = 0;
        start + normalizedPassengerIds.length <= side.length;
        start += 1
      ) {
        const block = side.slice(start, start + normalizedPassengerIds.length)
        if (!isContiguousBlock(block)) continue

        const canUseBlock = block.every((seat) => {
          if (seat.baseState !== 'available') return false
          if (
            !available.has(seat.id) &&
            (!seat.occupantPassengerId || !party.has(seat.occupantPassengerId))
          ) {
            return false
          }
          return passengerRestrictions.every(
            (restriction) => !seat.isExitRow || restriction.canUseExitRow,
          )
        })
        if (!canUseBlock) continue

        const prices = await Promise.all(
          block.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        const totalPriceCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )
        const seatIds = block.map((seat) => seat.id)
        options.push({
          row: row.row,
          seatIds,
          seats: [...seatIds],
          assignments: assignPassengersToBlock(normalizedPassengerIds, block),
          priceCents: totalPriceCents,
          totalPriceCents,
        })
      }
    }
  }

  return options.sort(
    (left, right) =>
      left.totalPriceCents - right.totalPriceCents ||
      left.row - right.row ||
      left.seatIds.join(',').localeCompare(right.seatIds.join(',')),
  )
}

/**
 * Move a party to one contiguous block.
 *
 * Every target is validated before the first write. Writes are ordered so a passenger leaves a
 * seat before another party member takes it. If a write still fails, completed writes are rolled
 * back in reverse order.
 */
export async function assignSeatsForParty(
  flightId: string,
  assignments: readonly PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult> {
  const normalizedAssignments = normalizePartyAssignments(assignments)
  if (normalizedAssignments.length === 0) {
    return {
      ok: false,
      reason: 'assignments_required',
      message: 'Choose seats for your family before saving.',
    }
  }

  const passengerIds = normalizedAssignments.map((assignment) => assignment.passengerId)
  const targetSeatIds = normalizedAssignments.map((assignment) => assignment.seatId)
  if (
    passengerIds.some((passengerId) => !passengerId) ||
    targetSeatIds.some((seatId) => !seatId) ||
    new Set(passengerIds).size !== passengerIds.length ||
    new Set(targetSeatIds).size !== targetSeatIds.length
  ) {
    return {
      ok: false,
      reason: 'invalid_assignments',
      message: 'Each passenger must have one different seat.',
    }
  }

  const [seatMap, restrictions] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(passengerIds.map((passengerId) => getPassengerRestrictions(passengerId))),
  ])
  if (!seatMap) {
    return {
      ok: false,
      reason: 'flight_not_found',
      message: 'We cannot find that flight.',
    }
  }
  if (restrictions.some((restriction) => restriction === null)) {
    return {
      ok: false,
      reason: 'passenger_not_found',
      message: 'We cannot find one of those passengers.',
    }
  }

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some((restriction) => restriction.type === 'adult')
  if (
    passengerRestrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return {
      ok: false,
      reason: 'adult_required',
      message: 'A child under 13 must sit with an adult on this booking.',
    }
  }

  const allSeats = seatsInMap(seatMap)
  const seatById = new Map(allSeats.map((seat) => [seat.id, seat]))
  const targetSeats = targetSeatIds
    .map((seatId) => seatById.get(seatId))
    .filter((seat): seat is Seat => seat !== undefined)

  if (targetSeats.length !== normalizedAssignments.length) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: 'One of those seats is not on this aircraft.',
    }
  }
  if (!isContiguousBlock(targetSeats)) {
    return {
      ok: false,
      reason: 'seats_not_together',
      message: 'Choose consecutive seats in one row on the same side of the aisle.',
    }
  }

  const partyIds = new Set(passengerIds)
  for (const seat of targetSeats) {
    if (seat.baseState === 'blocked') {
      return {
        ok: false,
        reason: 'seat_blocked',
        message: `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another block.`,
      }
    }
    if (seat.baseState === 'booked') {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} is already taken. Please pick another block.`,
      }
    }
    if (seat.occupantPassengerId && !partyIds.has(seat.occupantPassengerId)) {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} was taken while you were choosing. Please pick another block.`,
      }
    }
  }

  const restrictionByPassenger = new Map(
    passengerRestrictions.map((restriction) => [restriction.passengerId, restriction]),
  )
  for (const assignment of normalizedAssignments) {
    const seat = seatById.get(assignment.seatId)
    const restriction = restrictionByPassenger.get(assignment.passengerId)
    if (!seat || !restriction) {
      return {
        ok: false,
        reason: 'invalid_assignments',
        message: 'We could not validate every passenger and seat.',
      }
    }
    if (seat.isExitRow && !restriction.canUseExitRow) {
      return {
        ok: false,
        reason: 'exit_row_child',
        message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only.`,
      }
    }
  }

  const currentSeatByPassenger = new Map<string, string>()
  const currentPassengerBySeat = new Map<string, string>()
  for (const seat of allSeats) {
    if (!seat.occupantPassengerId) continue
    currentSeatByPassenger.set(seat.occupantPassengerId, seat.id)
    currentPassengerBySeat.set(seat.id, seat.occupantPassengerId)
  }

  const movers = normalizedAssignments.filter(
    (assignment) => currentSeatByPassenger.get(assignment.passengerId) !== assignment.seatId,
  )
  if (movers.some((assignment) => !currentSeatByPassenger.has(assignment.passengerId))) {
    return {
      ok: false,
      reason: 'current_seat_required',
      message: 'We could not verify every passenger’s current seat. No seats were changed.',
    }
  }

  const ordered: PartySeatAssignment[] = []
  const remaining = [...movers]
  const simulatedOccupancy = new Map(currentPassengerBySeat)

  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((assignment) => {
      const holder = simulatedOccupancy.get(assignment.seatId)
      return !holder || holder === assignment.passengerId
    })
    if (nextIndex === -1) {
      return {
        ok: false,
        reason: 'seat_swap_not_supported',
        message: 'That seat swap cannot be completed safely. Please choose another family option.',
      }
    }

    const [assignment] = remaining.splice(nextIndex, 1)
    if (!assignment) break

    const currentSeat = currentSeatByPassenger.get(assignment.passengerId)
    if (currentSeat) simulatedOccupancy.delete(currentSeat)
    simulatedOccupancy.set(assignment.seatId, assignment.passengerId)
    ordered.push(assignment)
  }

  const completed: Array<PartySeatAssignment & { previousSeatId: string }> = []
  for (const assignment of ordered) {
    const result = await assignSeat(assignment.passengerId, assignment.seatId)
    if (!result.ok) {
      for (const completedAssignment of [...completed].reverse()) {
        await assignSeat(completedAssignment.passengerId, completedAssignment.previousSeatId)
      }
      return {
        ok: false,
        reason: result.reason,
        message: `${result.message} No family seats were changed.`,
      }
    }

    if (result.previousSeatId) {
      completed.push({
        ...assignment,
        previousSeatId: result.previousSeatId,
      })
    }
  }

  const prices = await Promise.all(
    targetSeatIds.map((seatId) => calculateSeatPrice(flightId, seatId)),
  )
  const totalPriceCents = prices.reduce<number>(
    (total, price) => total + (price ?? 0),
    0,
  )

  return {
    ok: true,
    seatIds: targetSeatIds,
    seats: [...targetSeatIds],
    assignments: normalizedAssignments,
    priceCents: totalPriceCents,
    totalPriceCents,
  }
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
