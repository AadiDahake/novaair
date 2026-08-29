import Link from 'next/link'

export default function TripNotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-[2.5rem] font-extrabold tracking-tight text-navy">
        We cannot find that booking
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[0.98rem] leading-relaxed text-ink-muted">
        Check the confirmation code and try again. A code has six letters and numbers.
      </p>
      <Link href="/my-booking" className="pill pill-primary mt-7 px-7 py-3.5">
        Go to My Booking
      </Link>
    </div>
  )
}
