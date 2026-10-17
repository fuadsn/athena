# Athena — Product Requirements Document

**Version:** 1.0 · **Prepared:** October 17, 2026  
**Status:** Build specification; no application functionality is implemented by this document.  
**Primary track:** Company Brain · **Target:** organizer-listed M6 Mac Mini prize. [S1–S2]  
**Effort envelope:** approximately 16 focused engineering hours, assisted by coding agents.

> **Athena learns how your company gets a job done, asks about the exceptions, and equips a fresh agent to complete the next case.**

## 1. Read this first

Build one complete capability: **learn and execute customer trial-workspace provisioning**.

The winning demonstration we are aiming for—not a promised judging outcome—is:

1. Start with three historical cases and **no published procedure**.
2. Athena detects that two trials lasted seven days and one lasted thirty; it asks the process owner whether that difference is an exception.
3. The owner reviews and confirms the procedure, including when approval is required.
4. A fresh agent handles a new thirty-day request, obtains the right approval, creates a resource in the local Workspace Lab, and verifies its access and expiry.
5. Change the approval-role holder in FalkorDB. Another fresh agent routes approval to the new person without a prompt or code change.

**The graph stores a learned, reviewed procedure—not just text for a chatbot.**

### Product boundaries

This is bounded procedure induction from company examples and human correction. It is not model training, universal workflow discovery, or evidence that three examples establish a company-wide policy. Historical behavior supplies hypotheses; an authorized person establishes what may be reused.

Prebuilt: tool implementations, tool schemas, technical preconditions, a small rule grammar, and a generic execution engine.  
Learned and reviewed: company-specific settings, applicable conditions, exception handling, approval-role requirements, and the procedure composed from those tools.

Do not build BlastRadius, dependency-impact analysis, a cross-team collision simulator, or an autonomous coding swarm. Those are superseded directions.

## 2. User, job, and success

**User:** an operations lead teaching a recurring process, then an operator requesting work under that process.

**Job:** “Create this customer’s trial workspace according to our actual company practice, including exceptions and current approval authority.”

**A completed job means:** a real persisted resource exists in the local demo application; its customer, member access, expiry, and active state match the approved plan; an independent read-back supports the completion record.

A generated checklist, an approval click, a tool-call success message, or a ticket marked Done is not sufficient.

### Product requirements

| ID | P0 requirement | Acceptance evidence |
|---|---|---|
| R1 | Extract a candidate procedure from historical cases. | Cold graph has no procedure; a model-produced candidate cites observations. |
| R2 | Identify ambiguity and request human teaching. | Seven/thirty-day discrepancy and missing generalization are visible. |
| R3 | Publish only reviewed, versioned rules. | The authorized owner confirms all action-relevant fields. |
| R4 | Retrieve procedures and current authority from FalkorDB. | Actual graph query paths appear in the run record. |
| R5 | Start fresh, bounded agent episodes. | New episode ID and empty model context after teaching/approval waits. |
| R6 | Execute only permitted, approved actions. | Guard rejects an unapproved extension or stale plan. |
| R7 | Verify the external demo application’s state. | Read-back and access checks, not agent assertions, determine completion. |
| R8 | Adapt to an authority change. | Old holder cannot approve; fresh episode identifies the new holder. |
| R9 | Recover safely from a repeated or interrupted request. | No duplicate resource; persisted receipts are reconciled. |
| R10 | Explain decisions with specific evidence. | Source IDs and exact excerpts support learned rules and approval routing. |

## 3. Demo company and input boundary

Use the supplied `fixtures/company-history.json`. Every company, person, customer, and event is synthetic.

**HelioWorks** has four people:

| Person ID | Person | Initial authority |
|---|---|---|
| `person_mira` | Mira | Owner of `process_trial`; may review/publish its procedure and manage its role assignment in demo mode. |
| `person_ana` | Ana | Trial operator; may request work. |
| `person_ravi` | Ravi | Current holder of `role_trial_extension_approver`. |
| `person_leena` | Leena | Available replacement; no extension authority initially. |

