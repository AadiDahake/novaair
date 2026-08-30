import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-soft">Page not found</p>
      <h1 className="mt-3 text-[2.8rem] font-extrabold tracking-tight text-ink">
        This page has taken off without us
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[0.98rem] leading-relaxed text-ink-muted">
        Check the address, or start again from the home page.
      </p>
      <Link href="/" className="pill pill-primary mt-8 px-7 py-3.5">
        Go to the home page
      </Link>
    </div>
  )
}
