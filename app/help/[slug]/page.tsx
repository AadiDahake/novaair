import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { HelpArticleTracker } from '../../../components/help/HelpArticleTracker'
import { ArrowLeftIcon } from '../../../components/ui/icons'
import { HELP_ARTICLES, getHelpArticle, getHelpSlugs } from '../../../lib/help/articles'

export function generateStaticParams() {
  return getHelpSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = getHelpArticle(slug)
  if (!article) return { title: 'Help center' }
  return { title: article.title, description: article.summary }
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getHelpArticle(slug)
  if (!article) notFound()

  const related = HELP_ARTICLES.filter(
    (entry) => entry.slug !== article.slug && entry.category === article.category,
  ).slice(0, 3)

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
      <article>
        <HelpArticleTracker slug={article.slug} />

        <Link href="/help" className="pill pill-outline px-5 py-2.5 text-[0.85rem]">
          <ArrowLeftIcon size={15} />
          Help center
        </Link>

        <p className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-blue">
          {article.category}
        </p>
        <h1 className="mt-2 max-w-2xl text-[2.6rem] font-extrabold leading-[1.08] tracking-tight text-navy">
          {article.title}
        </h1>
        <p className="mt-4 max-w-2xl text-[1.02rem] leading-relaxed text-ink-muted">
          {article.summary}
        </p>

        <div className="mt-10 space-y-9">
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-bold text-navy">{section.heading}</h2>
              <ul className="mt-3 max-w-2xl space-y-2.5">
                {section.body.map((line) => (
                  <li key={line} className="flex gap-3 text-[0.95rem] leading-relaxed text-navy-soft">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </article>

      <aside className="space-y-6">
        {related.length > 0 ? (
          <section aria-labelledby="related-heading" className="card p-6">
            <h2 id="related-heading" className="text-base font-bold text-navy">
              Related articles
            </h2>
            <ul className="mt-4 space-y-3">
              {related.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={`/help/${entry.slug}`}
                    className="text-sm font-medium text-navy-soft underline transition-colors hover:text-navy"
                  >
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="contact-heading" className="rounded-[20px] bg-blue-tint p-6">
          <h2 id="contact-heading" className="text-base font-bold text-navy">
            Still need help?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-navy-soft">
            Call NovaAir on 1-800-555-0142, every day from 05:00 to 23:00 Pacific Time.
          </p>
          <Link href="/my-booking" className="pill pill-dark mt-5 px-5 py-2.5 text-[0.85rem]">
            Open My Booking
          </Link>
        </section>
      </aside>
    </div>
  )
}
