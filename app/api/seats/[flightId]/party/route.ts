import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  type PartySeatAssignment,
} from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function isPartySeatAssignment(value: unknown): value is PartySeatAssignment {
  if (!value || typeof value !== 'object') return false

  const assignment = value as Record<string, unknown>
  return (
    typeof assignment.passengerId === 'string' &&
    assignment.passengerId.trim().length > 0 &&
    typeof assignment.seatId === 'string' &&
    assignment.seatId.trim().length > 0
  )
}

function failureStatus(reason: string): number {
  switch (reason) {
    case 'flight_not_found':
    case 'party_not_found':
    case 'passenger_not_found':
    case 'seat_not_found':
      return 404
    case 'seat_booked':
    case 'seat_blocked':
      return 409
    case 'adult_required':
    case 'exit_row_child':
    case 'seats_not_together':
      return 422
    default:
      return 400
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const { searchParams } = new URL(request.url)
  const reservationCode = searchParams.get('reservationCode')?.trim()

  if (!reservationCode) {
    return NextResponse.json(
      {
        error: 'reservationCode_query_required',
        message: 'Enter a reservation code to find seats together.',
      },
      { status: 400 },
    )
  }

  const options = await findSeatsForParty(flightId, reservationCode)
  return NextResponse.json({ flightId, options })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const body = (await request.json().catch(() => null)) as
    | { assignments?: unknown }
    | null
  const assignments = body?.assignments

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return NextResponse.json(
      {
        error: 'assignments_required',
        message: 'Choose seats for the party before confirming.',
      },
      { status: 400 },
    )
  }

  if (!assignments.every(isPartySeatAssignment)) {
    return NextResponse.json(
      {
        error: 'invalid_assignments',
        message: 'Each assignment needs a passenger and a seat.',
      },
      { status: 400 },
    )
  }

  const result = await assignSeatsForParty(flightId, assignments)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message },
      { status: failureStatus(result.reason) },
    )
  }

  return NextResponse.json(result)
}
