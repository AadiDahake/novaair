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
 * The server-side seat primitives and seat-party compositions.
 *
 * Each primitive does a single job. `findSeatsForParty` composes the read primitives to rank valid
 * adjacent blocks, and `assignSeatsForParty` composes assignment with validation and rollback so a
 * party moves together or remains in its previous seats.
 *
 * `AGENTS.md`, under "Adding seat-party capabilities", describes the invariants, and
 * `tests/seat-party.test.ts` enforces them.
 */

export interface PartySeatAssignment {
  passengerId: string
  seatId: string
}

export interface PartySeatOption {
  row: number
  seatIds: string[]
  assignments: PartySeatAssignment[]
  extraCostCents: number
  totalPriceCents: number
}

export interface AssignSeatsForPartySuccess {
  ok: true
  assignments: AssignSeatResult[]
  totalPriceCents: number
}

export interface AssignSeatsForPartyFailure {
  ok: false
  reason: string
  message: string
}

export type AssignSeatsForPartyResult =
  | AssignSeatsForPartySuccess
  | AssignSeatsForPartyFailure

type PartyInput = string | readonly string[] | readonly Passenger[]

function effectiveState(baseState: Seat['baseState'], occupied: boolean): SeatState {
  if (baseState === 'blocked') return 'blocked'
  if (baseState === 'booked') return 'booked'
  return occupied ? 'occupied' : 'available'
}

function isPassenger(value: string | Passenger): value is Passenger {
  return typeof value !== 'string'
}

function areSeatsTogether(seats: readonly Seat[]): boolean {
  if (seats.length === 0) return false

  const row = seats[0]?.row
  if (row === undefined || seats.some((seat) => seat.row !== row)) return false

  const columns = seats.map((seat) => seat.column)
  const side = LEFT_COLUMNS.includes(columns[0] as (typeof LEFT_COLUMNS)[number])
    ? LEFT_COLUMNS
    : RIGHT_COLUMNS.includes(columns[0] as (typeof RIGHT_COLUMNS)[number])
      ? RIGHT_COLUMNS
      : null
  if (!side || columns.some((column) => !side.includes(column as never))) return false

  const indexes = columns.map((column) => side.indexOf(column as never)).sort((a, b) => a - b)
  return indexes.every((index, position) => position === 0 || index === indexes[position - 1]! + 1)
}

async function resolveParty(flightId: string, party: PartyInput): Promise<Passenger[] | null> {
  if (typeof party === 'string') {
    const reservation = await getReservationByCode(party)
    if (!reservation || reservation.flight.id !== flightId) return null
    return reservation.passengers
  }

  if (party.length === 0) return null

  let passengers: Passenger[]
  if (party.every(isPassenger)) {
    passengers = [...party]
  } else if (party.every((entry) => typeof entry === 'string')) {
    const records = await Promise.all(
      party.map((passengerId) => getRepository().getPassenger(passengerId)),
    )
    if (records.some((passenger) => passenger === null)) return null
    passengers = records.filter((passenger): passenger is Passenger => passenger !== null)
  } else {
    return null
  }

  if (new Set(passengers.map((passenger) => passenger.id)).size !== passengers.length) return null

  const reservationCodes = new Set(passengers.map((passenger) => passenger.reservationCode))
  if (reservationCodes.size !== 1) return null

  const reservationCode = passengers[0]?.reservationCode
  if (!reservationCode) return null

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) return null

  const reservationPassengerIds = new Set(
    reservation.passengers.map((passenger) => passenger.id),
  )
  if (passengers.some((passenger) => !reservationPassengerIds.has(passenger.id))) return null

  return passengers
}

async function resolvePartyWithFlight(
  party: PartyInput,
): Promise<{ flightId: string; passengers: Passenger[] } | null> {
  if (typeof party === 'string') {
    const reservation = await getReservationByCode(party)
    if (!reservation) return null
    return {
      flightId: reservation.flight.id,
      passengers: reservation.passengers,
    }
  }

  if (party.length === 0) return null

  let reservationCode: string | null = null
  if (party.every(isPassenger)) {
    const reservationCodes = new Set(party.map((passenger) => passenger.reservationCode))
    if (reservationCodes.size !== 1) return null
    reservationCode = party[0]?.reservationCode ?? null
  } else if (party.every((entry) => typeof entry === 'string')) {
    const firstPassengerId = party[0]
    if (!firstPassengerId) return null
    const passenger = await getRepository().getPassenger(firstPassengerId)
    reservationCode = passenger?.reservationCode ?? null
  } else {
    return null
  }

  if (!reservationCode) return null

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation) return null

  const passengers = await resolveParty(reservation.flight.id, party)
  if (!passengers) return null

  return {
    flightId: reservation.flight.id,
    passengers,
  }
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
 * Find available adjacent seats for every passenger in a party.
 *
 * Every option is in one row, uses consecutive columns on one side of the aisle, satisfies each
 * passenger's restrictions, and is ranked by total extra cost.
 */
