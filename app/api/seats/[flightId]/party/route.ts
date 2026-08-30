import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  type SeatPartyAssignment,
} from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function readPassengerIds(request: Request): string[] {
  const searchParams = new URL(request.url).searchParams
  return [
    ...searchParams.getAll('passengerId'),
    ...searchParams
      .getAll('passengerIds')
      .flatMap((value) => value.split(',')),
  ]
    .map((passengerId) => passengerId.trim())
    .filter(Boolean)
}

function isPartyAssignment(value: unknown): value is SeatPartyAssignment {
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
  if (
    reason === 'flight_not_found' ||
    reason === 'passenger_not_found' ||
    reason === 'seat_not_found'
  ) {
    return 404
  }

  if (
    reason === 'seat_booked' ||
    reason === 'seat_blocked' ||
    reason === 'assignment_cycle'
  ) {
    return 409
  }

  if (
    reason === 'seats_not_together' ||
    reason === 'adult_required' ||
    reason === 'exit_row_child'
  ) {
    return 422
  }

  return 400
}

export async function GET(request: Request, { params }: RouteContext) {
  const { flightId } = await params
  const passengerIds = readPassengerIds(request)

  if (passengerIds.length === 0) {
    return NextResponse.json(
      {
        error: 'passengerIds_required',
        message: 'Choose at least one passenger to find seats together.',
      },
      { status: 400 },
    )
  }

  const options = await findSeatsForParty(flightId, passengerIds)
  return NextResponse.json({ flightId, passengerIds, options })
}

export async function POST(request: Request, { params }: RouteContext) {
  const { flightId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        error: 'invalid_json',
        message: 'Send the party assignments as JSON.',
      },
      { status: 400 },
    )
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      {
        error: 'assignments_required',
        message: 'Choose passengers and seats before saving.',
      },
      { status: 400 },
    )
  }

  const assignments = (body as Record<string, unknown>).assignments
  if (
    !Array.isArray(assignments) ||
    assignments.length === 0 ||
    !assignments.every(isPartyAssignment)
  ) {
    return NextResponse.json(
      {
        error: 'assignments_required',
        message: 'Choose one seat for each passenger before saving.',
      },
      { status: 400 },
    )
  }

  const passengerIds = assignments.map((assignment) => assignment.passengerId)
  const seatIds = assignments.map((assignment) => assignment.seatId)
  const result = await assignSeatsForParty(flightId, passengerIds, seatIds)

  if (!result.ok) {
    return NextResponse.json(
      { ...result, error: result.reason },
      { status: failureStatus(result.reason) },
    )
  }

  return NextResponse.json(result)
}
