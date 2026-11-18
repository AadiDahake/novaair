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

export interface PartySeatOption {
  seatIds: string[]
  row: number
  extraCostCents: number
  totalPriceCents: number
}

export interface PartySeatAssignment {
  passengerId: string
  seatId: string
}

export interface AssignSeatsForPartySuccess {
  ok: true
  assignments: Array<{
    passengerId: string
    seatId: string
    previousSeatId: string | null
    priceCents: number
  }>
  totalPriceCents: number
}

export interface AssignSeatsForPartyFailure {
  ok: false
  reason:
    | 'flight_not_found'
    | 'passenger_not_found'
    | 'passenger_not_on_flight'
    | 'party_requires_adult'
    | 'invalid_seat_block'
    | 'seat_not_found'
    | 'seat_booked'
    | 'seat_blocked'
    | 'exit_row_child'
    | 'assignment_failed'
  message: string
}

export type AssignSeatsForPartyResult =
  | AssignSeatsForPartySuccess
  | AssignSeatsForPartyFailure

/**
 * The server-side seat primitives and the seat-party composition.
 *
 * Each primitive does a single job. The party capability composes those primitives to search for
 * adjacent seats and apply a complete party assignment without leaving a partial change behind.
 * `AGENTS.md`, under "Adding seat-party capabilities", defines the invariants, and
 * `tests/seat-party.test.ts` enforces them.
 */

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

async function getPartyContext(
  flightId: string,
  passengerIds: string[],
): Promise<{
  reservation: Reservation
  passengers: Passenger[]
  restrictions: PassengerRestrictions[]
} | null> {
  if (passengerIds.length === 0 || new Set(passengerIds).size !== passengerIds.length) return null

  const repository = getRepository()
  const passengers = await Promise.all(
    passengerIds.map((passengerId) => repository.getPassenger(passengerId)),
  )
  if (passengers.some((passenger) => passenger === null)) return null

  const party = passengers.filter((passenger): passenger is Passenger => passenger !== null)
  const reservationCode = party[0]?.reservationCode
  if (
    !reservationCode ||
    party.some((passenger) => passenger.reservationCode !== reservationCode)
  ) {
    return null
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) return null

  const restrictions = await Promise.all(
    party.map((passenger) => getPassengerRestrictions(passenger.id)),
  )
  if (restrictions.some((restriction) => restriction === null)) return null

  return {
    reservation,
    passengers: party,
    restrictions: restrictions.filter(
      (restriction): restriction is PassengerRestrictions => restriction !== null,
    ),
  }
}

/**
 * Find same-row, same-side blocks for a party, ranked by lowest total extra cost.
 *
 * Seats already held by this party may remain in an offered block. Seats held by anybody outside
 * the party, booked seats and seats held for accessible seating are never offered.
 */
export async function findSeatsForParty(
  flightId: string,
  passengerIds: string[],
): Promise<PartySeatOption[]> {
  const [map, context] = await Promise.all([
    getSeatMap(flightId),
    getPartyContext(flightId, passengerIds),
  ])
  if (!map || !context) return []

  const partyIds = new Set(passengerIds)
  const hasAdult = context.restrictions.some((restriction) => restriction.type === 'adult')
  if (
    context.restrictions.some((restriction) => restriction.mustSitWithAdult) &&
    !hasAdult
  ) {
    return []
  }

  const options: PartySeatOption[] = []

  for (const row of map.rows) {
    for (const side of [row.left, row.right]) {
      for (let start = 0; start + passengerIds.length <= side.length; start += 1) {
        const seats = side.slice(start, start + passengerIds.length)
        const usable = seats.every(
          (seat) =>
            seat.baseState === 'available' &&
            (!seat.occupantPassengerId || partyIds.has(seat.occupantPassengerId)),
        )
        if (!usable) continue

        if (
          seats.some((seat) => seat.isExitRow) &&
          context.restrictions.some((restriction) => !restriction.canUseExitRow)
        ) {
          continue
        }

        const prices = await Promise.all(
          seats.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        const extraCostCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )

        options.push({
          seatIds: seats.map((seat) => seat.id),
          row: row.row,
          extraCostCents,
          totalPriceCents: extraCostCents,
        })
      }
    }
  }

  return options.sort((left, right) => {
    if (left.extraCostCents !== right.extraCostCents) {
      return left.extraCostCents - right.extraCostCents
    }

    const leftSeat = parseSeatId(left.seatIds[0] ?? '')
    const rightSeat = parseSeatId(right.seatIds[0] ?? '')
    if (!leftSeat || !rightSeat) return 0
    if (leftSeat.row !== rightSeat.row) return leftSeat.row - rightSeat.row
    return COLUMNS.indexOf(leftSeat.column) - COLUMNS.indexOf(rightSeat.column)
  })
}

