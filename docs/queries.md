# Parameterized graph queries

The executable query constants live in `packages/graph/src/queries.ts`. Every external value is passed through the FalkorDB client's `params` option. Labels and relationship names are fixed application code. The model receives named read tools and cannot provide Cypher. Query traces record the exact query, parameters, returned row count and elapsed milliseconds. Each episode runs inside an `AsyncLocalStorage` trace scope, so concurrent episodes and UI polling cannot drain one another's query evidence. The runtime also drains traces when an episode fails.

## Q1: Historical cases, observations and evidence

```cypher
MATCH (c:Case)-[:INSTANCE_OF]->(:Process {id: $processId})
WHERE size($caseIds) = 0 OR c.id IN $caseIds
MATCH (c)-[:HAS_OBSERVATION]->(o:ActionObservation)-[:SUPPORTED_BY]->(s:Source)
RETURN c.json AS caseJson, o.json AS observationJson, s.json AS sourceJson
ORDER BY c.id, o.sequence
```

A companion query retrieves `Case-[:SUPPORTED_BY]->Source` notes. `getHistory` de-duplicates records and rejects requested case IDs outside the selected process. Historical outcomes are observations; this query never returns a standing approval.

## Q2: Current published procedure, dependencies, rules and confirmations

```cypher
MATCH (p:Procedure {status: 'PUBLISHED'})-[:FOR_PROCESS]->(:Process {id: $processId})
RETURN p.json AS json, p.id AS id, p.status AS status,
       p.knowledgeRevision AS knowledgeRevision
```

```cypher
MATCH (:Procedure {id: $procedureId})-[:HAS_STEP]->(step:Step)
OPTIONAL MATCH (before:Step)-[:PRECEDES]->(step)
OPTIONAL MATCH (step)-[e:SUPPORTED_BY]->(source:Source)
RETURN step.id AS stepId, step.json AS json, collect(DISTINCT before.id) AS dependencies,
       collect(DISTINCT e.ref) AS refs
ORDER BY stepId
```

```cypher
MATCH (:Procedure {id: $procedureId})-[:HAS_RULE]->(rule:Rule)
OPTIONAL MATCH (rule)-[:REQUIRES_ROLE]->(role:Role)
OPTIONAL MATCH (rule)-[e:SUPPORTED_BY]->(source:Source)
RETURN rule.id AS ruleId, rule.json AS json, collect(DISTINCT role.id) AS roleIds,
       collect(DISTINCT e.ref) AS refs
ORDER BY ruleId
```

Retrieval overwrites the record's step list, dependency list, rule list, approval-role ID and evidence/confirmation references with these traversals. Missing/ambiguous required role edges or missing published confirmations fail closed. The executor validates the resulting tool composition and dependency preconditions.

## Q3: Current role holder and assignment revision

```cypher
MATCH (person:Person)-[assignment:HOLDS_ROLE]->(role:Role {id: $roleId})
WHERE assignment.validFrom <= $now
  AND (assignment.validTo IS NULL OR assignment.validTo > $now)
RETURN person.json AS personJson, assignment.json AS assignmentJson,
       assignment.revision AS assignmentRevision,
       assignment.validFrom AS validFrom, assignment.validTo AS validTo,
       person.id AS personId, role.id AS roleId
```

Exactly one row is required. Zero or multiple holders produce `AMBIGUOUS_AUTHORITY`, and assignment source references must validate. This query is rerun by runtime guards before mutation.

## Q4: Request plan, approval actor and current authority

```cypher
MATCH (request:Request {id: $requestId})-[:HAS_PLAN]->(plan:Plan {id: $planId})
OPTIONAL MATCH (approval:Approval)-[:APPROVES]->(plan)
OPTIONAL MATCH (approval)-[:GRANTED_BY]->(actor:Person)
OPTIONAL MATCH (plan)-[:REQUIRES_ROLE]->(role:Role)
OPTIONAL MATCH (holder:Person)-[assignment:HOLDS_ROLE]->(role)
WHERE assignment.validFrom <= $now
  AND (assignment.validTo IS NULL OR assignment.validTo > $now)
RETURN plan.json AS planJson, approval.json AS approvalJson,
       actor.id AS actorId, role.id AS roleId,
       holder.id AS holderId, assignment.revision AS assignmentRevision
```

The runtime additionally compares plan hash, request/knowledge/assignment revisions, approved decision and expiration, and calls Q3 to reject missing or ambiguous current authority. The query's join supplies approvals through actual `APPROVES` and `GRANTED_BY` edges.

## Q5: Restart receipts and independent verification

```cypher
MATCH (:Request {id: $requestId})-[:HAS_RECEIPT]->(receipt:Receipt)
RETURN receipt.json AS json ORDER BY receipt.observedAt
```

```cypher
MATCH (:Request {id: $requestId})-[:HAS_VERIFICATION]->(v:Verification)
RETURN v.json AS json ORDER BY v.checkedAt DESC LIMIT 1
```

These records are reconciled against the separate Lab operation ledger and actual resource state. Persisted graph receipts alone cannot mark a request completed.

## Running real query checks

Start the configured FalkorDB service, then run:

```sh
GRAPH_INTEGRATION=1 npx vitest run packages/graph/test/graph.integration.test.ts
```

The suite exercises import, publication, wrong-owner rejection, role replacement, removed edges, plan approvals, receipts and verification against an isolated real graph. Unit tests alone do not establish that these Cypher queries execute successfully.

Client behavior follows the [official FalkorDB TypeScript client](https://github.com/FalkorDB/falkordb-ts). The model adapter follows [OpenAI Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), with explicit strict schemas and server-side argument validation.
