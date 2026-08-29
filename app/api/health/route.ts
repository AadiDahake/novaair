import { NextResponse } from 'next/server'
import { getRepository } from '../../../lib/repo'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    store: getRepository().kind,
    analytics: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    widget: Boolean(
      process.env.NEXT_PUBLIC_PATCHLET_WIDGET_URL && process.env.NEXT_PUBLIC_PATCHLET_KEY,
    ),
  })
}
