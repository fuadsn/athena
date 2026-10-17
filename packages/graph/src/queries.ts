/** These query strings are fixed application code. User/model input is always a parameter. */
export const QUERIES = {
  history: `MATCH (c:Case)-[:INSTANCE_OF]->(:Process {id: $processId})
    WHERE size($caseIds) = 0 OR c.id IN $caseIds
    MATCH (c)-[:HAS_OBSERVATION]->(o:ActionObservation)-[:SUPPORTED_BY]->(s:Source)
    RETURN c.json AS caseJson, o.json AS observationJson, s.json AS sourceJson
    ORDER BY c.id, o.sequence`,
  historySources: `MATCH (c:Case)-[:INSTANCE_OF]->(:Process {id: $processId})
    WHERE size($caseIds) = 0 OR c.id IN $caseIds
    MATCH (c)-[:SUPPORTED_BY]->(s:Source) RETURN DISTINCT s.json AS json`,
  currentProcedure: `MATCH (p:Procedure {status: 'PUBLISHED'})-[:FOR_PROCESS]->(:Process {id: $processId})
    RETURN p.json AS json, p.id AS id, p.status AS status, p.knowledgeRevision AS knowledgeRevision`,
  procedure: `MATCH (p:Procedure {id: $id})-[:FOR_PROCESS]->(:Process)
    RETURN p.json AS json, p.id AS id, p.status AS status, p.knowledgeRevision AS knowledgeRevision`,
  steps: `MATCH (:Procedure {id: $procedureId})-[:HAS_STEP]->(step:Step)
    OPTIONAL MATCH (before:Step)-[:PRECEDES]->(step)
    OPTIONAL MATCH (step)-[e:SUPPORTED_BY]->(source:Source)
    RETURN step.id AS stepId, step.json AS json, collect(DISTINCT before.id) AS dependencies, collect(DISTINCT e.ref) AS refs
    ORDER BY stepId`,
  rules: `MATCH (:Procedure {id: $procedureId})-[:HAS_RULE]->(rule:Rule)
    OPTIONAL MATCH (rule)-[:REQUIRES_ROLE]->(role:Role)
    OPTIONAL MATCH (rule)-[e:SUPPORTED_BY]->(source:Source)
    RETURN rule.id AS ruleId, rule.json AS json, collect(DISTINCT role.id) AS roleIds, collect(DISTINCT e.ref) AS refs
    ORDER BY ruleId`,
  authority: `MATCH (person:Person)-[assignment:HOLDS_ROLE]->(role:Role {id: $roleId})
    WHERE assignment.validFrom <= $now AND (assignment.validTo IS NULL OR assignment.validTo > $now)
    RETURN person.json AS personJson, assignment.json AS assignmentJson,
      assignment.revision AS assignmentRevision, assignment.validFrom AS validFrom, assignment.validTo AS validTo,
      person.id AS personId, role.id AS roleId`,
  approvalAuthority: `MATCH (request:Request {id: $requestId})-[:HAS_PLAN]->(plan:Plan {id: $planId})
    OPTIONAL MATCH (approval:Approval)-[:APPROVES]->(plan)
    OPTIONAL MATCH (approval)-[:GRANTED_BY]->(actor:Person)
    OPTIONAL MATCH (plan)-[:REQUIRES_ROLE]->(role:Role)
    OPTIONAL MATCH (holder:Person)-[assignment:HOLDS_ROLE]->(role)
    WHERE assignment.validFrom <= $now AND (assignment.validTo IS NULL OR assignment.validTo > $now)
    RETURN plan.json AS planJson, approval.json AS approvalJson, actor.id AS actorId,
      role.id AS roleId, holder.id AS holderId, assignment.revision AS assignmentRevision`,
  receipts: `MATCH (:Request {id: $requestId})-[:HAS_RECEIPT]->(receipt:Receipt)
    RETURN receipt.json AS json ORDER BY receipt.observedAt`,
  verification: `MATCH (:Request {id: $requestId})-[:HAS_VERIFICATION]->(v:Verification)
    RETURN v.json AS json ORDER BY v.checkedAt DESC LIMIT 1`,
} as const;
