'use client'

import { useEffect } from 'react'
import { capture } from '../../lib/analytics/client'

/** Sends `help_article_viewed` once for each article the reader opens. */
export function HelpArticleTracker({ slug }: { slug: string }) {
  useEffect(() => {
    capture('help_article_viewed', { slug })
  }, [slug])
  return null
}
