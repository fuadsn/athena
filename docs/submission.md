# Athena — submission copy

Prepared 18 October 2026 for **Track 3: Company Brain**. Repository, public interactive demo, working video, and validation evidence are ready. The project owner has confirmed personal review of the code and working demonstration. Submission through the owner's account remains pending. Actual results are recorded in [validation](validation.md).

## Title

**Athena — Teach the company once. Equip the next agent.**

## Short description

Athena turns company experience into a reviewed capability that a fresh agent can use. It examines three synthetic trial-workspace cases, cites the evidence, and asks the process owner to resolve uncertain policy. FalkorDB retains the confirmed procedure, its sources, and current approval authority. New requests follow that knowledge, obtain any required approval, and create a persisted local workspace whose access and expiry are independently verified.

## Problem and solution

Company procedures are spread across tickets, chats, and people. A historical exception does not establish a reusable policy, and the person who approved yesterday's work may no longer hold that authority. An agent needs to know what happened, what the company has confirmed, and who may authorize the next action.

Athena separates those questions. **Learn** connects historical cases to literal sources and surfaces uncertainty for owner review. **Do** starts a fresh agent episode, retrieves the reviewed procedure, and binds approval to the exact plan and current role assignment. **Verify** checks the separate Workspace Lab's persisted resource, precise access grants, expiry, active state, and uniqueness before declaring completion.

The demonstration focuses on one workflow: customer trial-workspace provisioning. Changing the extension approver from Ravi to Leena changes fresh routing through the graph. Changing the confirmed normal duration changes an omitted-duration request without an engine or prompt edit. These are the behaviors to show in the working recording.

## What FalkorDB does

FalkorDB is the authoritative company knowledge and execution store. Parameterized relationship queries retrieve:

- Cases → observations → immutable source evidence.
- Published procedure → confirmed rules and steps → prerequisite relationships and human confirmation.
- Required role → current holder and assignment revision.
- Request → exact plan → approval → current authority, checked before each mutation.
- Request → receipts and verification for explanation and interrupted-work recovery.

The Workspace Lab stores business resources separately. Its independent read-back determines whether the approved outcome exists. Removing a required graph relationship changes or blocks execution; there is no executable local-policy fallback when the graph is unavailable. See the [graph model](graph-model.md), [essential Cypher](queries.md), and [query implementation](../packages/graph/src/queries.ts).

## Submission links and setup

| Field | Value |
|---|---|
| Track | Track 3 — Company Brain |
| Public source repository | [github.com/fuadsn/athena](https://github.com/fuadsn/athena) |
| Complete local setup | [README: Run locally](https://github.com/fuadsn/athena#run-locally) |
| Graph model and architecture | [README graph map](https://github.com/fuadsn/athena#why-falkordb-matters) and [graph-model.md](graph-model.md) |
| Essential graph queries | [queries.md](queries.md) |
| Working demo video | [Watch the complete 3:11 demonstration](https://fuadsn.github.io/athena/) · [Download MP4](https://fuadsn.github.io/athena/demo/athena-demo.mp4) |
| Public interactive demo | [athena-0gfk.onrender.com](https://athena-0gfk.onrender.com) — Render Free, real FalkorDB and live OpenAI. Supply the demo access code privately in the submission. Free hosting may sleep and resets local data on restart. [Verified public flow](hosted-evidence.json). |
| Actual validation evidence | [validation.md](validation.md) |

Setup requires Node.js 24 LTS, npm, and a configured OpenAI API key/model supporting strict Responses function calling. The verified release uses `gpt-5.4-2026-03-05`. The README documents `npm ci`, `npm run setup`, model configuration, and either embedded FalkorDB or Docker. Full Compose startup and its cold browser flow passed CI; three consecutive live rehearsals and the complete live browser recording passed separately.

## AI assistance disclosure

OpenAI Codex assisted with implementation, synthetic fixtures, graph queries, runtime guards, the interface, tests, and documentation. The participant supplied the product requirements, selected the problem and Company Brain track, and directed the scope. Model and graph doubles are confined to tests; the working demonstration must use the live model. The participant has personally reviewed the code and working demonstration and remains responsible for the submitted implementation. [Full disclosure](ai-assistance.md).

## Participant review

The project owner confirmed personal review of the code and working demonstration on 18 October 2026. The following references explain the main technical decisions for the submission walkthrough:

- Inspect [the historical fixture](../fixtures/company-history.json) and [the learner](../packages/learner/src/index.ts). Explain why observed success and model suggestions cannot publish policy or authorize a new request.
- Trace Q1–Q5 through [the graph queries](../packages/graph/src/queries.ts) and [adapter](../packages/graph/src/index.ts). Identify the relationships that make current procedure and authority retrieval depend on FalkorDB.
- Read [runtime publication and approval handling](../apps/runtime/src/service.ts) and [executor guards](../packages/executor/src/index.ts). Explain exact-plan approval, revision invalidation, and rechecking authority before mutation.
- Inspect [Lab persistence](../apps/workspace-lab/src/store.ts), [resource behavior](../apps/workspace-lab/src/application.ts), and [executor verification](../packages/executor/src/index.ts). Explain durable operation replay, independent read-back, and why a tool success alone cannot complete work.
- Personally run the [demo sequence](demo-script.md): cold evidence, owner teaching, fresh request, current approval, verified workspace, and authority replacement. Inspect at least one literal source and one actual graph-query trace.
- Review [test coverage](../tests/integration/runtime.test.ts), [live rehearsal output generation](../evals/live/run.ts), and the final [validation record](validation.md). Watch the linked recording and confirm that you understand the demonstrated implementation.

## Organizer requirements checked

The official rules require a public repository, setup and graph-model documentation, essential queries or algorithms, a working video, deployment or complete local instructions, a named track, and disclosed AI assistance. Rule 10 specifies the README graph model and essential queries; rule 11 requires disclosing AI coding assistance; rules 12–13 address participant understanding and contribution. Submission closes **18 October 2026 at 11:59 PM IST**. [Official rules](https://www.wemakedevs.org/hackathons/falkordb/rules).

Track 3 emphasizes company knowledge, ownership, traceable sources, and keeping knowledge current. Athena's bounded workflow connects those concerns to an executable, reviewed procedure. [Track brief](https://www.wemakedevs.org/hackathons/falkordb#tracks).

Use the [official submission page](https://www.wemakedevs.org/hackathons/falkordb/submit) from the participant's signed-in account to submit the completed artifacts. Its form fields were not exposed in the public page response, so the sections above are prepared copy rather than a claim about exact form labels or limits.
