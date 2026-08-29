/**
 * Next.js declares `*.module.css` but not a plain global stylesheet. TypeScript 6 rejects a
 * side-effect import of a module it cannot resolve, so declare it here.
 */
declare module '*.css'