The seed contains directory facts, case records, source text, observed actions, and outcomes. It must contain **zero Procedure, Rule, Plan, or executable Approval nodes**. An approval mentioned in an old case is historical evidence, not permission for a new case.

| Historical case | Observed result | What Athena can and cannot conclude |
|---|---|---|
| Northstar | Seven-day trial, member access. | Evidence of a setting, not proof of a universal default. |
| Cedar | Seven-day trial, member access; configuration order differs. | Evidence of recurring behavior, not a mandatory total ordering. |
| Lumen | Thirty-day trial; Ravi consented in that case. | Evidence of a variation and a prior approval, not standing authorization. |

Source text and audit events are runtime input. The expected answers in `evals/acceptance.json` are test-only and **must not enter model context or seed the runtime graph**.

### P0 ingestion

One local structured JSON import only. Preserve immutable source IDs, revisions, content hashes, timestamps, and text. Model-proposed evidence references must resolve to a source and a literal substring or audit-event ID. Reject fabricated citations.

No PDF parser, arbitrary repository ingestion, Slack/Jira integration, embeddings, or external company-data connector is required.

## 4. Learning and human teaching

### Learning episode

The worker retrieves relevant cases through graph tools, examines their notes and action observations, and proposes a structured procedure using the allowed tool catalog. It returns:

- Observed common actions and their evidence.
- Differences and unresolved generalizations.
- Candidate settings and conditions, each marked `PROPOSED`.
- A focused teaching question; for this fixture, the seven/thirty-day discrepancy must be included.

One review card may ask the owner to confirm several related fields. Do not force a long chatbot conversation.

### Owner review

The expected demo correction is:

> “Seven days is the normal trial. Thirty days is an exception, approved for each request by whoever currently holds the Trial Extension Approver role. Use member access. Configure the workspace while inactive, then activate it only after its expiry and access are correct.”

This is a **human teaching input**, not a hidden system prompt. The review form shows the candidate, its evidence, and editable structured fields. Mira explicitly confirms the final values. Free text alone must not silently publish policy.

The reviewed v1 procedure permits exactly the normal duration and the extended duration. Other durations require clarification; Athena must not silently substitute a supported duration.

### Publish semantics

Publishing creates an immutable procedure version and confirmed rules, links them to the historical evidence and the new human confirmation, and increments `knowledgeRevision`. The old version, when present, becomes `SUPERSEDED`; historical runs continue to cite it.

Two permissions are distinct:

- **Procedure publication:** Mira authorizes a reusable company rule.
- **Request approval:** the current extension approver authorizes one exact thirty-day plan.

Neither permission implies the other. Workers may propose procedures but cannot publish them, grant themselves roles, or approve their own plans.

## 5. Request execution

### New case

Ana submits a request with customer identity, owner email, and optional requested duration. Omitted duration resolves from the confirmed rule. Request submission explicitly authorizes the ordinary workflow within Ana’s role; the extended branch still needs separate approval.

A fresh agent loads the current procedure and resolves its conditions through FalkorDB. It constructs a bounded plan, with source-backed justification for its settings and approval requirements.

### Allowed action catalog

| Tool | Technical behavior; not a company policy |
|---|---|
| `create_workspace` | Creates one inactive, persisted local resource for the request. |
| `set_expiry` | Sets an absolute expiry on an existing inactive resource. |
| `grant_access` | Sets a named user’s role on an existing inactive resource. |
| `activate_workspace` | Activates a configured resource; never runs before guards pass. |
| `read_workspace` | Returns independently stored state, including creation time and grants. |
| `check_access` | Evaluates the Workspace Lab’s actual active/expiry/access logic. |

The procedure chooses parameter bindings and step dependencies. The engine performs a generic topological traversal and enforces tool preconditions. It must not contain a special `if customer === Lumen` or `if days === 30` workflow. Numeric company thresholds and approval-role IDs come from confirmed graph rules.

