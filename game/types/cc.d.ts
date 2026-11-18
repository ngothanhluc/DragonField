/**
 * Stub for the Cocos Creator `cc` module.
 *
 * The repo does NOT commit the engine's real types: `temp/tsconfig.cocos.json` (editor-generated)
 * points into `library/`, both gitignored, so CI cannot resolve `cc`.
 *
 * Therefore `tsc --noEmit` treats `cc` as an any module:
 *  - still catches type/logic errors in our own code
 *  - does NOT check the Cocos API → the editor is the source of truth for that part
 *
 * Do not add content to this file to "fix" errors. If you need engine types,
 * open the project in the editor then use `npm run typecheck:all`.
 */
declare module 'cc';
