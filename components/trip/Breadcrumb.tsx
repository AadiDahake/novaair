import Link from 'next/link'

/**
 * The trip breadcrumb. "Manage Trip" stays a real link on every trip page, including the trip page
 * itself, so it is always a control with that exact accessible name.
 */
export function TripBreadcrumb({ code, current }: { code: string; current: 'trip' | 'seats' }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center gap-2 text-sm text-ink-muted">
        <li>
          <Link href="/" className="transition-colors hover:text-navy">
            Home
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link
            href={`/trips/${code}`}
            aria-current={current === 'trip' ? 'page' : undefined}
            className={
              current === 'trip'
                ? 'font-semibold text-navy'
                : 'transition-colors hover:text-navy'
            }
          >
            Manage Trip
          </Link>
        </li>
        {current === 'seats' ? (
          <>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-navy" aria-current="page">
              Choose Seats
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  )
}