### Plan and approval

Resolve the required **role**, then its current holder. Do not copy a historical person’s name into reusable workflow logic. Missing or ambiguous authority blocks execution and produces a specific explanation.

A plan freezes the request revision, procedure version, knowledge revision, resolved parameters, step dependencies, required approval role, and evidence references. Its normalized contents produce `planHash`.

Approval is bound to that hash and records the authenticated demo actor, role assignment revision, decision, timestamp, and a configurable expiry. Approvals are checked again before mutation. A changed request, procedure, role assignment, or expired approval requires a new plan/approval; no inherited approval for changed work.

### Verification and completion

After execution, the verifier reads the Workspace Lab and checks:

- Exactly one resource exists for this request, attached to the intended customer.
- Its owner has precisely the reviewed member access; no extra privileged grant exists.
- `expiresAt = createdAt + approvedDurationDays × 86,400,000` milliseconds, within one second.
- The resource is active; an intended-member access check succeeds and an unrelated identity is denied.
- All required receipts and applicable approvals are recorded.

Use the Lab’s persisted `createdAt`, never a new timestamp on retry. Only deterministic verifier code can transition a request to `COMPLETED`. An LLM cannot call “mark complete.”

“Verified” is limited to these local postconditions; do not claim a real cloud environment or production account was provisioned.

## 6. FalkorDB data model

Company knowledge, procedure structure, authority, execution state, and evidence live in FalkorDB. Workspace business state lives separately in the Lab so verification does not read back the agent’s own prediction.

### Main nodes and relationships

| Area | Nodes | Required relationships |
|---|---|---|
| Company | `Person`, `Role`, `Process` | Person `OWNS` Process; Person `HOLDS_ROLE` Role with validity/revision. |
| History | `Case`, `ActionObservation`, `Source` | Case `INSTANCE_OF` Process; Case `HAS_OBSERVATION` ActionObservation; observation `SUPPORTED_BY` Source. |
| Learned capability | `Procedure`, `Step`, `Rule` | Procedure `FOR_PROCESS` Process; `HAS_STEP` Step; Step `PRECEDES` Step; Procedure `HAS_RULE` Rule; Rule `REQUIRES_ROLE` Role; Step/Rule `SUPPORTED_BY` Source. |
| Work | `Request`, `Plan`, `Approval`, `Episode` | Request `USES_PROCEDURE` Procedure; Request `HAS_PLAN` Plan; Approval `APPROVES` Plan; Approval `GRANTED_BY` Person; Episode `WORKS_ON` Request or Procedure. |
| Evidence | `Receipt`, `Verification`, `Event` | Request `HAS_RECEIPT` Receipt; Request `HAS_VERIFICATION` Verification; events retain ordered actor/action references. |

Use stable IDs, immutable source/procedure revisions, ISO timestamps, and a global integer `knowledgeRevision`. The P0 single-company implementation invalidates pending plans on any relevant knowledge change; finer-grained invalidation is deferred. Procedure publication and authority changes increment it; ordinary request, episode, and receipt writes do not. Relationship provenance must retain source ID/revision too.

### Rule grammar

Use a small validated data grammar, not executable code:

- Scalars: normal duration, extended duration, access role.
- Conditions: `eq`, `in`, and `all` over allowlisted request fields and confirmed rule values.
- Outcomes: permit a branch, require a role’s approval, or require human clarification.
- Parameter bindings: allowlisted request fields, confirmed rule values, and prior step outputs.

Every published behavior-affecting rule needs a confirming human source. History is retained as its basis, not substituted for authority. Nested arbitrary expressions, shell commands, and model-generated Cypher writes are prohibited.

### Mandatory graph queries

Implement and document these as parameterized, tested queries:

