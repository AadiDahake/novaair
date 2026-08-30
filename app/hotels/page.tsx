import type { Metadata } from 'next'
import { CabinIllustration } from '../../components/ui/PlaneIllustration'

export const metadata: Metadata = { title: 'Hotels' }

const HOTELS = [
  { name: 'Harbor House', city: 'New York', nights: 'from $186 a night', tag: 'Near JFK' },
  { name: 'The Marin', city: 'San Francisco', nights: 'from $164 a night', tag: 'Bay view' },
  { name: 'Lakeside Rail', city: 'Chicago', nights: 'from $142 a night', tag: 'Downtown' },
  { name: 'Cascade Court', city: 'Seattle', nights: 'from $158 a night', tag: 'Quiet rooms' },
  { name: 'Camino Blanco', city: 'Austin', nights: 'from $131 a night', tag: 'New' },
  { name: 'Alto Bay', city: 'Miami', nights: 'from $204 a night', tag: 'Beach front' },
]

export default function HotelsPage() {
  return (
    <div>
      <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-ink">Hotels</h1>
      <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-ink-muted">
        Add a room to any NovaAir booking. Every rate below includes taxes and free cancellation up
        to 48 hours before you arrive.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {HOTELS.map((hotel) => (
          <article key={hotel.name} className="card overflow-hidden">
            <CabinIllustration className="h-36 w-full" />
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-bold text-ink">{hotel.name}</h2>
                <span className="rounded-full bg-blue-tint px-3 py-1 text-[0.68rem] font-semibold text-blue-soft">
                  {hotel.tag}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-ink-muted">{hotel.city}</p>
              <p className="mt-4 text-base font-bold text-ink">{hotel.nights}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
