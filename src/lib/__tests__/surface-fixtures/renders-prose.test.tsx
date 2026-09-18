// A component NAMED like a test that the test runner does not collect.
//
// `vitest` collects `src/**/*.test.ts` only, so nothing runs this file. The
// discovery used to drop it from the import graph on its name, which meant a
// page could import it, Next would render it, and no guard would ever read its
// words. This fixture exists so that the graph rule has something to hold on to
// in a repository that otherwise contains no such import.
export function RendersProse() {
  return <p>A component the runner does not collect, reachable only by import.</p>;
}
