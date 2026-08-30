import { NextResponse } from 'next/server'
import {
  assignSeatsForParty,
  findSeatsForParty,
  type PartySeatAssignment,
} from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

function readPassengerIds(request: Request): string[] {
  const searchParams = new URL(request.url).searchParams
  const values = [
    ...searchParams.getAll('passengerId'),
    ...searchParams.getAll('passengerIds'),
  ]

  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
}

function isPartySeatAssignment(value: unknown): value is PartySeatAssignment {
  if (!value || typeof value !== 'object') return false

  const assignment = value as Record<string, unknown>
  return (
    typeof assignment.passengerId === 'string' &&
    typeof assignment.seatId === 'string'
  )
}

function failureStatus(reason: string): number {
  if (
    reason === 'passenger_not_found' ||
    reason === 'seat_not_found' ||
    reason === 'flight_not_found'
  ) {
    return 404
  }

  if (
    reason === 'seat_booked' ||
    reason === 'seat_blocked' ||
    reason === 'party_move_conflict'
  ) {
    return 409
  }

  if (
    reason === 'exit_row_child' ||
    reason === 'adult_required' ||
    reason === 'flight_mismatch' ||
    reason === 'passengers_not_in_same_party' ||
    reason === 'seats_not_together'
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
        error: 'passenger_ids_required',
        message: 'Choose the passengers who need seats together.',
      },
      { status: 400 },
    )
  }

  const blocks = (await findSeatsForParty(flightId, passengerIds)).map((block) => ({
    row: block.row,
    seatIds: block.seatIds,
    extraCostCents: block.extraCostCents,
    totalPriceCents: block.totalPriceCents,
  }))
  return NextResponse.json({ flightId, passengerIds, blocks })
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
        message: 'Send the passengers and seats as valid JSON.',
      },
      { status: 400 },
    )
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      {
        error: 'assignments_required',
        message: 'Choose seats for every passenger first.',
      },
      { status: 400 },
    )
  }

  const payload = body as Record<string, unknown>
  const passengerIds = payload.passengerIds
  const seatIds = payload.seatIds
  let assignments: PartySeatAssignment[] | null = null

  if (
    Array.isArray(payload.assignments) &&
    payload.assignments.every(isPartySeatAssignment)
  ) {
    assignments = payload.assignments
  } else if (
    Array.isArray(passengerIds) &&
    passengerIds.every((value): value is string => typeof value === 'string') &&
    Array.isArray(seatIds) &&
    seatIds.every((value): value is string => typeof value === 'string') &&
    passengerIds.length === seatIds.length
  ) {
    assignments = passengerIds.map((passengerId, index) => ({
      passengerId,
      seatId: seatIds[index] ?? '',
    }))
  }

  if (!assignments || assignments.length === 0) {
    return NextResponse.json(
      {
        error: 'assignments_required',
        message: 'Choose seats for every passenger first.',
      },
      { status: 400 },
    )
  }

  const result = await assignSeatsForParty(flightId, assignments)
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.reason,
        reason: result.reason,
        message: result.message,
      },
      { status: failureStatus(result.reason) },
    )
  }

  return NextResponse.json(result)
}
