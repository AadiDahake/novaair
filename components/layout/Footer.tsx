import Link from 'next/link'
import { LogoMark } from '../brand/Logo'

const COLUMNS = [
  {
    heading: 'Travel',
    links: [
      { href: '/flights', label: 'Find a flight' },
      { href: '/my-booking', label: 'My Booking' },
      { href: '/help/check-in', label: 'Check-in' },
      { href: '/help/baggage-allowance', label: 'Baggage allowance' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { href: '/help', label: 'Help center' },
      { href: '/help/how-do-i-change-my-seat', label: 'Change my seat' },
      { href: '/help/traveling-with-children', label: 'Traveling with children' },
      { href: '/help/changes-and-refunds', label: 'Changes and refunds' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="mt-12 border-t border-line pt-8">
      <div className="flex flex-wrap justify-between gap-10">
        <div className="max-w-xs">
          <div className="flex items-center gap-2">
            <LogoMark size={26} />
            <span className="text-lg font-bold text-navy">NovaAir</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            NovaAir is a fictional airline. Every flight, price and reservation on this site is
            invented for a product demonstration.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={column.heading}>
            <h2 className="text-sm font-bold text-navy">{column.heading}</h2>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ink-muted transition-colors hover:text-navy"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div>
          <h2 className="text-sm font-bold text-navy">Contact</h2>
          <p className="mt-3 text-sm text-ink-muted">1-800-555-0142</p>
          <p className="mt-1 text-sm text-ink-muted">Every day, 05:00 to 23:00 PT</p>
        </div>
      </div>
      <p className="mt-8 text-xs text-ink-muted">Fictional airline. Not a real air carrier.</p>
    </footer>
  )
}