1. Retrieve cases → observations → source evidence for a process.
2. Retrieve current published procedure → steps/dependencies → rules → confirmation sources.
3. Resolve a required role → current holder and source-backed assignment revision.
4. Retrieve request → plan → approval → current authority for pre-execution validation.
5. Retrieve receipts and verification for restart/reconciliation and final explanation.

Example query shape for Q3; validate against the selected client and schema during implementation:

```cypher
MATCH (pr:Procedure {id: $procedureId, status: 'PUBLISHED'})
      -[:HAS_RULE]->(rule:Rule {kind: 'approval'})
      -[:REQUIRES_ROLE]->(role:Role)
MATCH (person:Person)-[assignment:HOLDS_ROLE]->(role)
WHERE assignment.validFrom <= $now
  AND (assignment.validTo IS NULL OR assignment.validTo > $now)
RETURN rule.id AS ruleId, role.id AS roleId, person.id AS personId,
       assignment.revision AS assignmentRevision
```

Removing the active role edge must change routing. Removing the published procedure must prevent execution. If FalkorDB is unavailable, fail closed; never use a baked-in local procedure as a fallback. A JSON snapshot may support audit/export but is not the authoritative execution path.

## 7. Runtime architecture and build defaults

These are implementation defaults selected for speed, not previously established user stack preferences. Keep them unless an actual compatibility issue is recorded.

| Component | Decision |
|---|---|
| Web | TypeScript, Next.js App Router, simple utility CSS. Next route handlers proxy runtime requests. [S4] |
| Control plane | One persistent Node.js service; HTTP API, job dispatcher, serialized mutation broker, and fresh agent episodes. |
| Company storage | FalkorDB Docker; official `falkordb` TypeScript client. [S3] |
| Workspace Lab | Separate Node.js HTTP service with a single-writer, atomic file-backed JSON store and persisted idempotency receipts. No company rules here. |
| Model | One adapter using OpenAI Responses function calling; `OPENAI_MODEL` is explicitly configured and smoke-tested, not assumed. Validate all tool arguments server-side. [S5] |
| Tests | Vitest for contracts/guards/integration; Playwright for the headline flow. [S6–S7] |
| Local packaging | Docker Compose for the four services; pin tested dependency versions in the lockfile. |

No second graph store, vector database, Redis job service, LangGraph requirement, Kubernetes, or per-request Docker provisioning.

### What “ephemeral agent” means

One worker implementation supports two missions: **learn a procedure** and **handle a request**. Each episode begins with a new ID, empty model message history, a mission, scoped tools, and graph-retrieved context.

When it needs a person or finishes, save structured state and end the episode. Approval/teaching events can start a new episode. The company retains evidence and capability; the previous model conversation is not required.

P0 uses fresh bounded sessions inside the runtime service. These are not isolated operating-system sandboxes, and the UI must not claim they are. No recursive spawning or simulated department agents.

Per-episode initial limits: eight model turns, twelve tool calls, 120 seconds of active processing. Human wait time is outside these limits. Exceeding a budget produces an explicit non-completed result. Record actual usage and latency; these limits are not performance claims.

### Model versus code

The model interprets examples, proposes structured rules, recognizes uncertainty, retrieves relevant context, and selects eligible actions. Ordinary code validates evidence, evaluates confirmed conditions, checks authority, executes tools, persists receipts, and determines completion.

Tool schemas and arguments use strict validation. Model tool calls are proposals to the broker, not privileged execution. Structured function calling still requires application-side permission checks. [S5]

## 8. Shared contracts

Create shared Zod schemas before parallel implementation. Runtime and UI consume the same types.

```ts
type EvidenceRef = {
  sourceId: string;
  revision: number;
  quote: string | null;       // literal substring, validated
  observationId: string | null;
};

type TrialRequest = {
  id: string;
  processId: string;
  customerId: string;
  customerName: string;
  ownerEmail: string;
  requestedDays: number | null;
  revision: number;
};

type PlanIdentity = {
  requestId: string;
  requestRevision: number;
  procedureId: string;       // identifies an immutable version
  knowledgeRevision: number;
  planHash: string;
};

type ToolReceipt = {
  requestId: string;
  stepId: string;
  operationKey: string;
  inputHash: string;
  resourceId: string;
  observedAt: string;
  result: 'APPLIED' | 'ALREADY_APPLIED';
};
```

