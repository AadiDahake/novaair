import type { Metadata, Viewport } from 'next'
import { Poppins } from 'next/font/google'
import { PatchletWidget } from '../components/PatchletWidget'
import { Footer } from '../components/layout/Footer'
import { TopNav } from '../components/layout/TopNav'
import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'NovaAir',
    template: '%s | NovaAir',
  },
  description:
    'NovaAir is a fictional airline. Book a flight, manage your trip and choose your seats.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#dbe9ff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <a
          href="#main"
          className="pill pill-dark sr-only px-5 py-2.5 focus:not-sr-only focus:absolute focus:left-6 focus:top-6 focus:z-50"
        >
          Skip to main content
        </a>
        <div className="mx-auto max-w-[1440px] px-6 py-6 xl:px-10 xl:py-8">
          <div className="app-shell px-6 py-6 sm:px-8 sm:py-7 xl:px-10 xl:py-8">
            <TopNav />
            <main id="main">{children}</main>
            <Footer />
          </div>
        </div>
        <PatchletWidget />
      </body>
    </html>
  )
}
