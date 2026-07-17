// Canonical ticket -> repo matching now lives in src/main/config/repos.ts; this
// module re-exports it so the watcher (and its test) keep working until the watch
// subsystem is removed in the cutover phase.
export { findRepoForTicket } from '../main/config/repos'
