import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Testimonials' }

const QUOTES = [
  {
    quote:
      'The seat map shows the whole cabin before you pay. I knew exactly what I was getting.',
    name: 'R. Alvarez',
    route: 'SFO to JFK',
  },
  {
    quote: 'Bag drop took four minutes. The crew found space for my cello without a fuss.',
    name: 'T. Whitfield',
    route: 'BOS to SFO',
  },
  {
    quote: 'I moved my seat twice from my phone the night before. Nothing was hidden behind a fee.',
    name: 'J. Okonkwo',
    route: 'DEN to MIA',
  },
  {
    quote: 'Delayed by weather, rebooked before I reached the desk. That is how it should work.',
    name: 'M. Bergstrom',
    route: 'SEA to JFK',
  },
]

export default function TestimonialsPage() {
  return (
    <div>
      <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-ink">
        Testimonials
      </h1>
      <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-ink-muted">
        What NovaAir customers say. These quotes are invented for a product demonstration.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {QUOTES.map((entry) => (
          <figure key={entry.name} className="card p-7">
            <blockquote className="text-[1.05rem] font-medium leading-relaxed text-ink">
              &ldquo;{entry.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-tint text-sm font-bold text-blue-soft"
              >
                {entry.name.slice(0, 1)}
              </span>
              <span>
                <span className="block text-sm font-bold text-ink">{entry.name}</span>
                <span className="block text-xs text-ink-muted">{entry.route}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
