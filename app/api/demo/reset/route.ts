import { NextResponse } from 'next/server'
import { getRepository } from '../../../../lib/repo'

export const dynamic = 'force-dynamic'

/**
 * POST /api/demo/reset - put the demo booking back to seats 12A, 18C and 24F.
 *
 * This exists because the in-memory store lives inside the running server, so a script cannot
 * reach it from outside. On Supabase the same job is done by `npm run db:reset-demo`, which writes
 * to the database directly.
 */
export async function POST() {
  const repository = getRepository()
  if (repository.kind !== 'memory') {
    return NextResponse.json(
      { error: 'not_supported', message: 'Run `npm run db:reset-demo` for the Supabase store.' },
      { status: 409 },
    )
  }
  await repository.resetDemo()
  return NextResponse.json({ ok: true, store: repository.kind })
}
