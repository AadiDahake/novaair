import type { Metadata } from 'next'
import Link from 'next/link'
import { FindBookingForm } from '../../components/booking/FindBookingForm'
import { CabinIllustration } from '../../components/ui/PlaneIllustration'

export const metadata: Metadata = { title: 'My Booking' }

export default function MyBookingPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,460px)_1fr] lg:items-start">
      <div>
        <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-navy">
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
          <Link href="/help/changes-and-refunds" className="font-semibold text-blue underline">
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
          <h2 id="demo-heading" className="text-base font-bold text-navy">
            This is a demonstration site
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-navy-soft">
            NovaAir is fictional. One booking exists on it. Use confirmation code{' '}
            <strong className="font-bold">NVA7K2</strong> and last name{' '}
            <strong className="font-bold">Dahake</strong> to open it.
          </p>
        </section>
      </div>
    </div>
  )
}
