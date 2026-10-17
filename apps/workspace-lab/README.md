# Workspace Lab

An independent Node HTTP application that persists synthetic trial workspaces. It has no company procedure, duration, approval role, or model integration. Athena's broker calls it using a private token; the verifier reads actual application state.

Run from the repository root with `npm run dev:lab`. Configuration:

| Variable | Meaning |
| --- | --- |
| `WORKSPACE_LAB_TOKEN` | Required bearer credential for workspace reads and writes. |
| `WORKSPACE_LAB_ADMIN_TOKEN` | Separate administrative capability for reset. Must differ from the workspace token. |
| `WORKSPACE_LAB_STORE` | JSON store path; defaults to `.local/workspace-lab.json`. |
| `WORKSPACE_LAB_HOST` | Bind address; defaults to `127.0.0.1`. |
| `WORKSPACE_LAB_PORT` | Bind port; defaults to `4200`. |
| `DEMO_MODE` | Exactly `true` enables administrative reset with the separate token. |

`LAB_TOKEN`, `LAB_ADMIN_TOKEN`, `LAB_DATA_PATH`, `LAB_HOST`, and `LAB_PORT` are fallback aliases. Keep the default loopback binding for host development. In Docker Compose, bind inside the container and keep the Lab on the private service network without a published port. Reset authorization trusts the configured administrative token, so the runtime can reset across that private network. The token and reset route are never model tools or browser credentials.

`createLabServer({ dataPath, token, adminToken?, allowReset?, now? })` returns a native `http.Server`, ready to `listen()`. `createLabClient({ url, token, adminToken?, timeoutMs? })` implements the shared `LabClient`; its configured URL must be one HTTP origin. It refuses redirects and validates response schemas. Network timeouts are explicit failures and do not imply that a mutation did not commit.

`WorkspaceLab` in `src/application.ts` implements those same capabilities directly over the real file store. The HTTP server delegates to this application. Offline integration tests can instantiate it without sockets; this is not an in-memory replacement. Call `await application.close()` before reopening its store. The HTTP server's close callback also waits for outstanding disk transactions before releasing the writer lock.

All public resource schemas and the operation hash function live in `packages/contracts`. Routes match the PRD: create, expiry, grants, activation, read, list by request ID, access evaluation, and durable operation lookup. `POST /admin/reset` requires `{}` JSON, demo mode, and the admin token. `GET /health` checks that persisted state can be read.

Every mutation recomputes its semantic hash and checks the `requestId/stepId` operation key. The service creates at most one workspace per request. Identical retries return the original operation snapshot with `ALREADY_APPLIED`; a different input under the same key returns `CONFLICT`. Operation lookup returns the original receipt. Use workspace read for its current state.

The store has one owner process, protected by a local lock file and an in-process transaction queue. Each request reloads the persisted snapshot. A transaction writes a new file, synchronizes it, atomically renames it, and synchronizes the directory. Resource changes and operation receipts belong to the same snapshot. If the response is lost after commit, operation lookup permits reconciliation. Damaged or unexpectedly missing persistence fails closed. Startup can recover a lock whose owner process no longer exists; it refuses an existing live owner.

Stale-lock reclamation is itself exclusive. If a process is killed during that very short recovery step and leaves a `.lock.recovery` file, startup stops for operator inspection rather than risking two writers. After verifying that no Lab process owns the store, the operator can remove that recovery marker and restart.

An error after rename, including failure to synchronize the directory, is reported as an uncertain commit. The service leaves the snapshot in place, returns `DEPENDENCY_UNAVAILABLE`, and instructs callers to reconcile. It never compensates by deleting a possibly committed resource or inventing a missing receipt.

Expiry and grants can be edited only while inactive. Activation requires a future expiry and at least one grant. Access is evaluated from the actual active flag, current time, expiry, and matching synthetic email. The application permits member, viewer, and admin grants; the company verifier must independently reject capabilities outside its reviewed plan.

Run `npx vitest run tests/integration/lab.test.ts` for actual HTTP, disk, concurrency, restart, corruption, credential, timeout, and interrupted-response checks. No mocked application state is used. The clock is injectable for deterministic expiry tests.

Run `npx vitest run apps/workspace-lab/src/application.test.ts` for the same application invariants with real files and no listening sockets. These checks are useful in restricted environments that prohibit binding a local TCP port; they do not replace the HTTP transport suite.
