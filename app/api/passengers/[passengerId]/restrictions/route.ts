import { NextResponse } from 'next/server'
import { getPassengerRestrictions } from '../../../../../lib/seats'

export const dynamic = 'force-dynamic'

/** GET /api/passengers/{passengerId}/restrictions - what one passenger may and may not do. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ passengerId: string }> },
) {
  const { passengerId } = await params
  const restrictions = await getPassengerRestrictions(passengerId)
  if (!restrictions) {
    return NextResponse.json({ error: 'passenger_not_found' }, { status: 404 })
  }
  return NextResponse.json(restrictions)
}
