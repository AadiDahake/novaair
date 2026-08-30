import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRightIcon } from '../../components/ui/icons'
import { HELP_ARTICLES } from '../../lib/help/articles'

export const metadata: Metadata = { title: 'Help center' }

const CATEGORY_ORDER = ['Seats', 'Bags', 'At the airport', 'Your booking'] as const

export default function HelpPage() {
  return (
    <div>
      <h1 className="text-[3rem] font-extrabold leading-none tracking-tight text-ink">
        Help center
      </h1>
      <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-ink-muted">
        Answers to the questions NovaAir customers ask most. Call 1-800-555-0142 if you cannot find
        what you need.
      </p>

      <div className="mt-10 space-y-10">
        {CATEGORY_ORDER.map((category) => {
          const articles = HELP_ARTICLES.filter((article) => article.category === category)
          if (articles.length === 0) return null
          return (
            <section key={category} aria-labelledby={`category-${category.replace(/\s/g, '-')}`}>
              <h2
                id={`category-${category.replace(/\s/g, '-')}`}
                className="text-sm font-bold uppercase tracking-[0.14em] text-ink-muted"
              >
                {category}
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {articles.map((article) => (
                  <li key={article.slug}>
                    <Link
                      href={`/help/${article.slug}`}
                      className="card flex h-full flex-col p-6 transition-colors hover:border-line-hover hover:bg-surface-raised"
                    >
                      <h3 className="text-lg font-bold text-ink">{article.title}</h3>
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
                        {article.summary}
                      </p>
                      <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-soft">
                        Read
                        <ArrowRightIcon size={15} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