Full schemas must additionally define ProcedureDraft, Rule, Step, Plan, Approval, Episode, Verification, and API errors. IDs and numeric constants in fixtures are data, not domain-engine branches. Hash normalized objects with stable key ordering.

### API boundary

All public requests go through the web proxy to the runtime. Actors come from server-issued demo sessions, never a trusted `actorId` in request JSON.

| Endpoint | Purpose |
|---|---|
| `GET /state` | Counts, procedure state, current roles, demo reset status. |
| `POST /learning-runs` | `{caseIds}`; returns 202 with run ID. |
| `GET /learning-runs/:id` | Candidate, uncertainty, citations, review state. |
| `POST /procedures/:id/publish` | Owner confirms edited structured candidate with expected revision. |
| `POST /requests` | Create idempotent work request; returns ID and state. |
| `GET /requests/:id` | Plan, waiting reason, approval routing, receipts, verification. |
| `POST /plans/:id/approval` | Approve/reject the displayed plan hash as current actor. |
| `POST /authority/assign` | Authorized demo owner changes role holder using expected revision. |
| `POST /requests/:id/resume` | Reconcile and resume eligible unfinished work; never force completion. |
| `GET /sources/:id` | Immutable source text and provenance. |
| `GET /events?after=...` | Ordered evidence/tool/state events; polling is sufficient. |
| `POST /demo/reset` | Local demo only; resets graph and Lab together. |

Mutations return typed errors: `FORBIDDEN`, `STALE_PLAN`, `APPROVAL_REQUIRED`, `AMBIGUOUS_AUTHORITY`, `NEEDS_TEACHING`, `UNSUPPORTED_REQUEST`, `DEPENDENCY_UNAVAILABLE`, or `VERIFICATION_FAILED`. Never expose secrets in error bodies.

### Workspace Lab API

The broker alone holds its write token. These routes implement tools, not company decisions:

| Lab endpoint | Contract |
|---|---|
| `POST /workspaces` | Customer/request IDs and operation key; returns one inactive workspace and server-stamped creation time. |
| `PUT /workspaces/:id/expiry` | Absolute expiry, operation key, input hash. |
| `PUT /workspaces/:id/grants` | Exact intended grant set, operation key, input hash. |
| `POST /workspaces/:id/activate` | Operation key and input hash; requires configured future expiry and a grant. |
| `GET /workspaces/:id` | Persisted state; never a model-generated summary. |
| `GET /workspaces?requestId=...` | Resource enumeration for duplicate detection. |
| `GET /workspaces/:id/access?email=...` | Synthetic-identity access evaluation, not enterprise authentication. |
| `GET /operations/:key` | Durable input hash and result for reconciliation after an interrupted response. |

Local administrative reset/failure injection is unavailable to model tools. Grant and expiry edits require an inactive resource. All writes validate credentials and input schemas before atomic persistence.

### State transitions

Procedure: `DRAFT → NEEDS_REVIEW → PUBLISHED → SUPERSEDED`.

Request: `QUEUED → PLANNING → WAITING_APPROVAL | READY | BLOCKED`; `READY → EXECUTING → VERIFYING → COMPLETED`.

Rejection leads to `REJECTED`; tool/verification failures lead to `FAILED` with a precise partial-state record. Approved requests return to planning/validation before execution, not directly to mutation. A waiting or terminal episode ends and releases model context.

Resume reconciles durable receipts and current application state, then revalidates authority. It cannot bypass rejection, revive stale approval, or erase partial effects.

## 9. Correctness and safety requirements