function isContiguousBlock(map: SeatMap, seatIds: string[]): boolean {
  if (seatIds.length === 0 || new Set(seatIds).size !== seatIds.length) return false
  const wanted = new Set(seatIds)

  for (const row of map.rows) {
    for (const side of [row.left, row.right]) {
      for (let start = 0; start + seatIds.length <= side.length; start += 1) {
        const block = side.slice(start, start + seatIds.length)
        if (block.every((seat) => wanted.has(seat.id))) return true
      }
    }
  }

  return false
}

const partyAssignmentLocks = new Map<string, Promise<void>>()

async function withPartyAssignmentLock<T>(flightId: string, operation: () => Promise<T>): Promise<T> {
  const previous = partyAssignmentLocks.get(flightId) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const current = previous.then(() => gate)
  partyAssignmentLocks.set(flightId, current)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (partyAssignmentLocks.get(flightId) === current) {
      partyAssignmentLocks.delete(flightId)
    }
  }
}

function assignmentFailure(
  reason: AssignSeatsForPartyFailure['reason'],
  message: string,
): AssignSeatsForPartyFailure {
  return { ok: false, reason, message }
}

/**
 * Move a complete party into one contiguous block.
 *
 * The complete block is validated before the first write. Writes are ordered around seats the
 * party already holds, and successful writes are rolled back in reverse order if any later write
 * fails.
 */
