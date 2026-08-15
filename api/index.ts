// Vercel Function entrypoint for the racehorse-server project. Deployed from
// the repo root (not server/) so npm workspaces can resolve the internal
// @racehorse/game-core package during install/build. The configured
// buildCommand in vercel.json compiles both workspaces to dist/ first, so
// the relative import below resolves to compiled output, not source.
export { default } from '../server/dist/index';
