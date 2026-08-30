import { NextResponse } from 'next/server'
import { getReservation } from '../../../../lib/seats'

export const dynamic = 'force-dynamic'

/**
 * POST /api/reservations/lookup - find one reservation.
 * Body: { "code": "NVA7K2", "lastName": "Altman" }
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { code, lastName } = (body ?? {}) as { code?: unknown; lastName?: unknown }
  if (typeof code !== 'string' || typeof lastName !== 'string') {
    return NextResponse.json({ error: 'code_and_lastName_required' }, { status: 400 })
  }

  const reservation = await getReservation(code, lastName)
  if (!reservation) {
    return NextResponse.json({ error: 'reservation_not_found' }, { status: 404 })
  }
  return NextResponse.json(reservation)
}
