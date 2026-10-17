# Validation status

Status as of the initial implementation on 17 October 2026. This file reports performed checks, not the intended release result.

## Completed

- Synthetic JSON consistency: ten source hashes, thirty-one citation references, event chronology, historical durations, and T01–T16 specification coverage passed.
- Root TypeScript check passed.
- Next.js production webpack build passed.
- The latest combined unit run passed 73 tests; four opt-in real graph cases were skipped. A subsequent focused graph run passed all 13 cases, including an additional stored-source-hash check.
- Workspace Lab: nine real file-backed application tests passed, including persistence, concurrent retries, restart recovery, access/expiry evaluation, corruption and exclusive writer ownership.
- Executor: forty-three cases passed together. These use an explicit test graph double and the actual file-backed Lab.
- Runtime: fourteen service-flow tests passed using explicit graph/model doubles and actual Lab persistence.
- Playwright headline test discovery passed.
- All four local services started with `npm run dev -- --embedded`. Logs confirm actual FalkorDB 4.18.3 loaded into Redis 8.4.0; the runtime imported the history and reported graph availability.
- HTTP checks against the running runtime confirmed four people, three cases, fifteen observations, ten sources, zero procedures/approvals, source retrieval, and signed persona selection. A cold operator request persisted as `BLOCKED / NEEDS_TEACHING`, with zero model calls and no receipts or verification. Owner submission was correctly rejected.
- The real authority endpoint replaced Ravi with Leena, closed the old assignment, created revision 2, and increased knowledge revision to 1. A stale revision update was rejected. Owner reset successfully restored both Lab and graph to the cold demo state.
- The Next.js page was served successfully over HTTP. This verifies serving, not visual layout or browser behavior.

## Not yet verified

- Actual FalkorDB Cypher execution and persistence with the pinned Docker image.
- Full graph, Workspace Lab, and runtime HTTP integration suites. This managed session denies test-process TCP connections/listeners with `EPERM`, even while the approved development process is running. The attempted combined run passed fourteen test-double runtime cases; twenty-nine real graph/HTTP cases failed during setup and four graph cases skipped after setup failure. No passing result is claimed for them.
- Sixteen additional runtime HTTP authorization cases are implemented and typechecked; execution remains pending the same local-network permission boundary.
- Live-model induction and three consecutive recorded live rehearsals. API model/key configuration was still empty at the last check.
- Browser interaction and visual verification. Chrome launch aborted under the managed process restrictions; a running preview is available at http://127.0.0.1:3100.
- Docker Compose build/start, public repository publication, working demo video, and participant inspection.

## Environment notes

Local Node.js is v25.2.1. Vitest 5 declares supported Node lines 22.12+, 24, and 26+, so Node 24 LTS is the documented reproducible setup and the container base. Tests executed successfully on the available local Node version, but that does not change the upstream support declaration.

Docker Desktop's executable is missing on this host. Colima is installed but stopped. Starting it from this session was blocked while writing `~/.colima`, and elevated execution was rejected because sandbox approvals are disabled. The official embedded database provides local services without touching Colima. A terminal outside the test-process restriction or a changed session permission profile is still needed for the full integration/browser suites.

The official FalkorDB Docker registry lists the pinned v4.22.1 image and its amd64/arm64 manifest. Availability was checked; successful local execution has not yet been established.

## Release gate

Run the commands in the README after prerequisites are available. All deterministic P0 checks, the actual graph/HTTP integrations, and the headline Playwright flow must pass. Then record three consecutive live reset-to-completion rehearsals and a working demo video. Preserve failed live attempts. Do not present this initial implementation status as release completion.
