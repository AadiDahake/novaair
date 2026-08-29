import Link from 'next/link'
import { SearchForm } from '../components/home/SearchForm'
import { ArrowRightIcon } from '../components/ui/icons'
import { CabinIllustration } from '../components/ui/PlaneIllustration'

const DESTINATIONS = [
  { code: 'JFK', city: 'New York', from: 214, note: 'Nonstop from San Francisco' },
  { code: 'ORD', city: 'Chicago', from: 168, note: 'Up to 6 flights a day' },
  { code: 'MIA', city: 'Miami', from: 232, note: 'New route this autumn' },
]

const PROMISES = [
  {
    title: 'Pick your seat',
    body: 'Every fare lets you choose a standard seat at no extra cost, right up to check-in.',
  },
  {
    title: 'Room where it counts',
    body: 'Bulkhead and exit rows give you more legroom for a small fee, on every aircraft.',
  },
  {
    title: 'Change with care',
    body: 'Cancel within 24 hours for a full refund. Nova Flex fares change with no fee.',
  },
]

export default function HomePage() {
  return (
    <div className="space-y-14">
      <section className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue">
            Fly the bright side
          </p>
          <h1 className="mt-3 text-[3.4rem] font-extrabold leading-[1.03] tracking-tight text-navy">
            Every seat,
            <br />
            in plain sight.
          </h1>
          <p className="mt-5 max-w-md text-[1.05rem] leading-relaxed text-ink-muted">
            NovaAir flies 42 routes across the United States. See the whole cabin before you
            travel, and move a passenger whenever you need to.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/flights" className="pill pill-primary px-7 py-3.5 text-[0.95rem]">
              Find a flight
              <ArrowRightIcon size={16} />
            </Link>
            <Link href="/my-booking" className="pill pill-outline px-7 py-3.5 text-[0.95rem]">
              My Booking
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-line">
          <CabinIllustration className="h-[290px] w-full" />
        </div>
      </section>

      <section aria-labelledby="search-heading" className="card p-7 shadow-[0_18px_50px_-38px_rgba(11,11,43,0.6)]">
        <h2 id="search-heading" className="mb-5 text-xl font-bold text-navy">
          Search flights
        </h2>
        <SearchForm />
      </section>

      <section aria-labelledby="destinations-heading">
        <h2 id="destinations-heading" className="text-2xl font-bold text-navy">
          Where NovaAir flies
        </h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map((destination) => (
            <article key={destination.code} className="card p-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-bold text-navy">{destination.city}</h3>
                <span className="text-sm font-semibold text-ink-muted">{destination.code}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink-muted">{destination.note}</p>
              <p className="mt-5 text-2xl font-extrabold text-blue">
                ${destination.from}
                <span className="ml-1.5 text-xs font-medium text-ink-muted">one way</span>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="promises-heading">
        <h2 id="promises-heading" className="text-2xl font-bold text-navy">
          What every NovaAir fare includes
        </h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PROMISES.map((promise) => (
            <article key={promise.title} className="rounded-[20px] bg-blue-tint p-6">
              <h3 className="text-lg font-bold text-navy">{promise.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-navy-soft">{promise.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
