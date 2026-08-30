import {
  assignSeatsForParty,
  findSeatsForParty,
  getPassengerRestrictions,
} from '../../../../../lib/seats'

interface RouteContext {
  params: Promise<{ flightId: string }>
}

interface PartyAssignment {
  passengerId?: unknown
  seatId?: unknown
}

interface PartyRequestBody {
  passengerIds?: unknown
  seatIds?: unknown
  assignments?: unknown
}

interface PartyBlock {
  seatIds?: unknown
  seats?: unknown
  row?: unknown
  totalPriceCents?: unknown
  priceCents?: unknown
  additionalCostCents?: unknown
  extraCostCents?: unknown
}

function errorResponse(error: string, message: string, status: number): Response {
  return Response.json({ ok: false, error, reason: error, message }, { status })
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

function numericValue(...values: unknown[]): number {
  return values.find((value): value is number => typeof value === 'number') ?? 0
}

function normalizePartyBlock(block: PartyBlock) {
  const seatIds = Array.isArray(block.seatIds)
    ? block.seatIds.filter((seatId): seatId is string => typeof seatId === 'string')
    : Array.isArray(block.seats)
      ? block.seats.filter((seatId): seatId is string => typeof seatId === 'string')
      : []
  const parsedRow = Number.parseInt(seatIds[0] ?? '', 10)
  const row =
    typeof block.row === 'number' && Number.isFinite(block.row)
      ? block.row
      : Number.isFinite(parsedRow)
        ? parsedRow
        : 0
  const totalPriceCents = numericValue(
    block.totalPriceCents,
    block.extraCostCents,
    block.additionalCostCents,
    block.priceCents,
  )

  return {
    ...block,
    seatIds,
    seats: seatIds,
    row,
    totalPriceCents,
    priceCents: totalPriceCents,
    additionalCostCents: totalPriceCents,
    extraCostCents: totalPriceCents,
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { flightId } = await context.params
  const passengerIds = readPassengerIds(request)

  if (passengerIds.length === 0 || new Set(passengerIds).size !== passengerIds.length) {
    return errorResponse(
      'invalid_passengers',
      'Choose valid passengers before finding seats together.',
      400,
    )
  }

  const restrictions = await Promise.all(
    passengerIds.map((passengerId) => getPassengerRestrictions(passengerId)),
  )
  if (restrictions.some((restriction) => restriction === null)) {
    return errorResponse(
      'invalid_passengers',
      'One or more passengers could not be found. Please reopen your trip and try again.',
      400,
    )
  }

  const blocks = (await findSeatsForParty(flightId, passengerIds))
    .map((block) => normalizePartyBlock(block))
    .sort((left, right) => left.extraCostCents - right.extraCostCents)
  return Response.json({ flightId, passengerIds, blocks })
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { flightId } = await context.params

  let body: PartyRequestBody
  try {
    body = (await request.json()) as PartyRequestBody
  } catch {
    return errorResponse('invalid_request', 'Send a valid JSON request.', 400)
  }

  let passengerIds: string[]
  let seatIds: string[]

  if (Array.isArray(body.assignments)) {
    const assignments = body.assignments as PartyAssignment[]
    passengerIds = assignments.map((assignment) =>
      typeof assignment?.passengerId === 'string' ? assignment.passengerId : '',
    )
    seatIds = assignments.map((assignment) =>
      typeof assignment?.seatId === 'string' ? assignment.seatId : '',
    )
  } else {
    passengerIds = Array.isArray(body.passengerIds)
      ? body.passengerIds.map((passengerId) =>
          typeof passengerId === 'string' ? passengerId : '',
        )
      : []
    seatIds = Array.isArray(body.seatIds)
      ? body.seatIds.map((seatId) => (typeof seatId === 'string' ? seatId : ''))
      : []
  }

  const result = await assignSeatsForParty(flightId, passengerIds, seatIds)
  if (result.ok) return Response.json(result)

  const status =
    result.reason === 'invalid_passengers'
      ? 400
      : result.reason === 'invalid_seat_block'
        ? 422
        : 409

  return Response.json(result, { status })
}
