/**
 * ESM view of `withEarmark`, for `next.config.mjs` and `next.config.ts`.
 *
 * The implementation stays in CommonJS because webpack and Turbopack require()
 * the loader beside it; this is a re-export, not a second copy.
 */

import withEarmark from './next.cjs';

export { withEarmark };
export default withEarmark;