export function assignSeatsForParty(
  flightId: string,
  assignments: PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  passengerIds: string[],
  seatIds: string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightIdOrPassengerIds: string | string[],
  assignmentsOrSeatIds: PartySeatAssignment[] | string[],
): Promise<AssignSeatsForPartyResult> {
  let flightId: string
  let assignments: PartySeatAssignment[]

  if (Array.isArray(flightIdOrPassengerIds)) {
    const passengerIds = flightIdOrPassengerIds
    const seatIds = assignmentsOrSeatIds as string[]

    if (
      passengerIds.length === 0 ||
      passengerIds.length !== seatIds.length ||
      new Set(passengerIds).size !== passengerIds.length
    ) {
      return assignmentFailure(
        'invalid_seat_block',
        'Choose one seat for each passenger in the party.',
      )
    }

    const firstPassenger = await getRepository().getPassenger(passengerIds[0] ?? '')
    if (!firstPassenger) {
      return assignmentFailure('passenger_not_found', 'We cannot find that passenger.')
    }

    const reservation = await getRepository().getReservationByCode(
      firstPassenger.reservationCode,
    )
    if (!reservation) {
      return assignmentFailure('passenger_not_found', 'We cannot find that passenger.')
    }

    flightId = reservation.flightId
    assignments = passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: seatIds[index] ?? '',
    }))
  } else {
    flightId = flightIdOrPassengerIds
    assignments = assignmentsOrSeatIds as PartySeatAssignment[]
  }

  return withPartyAssignmentLock(flightId, async () => {
    const map = await getSeatMap(flightId)
    if (!map) {
      return assignmentFailure('flight_not_found', 'We cannot find that flight.')
    }

    if (
      assignments.length === 0 ||
      new Set(assignments.map((assignment) => assignment.passengerId)).size !==
        assignments.length
    ) {
      return assignmentFailure(
        'invalid_seat_block',
        'Choose one seat for each passenger in the party.',
      )
    }

    const normalizedAssignments = assignments.map((assignment) => ({
      passengerId: assignment.passengerId,
      seatId: assignment.seatId.trim().toUpperCase(),
    }))
    const seatIds = normalizedAssignments.map((assignment) => assignment.seatId)

    if (!isContiguousBlock(map, seatIds)) {
      return assignmentFailure(
        'invalid_seat_block',
        'Choose consecutive seats in one row on the same side of the aisle.',
      )
    }

    const context = await getPartyContext(
      flightId,
      normalizedAssignments.map((assignment) => assignment.passengerId),
    )
    if (!context) {
      const repository = getRepository()
      const passengers = await Promise.all(
        normalizedAssignments.map((assignment) =>
          repository.getPassenger(assignment.passengerId),
        ),
      )
      if (passengers.some((passenger) => passenger === null)) {
        return assignmentFailure('passenger_not_found', 'We cannot find that passenger.')
      }
      return assignmentFailure(
        'passenger_not_on_flight',
        'Every passenger must be on this flight and in the same booking.',
      )
    }

    const restrictionByPassenger = new Map(
      context.restrictions.map((restriction) => [restriction.passengerId, restriction]),
    )
    const hasAdult = context.restrictions.some((restriction) => restriction.type === 'adult')
    if (
      context.restrictions.some((restriction) => restriction.mustSitWithAdult) &&
      !hasAdult
    ) {
      return assignmentFailure(
        'party_requires_adult',
        'A child under 13 must sit with an adult on the same booking.',
      )
    }

    const seatById = new Map<string, Seat>()
    for (const row of map.rows) {
      for (const seat of [...row.left, ...row.right]) seatById.set(seat.id, seat)
    }

    const partyIds = new Set(
      normalizedAssignments.map((assignment) => assignment.passengerId),
    )
    for (const assignment of normalizedAssignments) {
      const seat = seatById.get(assignment.seatId)
      if (!seat) {
        return assignmentFailure(
          'seat_not_found',
          `Seat ${assignment.seatId} is not on this aircraft.`,
        )
      }
      if (seat.baseState === 'blocked') {
        return assignmentFailure(
          'seat_blocked',
          `Seat ${seat.id} is held for a customer who needs accessible seating. Please pick another seat.`,
        )
      }
      if (
        seat.baseState === 'booked' ||
        (seat.occupantPassengerId && !partyIds.has(seat.occupantPassengerId))
      ) {
        return assignmentFailure(
          'seat_booked',
          `Seat ${seat.id} is already taken. Please pick another seat.`,
        )
      }

      const restriction = restrictionByPassenger.get(assignment.passengerId)
      if (!restriction) {
        return assignmentFailure('passenger_not_found', 'We cannot find that passenger.')
      }
      if (seat.isExitRow && !restriction.canUseExitRow) {
        const passenger = context.passengers.find(
          (candidate) => candidate.id === assignment.passengerId,
        )
        return assignmentFailure(
          'exit_row_child',
          `Seat ${seat.id} is in an exit row. Exit rows are for adults only, so ${
            passenger?.firstName ?? 'this passenger'
          } cannot sit there.`,
        )
      }
    }

    const currentSeatByPassenger = new Map(
      context.passengers.map((passenger) => [passenger.id, passenger.seatId]),
    )
    const holderBySeat = new Map<string, string>()
    for (const passenger of context.passengers) {
      if (passenger.seatId) holderBySeat.set(passenger.seatId, passenger.id)
    }

    const pending = normalizedAssignments.filter(
      (assignment) => currentSeatByPassenger.get(assignment.passengerId) !== assignment.seatId,
    )
    const ordered: PartySeatAssignment[] = []

    while (pending.length > 0) {
      const index = pending.findIndex((assignment) => {
        const holder = holderBySeat.get(assignment.seatId)
        return !holder || holder === assignment.passengerId
      })
      if (index === -1) {
        return assignmentFailure(
          'invalid_seat_block',
          'These seats cannot be exchanged safely. Please choose another block.',
        )
      }

      const [assignment] = pending.splice(index, 1)
      if (!assignment) break

      const currentSeat = currentSeatByPassenger.get(assignment.passengerId)
      if (currentSeat) holderBySeat.delete(currentSeat)
      holderBySeat.set(assignment.seatId, assignment.passengerId)
      currentSeatByPassenger.set(assignment.passengerId, assignment.seatId)
      ordered.push(assignment)
    }

    const applied: Array<Extract<AssignSeatResult, { ok: true }>> = []

    for (const assignment of ordered) {
      const result = await assignSeat(assignment.passengerId, assignment.seatId)
      if (!result.ok) {
        for (const completed of [...applied].reverse()) {
          if (completed.previousSeatId) {
            await assignSeat(completed.passengerId, completed.previousSeatId)
          }
        }
        return assignmentFailure(
          result.reason === 'seat_booked' ||
            result.reason === 'seat_blocked' ||
            result.reason === 'seat_not_found' ||
            result.reason === 'passenger_not_found' ||
            result.reason === 'exit_row_child'
            ? result.reason
            : 'assignment_failed',
          result.message,
        )
      }
      applied.push(result)
    }

    const appliedByPassenger = new Map(
      applied.map((result) => [result.passengerId, result]),
    )
    const completedAssignments = await Promise.all(
      normalizedAssignments.map(async (assignment) => {
        const appliedResult = appliedByPassenger.get(assignment.passengerId)
        const priceCents =
          appliedResult?.priceCents ??
          (await calculateSeatPrice(flightId, assignment.seatId)) ??
          0
        return {
          passengerId: assignment.passengerId,
          seatId: assignment.seatId,
          previousSeatId:
            appliedResult?.previousSeatId ??
            context.passengers.find(
              (passenger) => passenger.id === assignment.passengerId,
            )?.seatId ??
            null,
          priceCents,
        }
      }),
    )

    return {
      ok: true,
      assignments: completedAssignments,
      totalPriceCents: completedAssignments.reduce(
        (total, assignment) => total + assignment.priceCents,
        0,
      ),
    }
  })
}

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