**Authority and change races.** Serialize knowledge updates, approval acceptance, and guarded mutations through one control-plane lane in P0. Recheck revision and authority immediately before each state-changing call. Do not deploy multiple independent mutation writers. This is a scoped single-instance design, not a distributed transaction claim.

**Idempotency.** Use stable `requestId/stepId` operation keys. The Lab atomically saves resource changes and their receipts in one file-store transaction; repeated identical inputs return the existing result, and different inputs under the same key conflict. If the Lab commits but the graph receipt write fails, reconcile from the Lab’s operation lookup before retrying.

**Partial work.** Keep resources inactive while configuring them. If a step fails, report what exists. Do not automatically delete, reactivate, or broaden access to compensate. An already-active resource may exist after a final verification failure; show that state honestly and do not mark the request complete.

**Untrusted evidence.** Historical chats and imported text are data, never execution instructions. An embedded “ignore approval” message cannot change tool authority. The source importer and model have no policy-publication permission.

**Local identity scope.** A local-only, explicitly labeled demo persona selector issues server-side sessions for the four synthetic actors. This demonstrates role enforcement, not enterprise identity assurance. Do not accept arbitrary actor names from a mutation body. Public deployments must be access-protected or read-only; never expose persona-switch or reset endpoints publicly without protection.

**Secrets and capabilities.** Workspace credentials stay in the broker; graph and model keys stay server-side. No arbitrary shell tool, URL fetch tool, code generation/execution, or production connector. Restrict Lab network destinations to its configured origin.

**Outages and honesty.** Graph errors, model timeouts, missing authority, mismatched read-back, and unavailable tools must never produce a fabricated successful result. Automated test fixtures may mock model output, but the recorded demo and live-model evaluation cannot use a hidden canned completion.

## 10. User interface

One focused workspace with three sections; no general chat homepage is required.

**Learn:** historical-case cards, literal source excerpts, observations, the unresolved exception, and an editable owner review. Label `Observed`, `Proposed`, `Confirmed`, and `Superseded` explicitly.

**Do:** new-request form, current procedure version, plan summary, approval card, and an event timeline. Show actual tool names/results and evidence links—not invented inner reasoning or decorative agent chatter.

**Verify:** resulting Workspace Lab resource, checked duration/access, receipts, and final state. A compact relationship breadcrumb should show `request → rule → role → current holder → source`. Large animated graph visualization is deferred.

Demo controls: reset; select synthetic persona; change role holder; open source; inspect resulting workspace. Clearly distinguish operator controls from tools available to the agent.

## 11. Acceptance tests and release gate

Detailed cases are in `evals/acceptance.json`; the table here defines mandatory coverage.

| Test | Must happen |
|---|---|
| T01 Cold start | No published procedure exists; execution is blocked before teaching. |
| T02 Real induction | Live model surfaces seven/thirty-day variation with valid evidence and requests review. |
| T03 Teaching | Only the owner can publish; all action-relevant rules link to confirmation. |
| T04 Normal request | Fresh agent resolves omitted duration from the rule and verifies a normal trial. |
| T05 Exception | Thirty-day case does not mutate before the current role holder approves. |
| T06 Authority change | Ravi → Leena assignment changes routing; Ravi’s new approval attempt fails. |
| T07 Stale approval | Assignment changes after approval but before action; old approval is rejected. |
| T08 Idempotent restart | Repeated request/resume creates exactly one resource and reconciles receipts. |
| T09 Incorrect read-back | Wrong expiry or privileged access prevents completion. |
| T10 No hidden constants | Publish normal duration nine days; a new default request gets nine days without code/prompt changes. |
| T11 Missing/ambiguous authority | No holder or two active holders blocks the extension. |
| T12 Unsupported duration | Fourteen-day request asks for clarification; no silent conversion. |
| T13 Prompt injection | Malicious source text cannot approve/publish or bypass guards. |
| T14 Graph dependence | Graph outage or removed procedure prevents planning/mutation. |
| T15 Evidence validity | Fabricated citation or unresolved confirmation cannot publish. |
| T16 Budget failure | Model/tool timeout ends the episode without a false completion. |

