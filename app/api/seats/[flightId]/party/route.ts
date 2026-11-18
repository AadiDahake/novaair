import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  getReservationByCode,
} from '../../../../../lib/seats'
import type { AssignSeatsForPartyFailureReason, SeatPartyAssignment } from '../../../../../lib/seats/types'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSeatPartyAssignment(value: unknown): value is SeatPartyAssignment {
  return (
    isRecord(value) &&
    typeof value.passengerId === 'string' &&
    value.passengerId.trim().length > 0 &&
    typeof value.seatId === 'string' &&
    value.seatId.trim().length > 0
  )
}

function failureStatus(reason: AssignSeatsForPartyFailureReason): number {
  switch (reason) {
    case 'reservation_not_found':
    case 'passenger_not_found':
    case 'seat_not_found':
      return 404
    case 'seat_booked':
    case 'seat_blocked':
    case 'assignment_failed':
      return 409
    case 'exit_row_child':
    case 'invalid_party':
    case 'invalid_assignment':
    case 'seats_not_together':
      return 422
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const reservationCode = new URL(request.url).searchParams.get('reservationCode')?.trim()

  if (!reservationCode) {
    return NextResponse.json(
      {
        error: 'reservation_code_required',
        message: 'Enter a reservation code to find seats together.',
      },
      { status: 400 },
    )
  }

  const reservation = await getReservationByCode(reservationCode)
  if (!reservation || reservation.flight.id !== flightId) {
    return NextResponse.json(
      {
        error: 'reservation_not_found',
        message: 'We cannot find that reservation for this flight.',
      },
      { status: 404 },
    )
  }

  const options = await findSeatsForParty(flightId, reservation.code)

  return NextResponse.json(
    {
      flightId,
      reservationCode: reservation.code,
      options,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const body: unknown = await request.json().catch(() => null)

  if (!isRecord(body)) {
    return NextResponse.json(
      {
        error: 'invalid_json',
        message: 'Send a reservation code and one seat assignment for every passenger.',
      },
      { status: 400 },
    )
  }

  const reservationCode =
    typeof body.reservationCode === 'string' ? body.reservationCode.trim() : ''

  if (!reservationCode) {
    return NextResponse.json(
      {
        error: 'reservation_code_required',
        message: 'Enter a reservation code to apply seats together.',
      },
      { status: 400 },
    )
  }

  if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
    return NextResponse.json(
      {
        error: 'assignments_required',
        message: 'Choose one seat for every passenger on this booking.',
      },
      { status: 400 },
    )
  }

  if (!body.assignments.every(isSeatPartyAssignment)) {
    return NextResponse.json(
      {
        error: 'invalid_assignments',
        message: 'Each assignment must include a passenger and a seat.',
      },
      { status: 400 },
    )
  }

  const assignments = body.assignments.map((assignment) => ({
    passengerId: assignment.passengerId.trim(),
    seatId: assignment.seatId.trim().toUpperCase(),
  }))

  const result = await assignSeatsForParty(flightId, reservationCode, assignments)

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.reason,
        message: result.message,
      },
      { status: failureStatus(result.reason) },
    )
  }

  return NextResponse.json(result)
}
