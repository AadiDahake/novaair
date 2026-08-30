import type { Metadata } from 'next'
import Link from 'next/link'
import { FindBookingForm } from '../../components/booking/FindBookingForm'
import { CabinIllustration } from '../../components/ui/PlaneIllustration'
import { RESERVATION_CODE } from '../../lib/seats/constants'
import { DEMO_LAST_NAME } from '../../lib/seats/demo-data'

export const metadata: Metadata = { title: 'My Booking' }

export default function MyBookingPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,460px)_1fr] lg:items-start">
      <div>
        <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-ink">
          My Booking
        </h1>
        <p className="mt-4 text-[0.98rem] leading-relaxed text-ink-muted">
          Find your trip to change seats, add bags or check in. Enter the confirmation code from
          your booking email and the last name on the booking.
        </p>

        <div className="card mt-7 p-7">
          <FindBookingForm />
        </div>

        <p className="mt-5 text-sm text-ink-muted">
          Cannot find your code?{' '}
          <Link href="/help/changes-and-refunds" className="font-semibold text-blue-soft underline">
            Read the help article
          </Link>
          .
        </p>
      </div>

      <div className="space-y-6">
        <div className="overflow-hidden rounded-[24px] border border-line">
          <CabinIllustration className="h-[240px] w-full" />
        </div>

        <section aria-labelledby="demo-heading" className="rounded-[20px] bg-blue-tint p-6">
          <h2 id="demo-heading" className="text-base font-bold text-ink">
            This is a demonstration site
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            NovaAir is fictional. One booking exists on it. Use confirmation code{' '}
            <strong className="font-bold">{RESERVATION_CODE}</strong> and last name{' '}
            <strong className="font-bold">{DEMO_LAST_NAME}</strong> to open it.
          </p>
        </section>
      </div>
    </div>
  )
}