Release gate: all deterministic P0 tests pass, headline Playwright flow passes, and three consecutive live-model reset-to-completion rehearsals are recorded with actual outcomes and usage. A model failure must remain visible; fix and repeat rather than preloading expected rules. This is a small-fixture validation, not a general capability benchmark.

## 12. Work plan and scope cuts

Effort allocation, not an elapsed-time promise:

| Gate | Allocation | Deliverable |
|---|---:|---|
| 0 — Shared foundation | 1 hour | Contracts, repo skeleton, pinned toolchain, graph/Lab connections. |
| 1 — Learn | 3 hours | Cold seed → graph retrieval → cited candidate and teaching question. |
| 2 — Remember | 2 hours | Owner review → published graph procedure → fresh-context retrieval. |
| 3 — Do | 4 hours | New request → valid approval → real Lab mutation → independent verification. |
| 4 — Adapt | 3 hours | Authority swap, restart, failure checks, functional interface. |
| 5 — Submit | 3 hours | Live rehearsals, fixes, README, query docs, demo video, submission. |

A coordinator integrates at each gate. Parallel coding-agent assignments are in `AGENT_HANDOFF.md`.

**Cut first:** animated graphs, multiple LLM providers, a second workflow, arbitrary ingestion, hosted deployment, notifications, general policy editing, and sandbox infrastructure.

**Never cut:** human review, actual graph-dependent decisions, current authority checks, real local execution, independent verification, and the fresh-agent/authority-change demonstration.

## 13. Demo and submission

### Demonstration order

Show the empty procedure state, three historical examples, Athena’s ambiguity, human correction, and the newly published capability. Start an unseen thirty-day case; show the approval gate, approve as Ravi, and inspect the created resource. Change authority to Leena, start a fresh case, and show that routing changes. Finish with the source-backed procedure and verified outcome—not a generic chat answer.

The sixty-to-ninety-second cold-start sequence should prove the idea before any architecture discussion; rehearse a complete video around the working flow, with duration based on actual behavior rather than fake progress.

### Required deliverables

The official rules require a public repository, setup/graph-model README, essential Cypher or graph algorithms, a working demo video, deployment or complete local instructions, and named track selection. Disclose AI coding assistance and personally verify/understand the submitted implementation. Use only allowed data; this specification uses synthetic records. Submission closes **October 18, 2026, 11:59 PM IST**. [S1]

This is the remaining event window, not a new four-day schedule. Primary entry: **Company Brain**. Additional tracks are optional and should not expand P0.

### Honest claims

Say: “Athena learned a reviewed procedure from three synthetic cases, resolved an exception through human teaching, and executed a new case using current graph-based authority.”

Do not claim autonomous discovery of universal company policy, production provisioning, validated enterprise security, a new foundation model, unique invention of workflow learning, or guaranteed prize success.

## 14. Sources and implementation references

External requirements/API references were checked October 17, 2026. Product behavior and effort allocations above are proposed design decisions. Implementation agents must smoke-test and pin their actual dependencies; no library code or Cypher in this specification has been executed here.

- **S1 — Official rules:** `https://www.wemakedevs.org/hackathons/falkordb/rules`
- **S2 — Company Brain focus and prize listing:** `https://www.wemakedevs.org/hackathons/falkordb`
- **S3 — Official TypeScript client:** `https://github.com/FalkorDB/falkordb-ts`
- **S4 — Next.js route handlers:** `https://nextjs.org/docs/app/getting-started/route-handlers`
- **S5 — OpenAI function calling:** `https://developers.openai.com/api/docs/guides/function-calling`
- **S6 — Vitest:** `https://vitest.dev/guide/`
- **S7 — Playwright:** `https://playwright.dev/docs/intro`
