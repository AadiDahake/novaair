import { describe, expect, it } from 'vitest'
import { HELP_ARTICLES, getHelpArticle, getHelpSlugs } from '../lib/help/articles'

describe('the help center', () => {
  it('has the six articles the site links to', () => {
    expect(getHelpSlugs()).toEqual([
      'how-do-i-change-my-seat',
      'seat-selection-fees',
      'traveling-with-children',
      'baggage-allowance',
      'check-in',
      'changes-and-refunds',
    ])
  })

  it('gives every article a title, a summary and at least one section', () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title.length).toBeGreaterThan(0)
      expect(article.summary.length).toBeGreaterThan(0)
      expect(article.sections.length).toBeGreaterThan(0)
      for (const section of article.sections) expect(section.body.length).toBeGreaterThan(0)
    }
  })

  it('returns null for a slug that does not exist', () => {
    expect(getHelpArticle('nope')).toBeNull()
  })

  it('says a child must sit next to an adult, and that seats change one at a time', () => {
    const article = getHelpArticle('traveling-with-children')
    const text = article?.sections.flatMap((section) => section.body).join(' ') ?? ''
    expect(text).toContain('must sit next to an adult')
    expect(text).toContain('one passenger at a time')
  })

  it('never promises to seat a group together automatically', () => {
    const text = HELP_ARTICLES.flatMap((article) => [
      article.title,
      article.summary,
      ...article.sections.flatMap((section) => [section.heading, ...section.body]),
    ])
      .join(' ')
      .toLowerCase()

    for (const phrase of [
      'seats together automatically',
      'automatically find',
      'find seats together',
      'seat your party together',
      'seat my family together',
      'family seating feature',
      'group seating feature',
    ]) {
      expect(text).not.toContain(phrase)
    }
  })
})
