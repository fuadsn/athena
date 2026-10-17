# Athena — Coding-Agent Handoff

Read `PRD.md` first. This document assigns implementation work; it does not add product scope.

## Coordinator prompt

```text
Build Athena from the accompanying PRD. This is a Company Brain agent that learns
one reviewed trial-workspace procedure from historical evidence and executes an
unseen case using current graph-based approval authority.

Start by creating shared schemas and a runnable skeleton. Freeze API, graph, and
Workspace Lab contracts before assigning parallel implementation. Use the lane
ownership below. Integrate a thin vertical slice before polishing the interface.

Critical constraints:
- The seed has no executable procedure, rules, or reusable approvals.
- Historical observations are not permissions; an authorized owner confirms policy.
- Seven/thirty-day values and the approver are data, not hidden engine constants.
- A fresh agent episode must retrieve its procedure and authority from FalkorDB.
- Approval is checked by code against the exact plan and current role assignment.
- Workspace creation changes the separate local Lab; a verifier reads actual state.
- Evals contain expected results and human teaching inputs. Never expose them to
  the runtime learner or silently seed their expected answers.
- No blast-radius features, second workflow, recursive swarm, or arbitrary shell.

Implement in the PRD gate order. Keep tests real. Report what you changed, the
commands you ran, actual results, and any unfinished requirement. Do not claim
success from mocks alone or hide a live-model failure behind canned output.
```

## Repository layout

```text
apps/
  web/                     Next.js UI and runtime proxy
  runtime/                 HTTP API, dispatcher, bounded episodes, mutation broker
  workspace-lab/           independent local application and persistent state
packages/
  contracts/               shared Zod schemas, types, error codes
  graph/                   FalkorDB adapter, parameterized queries, migrations
  learner/                 evidence retrieval and structured induction
  executor/                plan validation, authorization, execution, verification
fixtures/
  company-history.json     cold runtime seed only
  README.md                fixture meaning and ingestion boundary
evals/
  acceptance.json          expected behavior; test-only
  live/                    live-model evaluation scripts, not canned answers
tests/
  integration/
  e2e/
docs/
  graph-model.md
  queries.md
  demo-script.md
  ai-assistance.md
compose.yaml
.env.example
README.md
```

Root commands to provide: `dev`, `build`, `seed`, `demo:reset`, `test`,
`test:integration`, `test:e2e`, and `eval:live`. These are required deliverables,
not commands already implemented in this bundle.

Environment contract: `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_GRAPH`, optional
`FALKORDB_PASSWORD`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `RUNTIME_URL`,
`WORKSPACE_LAB_URL`, `WORKSPACE_LAB_TOKEN`, `DEMO_MODE`, and
`DEMO_SESSION_SECRET`. Supply no real secrets in example files.

## Gate 0 — coordinator owns the seams

Before parallel work, agree and commit:

1. Shared request, procedure/rule/step, evidence, plan, approval, receipt, event,
   verification, and API-error schemas.
2. Graph IDs/relationships and immutable version rules from the PRD.
3. Workspace Lab API and operation-key semantics.
4. Model adapter interface and a clearly separated fake used only in tests.
5. One serialized mutation owner in the runtime; all knowledge/approval/action
   mutations pass through it.

The coordinator owns root dependencies, configuration, shared-contract changes,
and final integration. Contributors propose contract changes rather than editing
shared files concurrently. Write them in a small decision log, then notify all lanes.

## Parallel implementation lanes

| Lane | Owns | Deliverable and handoff |
|---|---|---|
| A — Knowledge and learning | `packages/graph`, `packages/learner`, history importer | Cold graph, cited model-generated candidate, owner-reviewed version, procedure/authority queries. Provides typed functions to runtime. |
| B — Runtime and execution | `apps/runtime`, `packages/executor` | Fresh episodes, API state machine, guarded approval/execution, knowledge revision checks, receipt reconciliation, deterministic completion. Uses A’s graph contract and C’s API. |
| C — Workspace Lab and adversarial tests | `apps/workspace-lab`, `tests/integration` | Real file-backed resource service, idempotent tools, actual access/expiry evaluation, injected-failure tests. Does not implement company policy. |
| D — UI and demonstration | `apps/web`, `tests/e2e`, demo docs | Learn/review/do/verify screens, evidence drawer, persona controls, authority-change flow. Starts with schema-conformant mocks, then removes them from the real demo path. |

A and C can build independently after Gate 0. B integrates their contracts while D
uses typed mocks. A lane’s completion report must list actual tests, not just files.

## Integration checkpoints

**Checkpoint 1:** import history, retrieve evidence from FalkorDB, and persist a
candidate. No seeded procedure is permitted. UI can remain unfinished.

**Checkpoint 2:** publish as the owner, end the episode, and retrieve the learned
procedure with an empty model context. Test publication as the wrong actor too.

**Checkpoint 3:** create an unseen extended request, pause for approval, mutate the
Lab only after valid approval, and complete only from independent verification.

**Checkpoint 4:** swap Ravi for Leena, invalidate unused stale approval, demonstrate
fresh routing, and recover an interrupted request without a duplicate resource.

Only after Checkpoint 3 should anyone spend substantial effort on visual polish.
Do not wait for all lanes to call themselves finished before integrating.

## Test ownership and completion report

A owns T01–T03, T10, T15. B owns T05–T08, T11–T12, T14, T16. C owns T09 and
cross-layer injection/retry tests. D owns the end-to-end versions of T04–T08.
T13 is jointly reviewed by A/B/C: its pass condition is guard behavior, not a nice
LLM refusal sentence.

Every lane returns:

```text
Changed:
Implemented requirement IDs:
Commands run and actual outcomes:
Live behavior versus test-only mocks:
Remaining failures or limitations:
Contract changes needing coordinator approval:
```

Final delivery requires the PRD release gate, complete local setup, documented
Cypher queries, and honest AI-assistance disclosure. The project owner must inspect
the code and understand what was built; do not submit an unverified agent dump.