export async function findSeatsForParty(
  flightId: string,
  party: PartyInput,
): Promise<PartySeatOption[]> {
  const passengers = await resolveParty(flightId, party)
  if (!passengers || passengers.length === 0) return []

  const [seatMap, availableSeatIds, restrictions] = await Promise.all([
    getSeatMap(flightId),
    getAvailableSeats(flightId),
    Promise.all(
      passengers.map((passenger) => getPassengerRestrictions(passenger.id)),
    ),
  ])
  if (!seatMap || restrictions.some((restriction) => restriction === null)) return []

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some(
    (restriction) => restriction.type === 'adult',
  )
  if (
    passengerRestrictions.some(
      (restriction) => restriction.mustSitWithAdult && !hasAdult,
    )
  ) {
    return []
  }

  const available = new Set(availableSeatIds)
  const options: PartySeatOption[] = []

  for (const row of seatMap.rows) {
    if (
      row.isExitRow &&
      passengerRestrictions.some((restriction) => !restriction.canUseExitRow)
    ) {
      continue
    }

    for (const side of [row.left, row.right]) {
      if (passengers.length > side.length) continue

      for (let start = 0; start <= side.length - passengers.length; start += 1) {
        const seats = side.slice(start, start + passengers.length)
        if (
          seats.length !== passengers.length ||
          !areSeatsTogether(seats) ||
          seats.some((seat) => !available.has(seat.id))
        ) {
          continue
        }

        const prices = await Promise.all(
          seats.map((seat) => calculateSeatPrice(flightId, seat.id)),
        )
        if (prices.some((price) => price === null)) continue

        const seatIds = seats.map((seat) => seat.id)
        const extraCostCents = prices.reduce<number>(
          (total, price) => total + (price ?? 0),
          0,
        )
        options.push({
          row: row.row,
          seatIds,
          assignments: passengers.map((passenger, index) => ({
            passengerId: passenger.id,
            seatId: seatIds[index]!,
          })),
          extraCostCents,
          totalPriceCents: extraCostCents,
        })
      }
    }
  }

  return options.sort(
    (left, right) =>
      left.extraCostCents - right.extraCostCents ||
      left.row - right.row ||
      left.seatIds.join('').localeCompare(right.seatIds.join('')),
  )
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
    return { ok: false, reason: 'seat_not_found', message: `Seat ${normalizedSeatId} is not on this aircraft.` }
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

/**
 * Assign an adjacent block to a party in one operation.
 *
 * All assignments are validated before the first passenger moves. If a write then fails, completed
 * writes are rolled back in reverse order so every passenger keeps the seat they had before.
 */
export function assignSeatsForParty(
  flightId: string,
  assignments: readonly PartySeatAssignment[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  flightId: string,
  party: PartyInput,
  seatIds: readonly string[],
): Promise<AssignSeatsForPartyResult>
export function assignSeatsForParty(
  party: PartyInput,
  seatIds: readonly string[],
): Promise<AssignSeatsForPartyResult>
export async function assignSeatsForParty(
  flightIdOrParty: string | PartyInput,
  assignmentsOrPartyOrSeatIds: readonly PartySeatAssignment[] | PartyInput | readonly string[],
  seatIds?: readonly string[],
): Promise<AssignSeatsForPartyResult> {
  let flightId: string
  let assignments: readonly PartySeatAssignment[]

  if (seatIds !== undefined) {
    flightId = flightIdOrParty as string
    const passengers = await resolveParty(flightId, assignmentsOrPartyOrSeatIds as PartyInput)
    if (!passengers || passengers.length !== seatIds.length) {
      return {
        ok: false,
        reason: 'party_not_found',
        message: 'We cannot find every passenger in that party.',
      }
    }

    assignments = passengers.map((passenger, index) => ({
      passengerId: passenger.id,
      seatId: seatIds[index] ?? '',
    }))
  } else {
    const secondArgument = assignmentsOrPartyOrSeatIds as
      | readonly PartySeatAssignment[]
      | readonly string[]
    const containsOnlySeatIds = secondArgument.every(
      (entry) => typeof entry === 'string',
    )
    const firstArgumentIsParty = typeof flightIdOrParty !== 'string'
    const firstArgumentIsReservation =
      typeof flightIdOrParty === 'string' &&
      containsOnlySeatIds &&
      !(await getRepository().getFlight(flightIdOrParty))

    if (firstArgumentIsParty || firstArgumentIsReservation) {
      const resolved = await resolvePartyWithFlight(flightIdOrParty as PartyInput)
      if (!resolved || resolved.passengers.length !== secondArgument.length) {
        return {
          ok: false,
          reason: 'party_not_found',
          message: 'We cannot find every passenger in that party.',
        }
      }

      flightId = resolved.flightId
      assignments = resolved.passengers.map((passenger, index) => ({
        passengerId: passenger.id,
        seatId: (secondArgument[index] as string | undefined) ?? '',
      }))
    } else {
      flightId = flightIdOrParty as string
      assignments = secondArgument as readonly PartySeatAssignment[]
    }
  }

  if (assignments.length === 0) {
    return {
      ok: false,
      reason: 'assignments_required',
      message: 'Choose seats for the party before confirming.',
    }
  }

  if (
    assignments.some(
      (assignment) =>
        typeof assignment.passengerId !== 'string' ||
        assignment.passengerId.trim().length === 0 ||
        typeof assignment.seatId !== 'string' ||
        assignment.seatId.trim().length === 0,
    )
  ) {
    return {
      ok: false,
      reason: 'invalid_assignments',
      message: 'Each assignment needs a passenger and a seat.',
    }
  }

  const normalizedAssignments = assignments.map((assignment) => ({
    passengerId: assignment.passengerId,
    seatId: assignment.seatId.trim().toUpperCase(),
  }))

  if (
    new Set(normalizedAssignments.map((assignment) => assignment.passengerId)).size !==
    normalizedAssignments.length
  ) {
    return {
      ok: false,
      reason: 'duplicate_passenger',
      message: 'Choose one seat for each passenger.',
    }
  }

  if (
    new Set(normalizedAssignments.map((assignment) => assignment.seatId)).size !==
    normalizedAssignments.length
  ) {
    return {
      ok: false,
      reason: 'duplicate_seat',
      message: 'Each passenger needs a different seat.',
    }
  }

  const passengers = await resolveParty(
    flightId,
    normalizedAssignments.map((assignment) => assignment.passengerId),
  )
  if (!passengers || passengers.length !== normalizedAssignments.length) {
    return {
      ok: false,
      reason: 'party_not_found',
      message: 'We cannot find every passenger in that party.',
    }
  }

  const [seatMap, restrictions] = await Promise.all([
    getSeatMap(flightId),
    Promise.all(
      normalizedAssignments.map((assignment) =>
        getPassengerRestrictions(assignment.passengerId),
      ),
    ),
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
      message: 'We cannot find every passenger in that party.',
    }
  }

  const passengerRestrictions = restrictions.filter(
    (restriction): restriction is PassengerRestrictions => restriction !== null,
  )
  const hasAdult = passengerRestrictions.some(
    (restriction) => restriction.type === 'adult',
  )
  if (
    passengerRestrictions.some(
      (restriction) => restriction.mustSitWithAdult && !hasAdult,
    )
  ) {
    return {
      ok: false,
      reason: 'adult_required',
      message: 'A child under 13 must sit with an adult on this booking.',
    }
  }

  const seatById = new Map<string, Seat>()
  for (const row of seatMap.rows) {
    for (const seat of [...row.left, ...row.right]) seatById.set(seat.id, seat)
  }

  const seats: Seat[] = []
  for (const assignment of normalizedAssignments) {
    const seat = seatById.get(assignment.seatId)
    if (!seat) {
      return {
        ok: false,
        reason: 'seat_not_found',
        message: `Seat ${assignment.seatId} is not on this aircraft.`,
      }
    }
    seats.push(seat)
  }

  if (!areSeatsTogether(seats)) {
    return {
      ok: false,
      reason: 'seats_not_together',
      message: 'Choose consecutive seats in one row on the same side of the aisle.',
    }
  }

  for (let index = 0; index < normalizedAssignments.length; index += 1) {
    const assignment = normalizedAssignments[index]!
    const seat = seats[index]!
    const restriction = passengerRestrictions[index]!

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
    if (
      seat.state !== 'available' &&
      !(
        seat.state === 'occupied' &&
        seat.occupantPassengerId === assignment.passengerId
      )
    ) {
      return {
        ok: false,
        reason: 'seat_booked',
        message: `Seat ${seat.id} is already taken. Please pick another seat.`,
      }
    }
    if (seat.isExitRow && !restriction.canUseExitRow) {
      const passenger = passengers.find(
        (candidate) => candidate.id === assignment.passengerId,
      )
      return {
        ok: false,
        reason: 'exit_row_child',
        message: `Seat ${seat.id} is in an exit row. Exit rows are for adults only, so ${passenger?.firstName ?? 'this passenger'} cannot sit there.`,
      }
    }
  }

  const prices = await Promise.all(
    normalizedAssignments.map((assignment) =>
      calculateSeatPrice(flightId, assignment.seatId),
    ),
  )
  if (prices.some((price) => price === null)) {
    return {
      ok: false,
      reason: 'seat_not_found',
      message: 'One of those seats is not on this aircraft.',
    }
  }

  const completed: Array<Extract<AssignSeatResult, { ok: true }>> = []
  for (const assignment of normalizedAssignments) {
    const result = await assignSeat(assignment.passengerId, assignment.seatId)
    if (!result.ok) {
      for (const previous of [...completed].reverse()) {
        if (previous.previousSeatId) {
          await assignSeat(previous.passengerId, previous.previousSeatId)
        }
      }
      return result
    }
    completed.push(result)
  }

  return {
    ok: true,
    assignments: completed,
    totalPriceCents: prices.reduce<number>(
      (total, price) => total + (price ?? 0),
      0,
    ),
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

export type { Passenger, Reservation, Seat, SeatMap, SeatRow }
