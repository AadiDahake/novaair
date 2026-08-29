'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Wordmark } from '../brand/Logo'
import { PhoneIcon, TicketIcon } from '../ui/icons'

const LINKS = [
  { href: '/flights', label: 'Flights' },
  { href: '/hotels', label: 'Hotels' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/testimonials', label: 'Testimonials' },
]

export function TopNav() {
  const pathname = usePathname() ?? '/'
  const activeLabel =
    pathname === '/' || pathname.startsWith('/flights') || pathname.startsWith('/trips') || pathname.startsWith('/my-booking')
      ? 'Flights'
      : LINKS.find((link) => pathname.startsWith(link.href))?.label

  return (
    <header className="mb-8 rounded-[999px] border border-line bg-white px-4 py-3 shadow-[0_8px_28px_-22px_rgba(11,11,43,0.5)]">
      <nav aria-label="Main" className="flex items-center justify-between gap-6">
        <Link href="/" aria-label="NovaAir home" className="rounded-full">
          <Wordmark />
        </Link>

        <ul className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => {
            const isActive = link.label === activeLabel
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'text-[0.95rem] font-bold text-navy'
                      : 'text-[0.95rem] font-medium text-ink-muted transition-colors hover:text-navy'
                  }
                >
                  {link.label}
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center gap-2.5">
          <a href="tel:18005550142" className="pill pill-outline px-4 py-2.5 text-[0.85rem]">
            <PhoneIcon />
            Call Us
          </a>
          <Link href="/my-booking" className="pill pill-dark px-5 py-2.5 text-[0.85rem]">
            <TicketIcon />
            My Booking
          </Link>
        </div>
      </nav>
    </header>
  )
}
