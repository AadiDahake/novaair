/**
 * The Next.js ambient types, referenced by hand.
 *
 * `next build` writes `next-env.d.ts` with the same two references plus a hard path into whichever
 * output directory that build used. That path breaks a fresh clone and flips between the normal
 * build and the end-to-end build, so `next-env.d.ts` is a build artifact here and this file is the
 * committed source of the references.
 */
/// <reference types="next" />
/// <reference types="next/image-types/global" />
