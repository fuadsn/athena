import { FalkorDB } from 'falkordb';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  AppError, HistorySeedSchema, ProcedureSchema, SourceSchema, textHash, stableStringify,
  type GraphStore, type HistorySeed, type State, type Directory, type HistoryBundle,
  type Source, type EvidenceRef, type Procedure, type Assignment, type Person, type Role, type Process,
  type LearningRun, type LearningDetail, type TrialRequest, type RequestDetail, type Plan, type Approval,
  type Episode, type ToolReceipt, type Verification, type Event, type QueryTrace, type Step, type Rule,
} from '@athena/contracts';
import { QUERIES } from './queries';
export { QUERIES } from './queries';

type Row = Record<string, unknown>;
export type QueryDriver = { query(query: string, options?: { params: Record<string, unknown> }): Promise<{ data?: unknown[] }> };
type GraphOptions = { host?: string; port?: number; graph?: string; password?: string; queryTimeoutMs?: number };
const record = <T>(json: unknown): T => JSON.parse(String(json)) as T;
const sourceKey = (id: string, revision: number) => `${id}@${revision}`;
const unique = <T extends { id: string }>(items: T[]): T[] => [...new Map(items.map(x => [x.id, x])).values()];

/** A statement builder: labels/relations are code constants; values remain parameters. */
class Statement {
  clauses: string[] = [];
  params: Record<string, unknown> = {};
  value(value: unknown): string { const key = `p${Object.keys(this.params).length}`; this.params[key] = value; return `$${key}`; }
  node(label: string, data: { id: string }, extras: Record<string, unknown> = {}, variable?: string): void {
    const props = { id: data.id, json: JSON.stringify(data), ...extras };
    this.clauses.push(`CREATE (${variable ?? ''}:${label} {${Object.entries(props).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${this.value(v)}`).join(', ')}})`);
  }
  edge(fromLabel: string, fromKey: string, from: string, relation: string, toLabel: string, toKey: string, to: string, props: Record<string, unknown> = {}): void {
    const a = `a${this.clauses.length}`, b = `b${this.clauses.length}`;
    this.clauses.push(`WITH * MATCH (${a}:${fromLabel} {${fromKey}: ${this.value(from)}}), (${b}:${toLabel} {${toKey}: ${this.value(to)}})
      CREATE (${a})-[:${relation}${Object.keys(props).length ? ` {${Object.entries(props).map(([k, v]) => `${k}: ${this.value(v)}`).join(', ')}}` : ''}]->(${b})`);
  }
  evidence(label: string, key: string, refs: EvidenceRef[], confirmation = false): void {
    for (const ref of refs) this.edge(label, 'key', key, 'SUPPORTED_BY', 'Source', 'key', sourceKey(ref.sourceId, ref.revision), {
      sourceId: ref.sourceId, revision: ref.revision, confirmation, ref: JSON.stringify({ ...ref, confirmation }),
    });
  }
}

export function assertSource(source: Source): void {
  SourceSchema.parse(source);
  if (textHash(source.text) !== source.contentHash) throw new AppError('INVALID_INPUT', `Source ${source.id} has an invalid content hash`);
}

/** Evidence checking is shared by import and live candidates, with no semantic inference. */
export function assertEvidence(refs: EvidenceRef[], sources: Source[], observations: HistoryBundle['observations']): void {
  for (const ref of refs) {
    const source = sources.find(s => s.id === ref.sourceId && s.revision === ref.revision);
    if (!source) throw new AppError('INVALID_INPUT', `Evidence source ${ref.sourceId}@${ref.revision} does not exist`);
    if (ref.quote !== null && !source.text.includes(ref.quote)) throw new AppError('INVALID_INPUT', `Evidence quote is not a literal excerpt of ${ref.sourceId}`);
    if (ref.observationId !== null) {
      const observation = observations.find(o => o.id === ref.observationId || o.auditEventId === ref.observationId);
      if (!observation || !observation.evidenceRefs.some(e => e.sourceId === source.id && e.revision === source.revision)) {
        throw new AppError('INVALID_INPUT', `Observation ${ref.observationId} does not support source ${ref.sourceId}`);
      }
    }
    if (!ref.quote && !ref.observationId) throw new AppError('INVALID_INPUT', 'Evidence needs a literal quote or an observation');
  }
}

export class FalkorGraphStore implements GraphStore {
  private traces: QueryTrace[] = [];
  private readonly traceScope = new AsyncLocalStorage<QueryTrace[]>();
  private unavailable = false;
  private disconnectPromise: Promise<void> | null = null;
  private readonly queryTimeoutMs: number;
  constructor(private driver: QueryDriver, private disconnect: () => Promise<void> = async () => {}, options: { queryTimeoutMs?: number } = {}) {
    this.queryTimeoutMs = options.queryTimeoutMs ?? 5000;
    if (!Number.isFinite(this.queryTimeoutMs) || this.queryTimeoutMs <= 0) throw new AppError('INVALID_INPUT', 'Graph query timeout must be positive');
  }
  private disconnectOnce(): Promise<void> { return this.disconnectPromise ??= Promise.resolve().then(() => this.disconnect()); }
  async close(): Promise<void> { this.unavailable = true; await this.disconnectOnce(); }
  withTraceScope<T>(operation: () => Promise<T>): Promise<T> { return this.traceScope.run([], operation); }
  drainTraces(): QueryTrace[] {
    const scope = this.traceScope.getStore();
    if (scope) return scope.splice(0);
    const traces = this.traces; this.traces = []; return traces;
  }
  private async query(name: string, query: string, parameters: Record<string, unknown> = {}): Promise<Row[]> {
    if (this.unavailable) throw new AppError('DEPENDENCY_UNAVAILABLE', 'The graph connection is unavailable; reconnect before retrying uncertain work', 503);
    const start = performance.now();
    const scope = this.traceScope.getStore();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // A timed-out write may already have committed. Retire this connection
          // so no later mutation is dispatched behind an uncertain operation.
          this.unavailable = true;
          void this.disconnectOnce().catch(() => {});
          reject(new AppError('DEPENDENCY_UNAVAILABLE', 'FalkorDB query timed out; reconnect and reconcile before retrying', 503, { query: name }));
        }, this.queryTimeoutMs);
      });
      const result = await Promise.race([this.driver.query(query, { params: parameters }), timeout]);
      const rows = (result.data ?? []) as Row[];
      const traces = scope ?? this.traces;
      traces.push({ name, query, parameters, rowCount: rows.length, durationMs: Math.round(performance.now() - start) });
      if (traces.length > 200) traces.shift();
      return rows;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'FalkorDB query failed; no cached policy is used', 503, { query: name, cause: error instanceof Error ? error.message : String(error) });
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  private async statement(name: string, statement: Statement): Promise<Row[]> { return this.query(name, statement.clauses.join('\n'), statement.params); }
  async ping(): Promise<void> { await this.query('health', 'RETURN 1 AS ok'); }
  async reset(seed: HistorySeed): Promise<void> { HistorySeedSchema.parse(seed); await this.query('reset', 'MATCH (n) DETACH DELETE n'); await this.seed(seed); }
  async seed(input: HistorySeed): Promise<void> {
    const seed = HistorySeedSchema.parse(input);
    for (const source of seed.sources) assertSource(source);
    const allIds = [...seed.people, ...seed.roles, ...seed.processes, ...seed.cases, ...seed.observations].map(x => x.id);
    if (new Set(allIds).size !== allIds.length) throw new AppError('INVALID_INPUT', 'Seed contains duplicate IDs');
    if (new Set(seed.sources.map(s => sourceKey(s.id, s.revision))).size !== seed.sources.length) throw new AppError('INVALID_INPUT', 'Seed contains duplicate source revisions');
    const need = (valid: boolean, message: string) => { if (!valid) throw new AppError('INVALID_INPUT', message); };
    for (const p of seed.processes) { need(seed.people.some(x => x.id === p.ownerPersonId), 'Process owner is missing'); for (const operator of p.operatorPersonIds) need(seed.people.some(x => x.id === operator), 'Process operator is missing'); }
    for (const a of seed.roleAssignments) { need(seed.people.some(x => x.id === a.personId), 'Assignment person is missing'); need(seed.roles.some(x => x.id === a.roleId), 'Assignment role is missing'); }
    for (const c of seed.cases) {
      need(seed.processes.some(x => x.id === c.processId), 'Case process is missing');
      for (const ref of c.sourceRefs) need(seed.sources.some(s => s.id === ref.sourceId && s.revision === ref.revision), 'Case source is missing');
      for (const id of c.observationIds) need(seed.observations.some(o => o.id === id && o.caseId === c.id), 'Case observation is missing or misassigned');
    }
    for (const o of seed.observations) { need(seed.cases.some(c => c.id === o.caseId && c.observationIds.includes(o.id)), 'Observation case is missing or misassigned'); need(seed.people.some(p => p.id === o.actorPersonId), 'Observation actor is missing'); }
    for (const item of [...seed.people, ...seed.roles, ...seed.roleAssignments, ...seed.observations]) assertEvidence(item.evidenceRefs, seed.sources, seed.observations);
    for (const process of seed.processes) assertEvidence([...process.ownerEvidenceRefs, ...process.operatorEvidenceRefs], seed.sources, seed.observations);
    const existing = await this.query('seed_exists', 'MATCH (m:Metadata {id: \'athena\'}) RETURN m.datasetId AS datasetId');
    if (existing.length) {
      if (existing[0].datasetId !== seed.datasetId) throw new AppError('CONFLICT', 'A different dataset is already imported; reset explicitly');
      for (const source of seed.sources) { const stored = await this.getSource(source.id, source.revision); if (!stored || stableStringify(stored) !== stableStringify(source)) throw new AppError('CONFLICT', 'Imported sources are immutable'); }
      return;
    }
    const s = new Statement();
    s.node('Metadata', { id: 'athena' }, { datasetId: seed.datasetId, knowledgeRevision: 0, eventSequence: 0 });
    for (const source of seed.sources) s.node('Source', source, { key: sourceKey(source.id, source.revision), revision: source.revision, kind: source.kind, contentHash: source.contentHash });
    for (const person of seed.people) s.node('Person', person);
    for (const role of seed.roles) s.node('Role', role);
    for (const process of seed.processes) s.node('Process', process);
    for (const c of seed.cases) s.node('Case', c);
    for (const o of seed.observations) s.node('ActionObservation', o, { key: o.id, auditEventId: o.auditEventId, sequence: o.sequence });
    for (const process of seed.processes) {
      s.edge('Person', 'id', process.ownerPersonId, 'OWNS', 'Process', 'id', process.id, { revision: process.ownershipRevision, evidenceRefs: JSON.stringify(process.ownerEvidenceRefs) });
      for (const operator of process.operatorPersonIds) s.edge('Person', 'id', operator, 'OPERATES', 'Process', 'id', process.id, { evidenceRefs: JSON.stringify(process.operatorEvidenceRefs) });
    }
    for (const assignment of seed.roleAssignments) s.edge('Person', 'id', assignment.personId, 'HOLDS_ROLE', 'Role', 'id', assignment.roleId, { id: assignment.id, revision: assignment.revision, validFrom: assignment.validFrom, ...(assignment.validTo ? { validTo: assignment.validTo } : {}), json: JSON.stringify(assignment) });
    for (const c of seed.cases) {
      s.edge('Case', 'id', c.id, 'INSTANCE_OF', 'Process', 'id', c.processId);
      for (const ref of c.sourceRefs) s.edge('Case', 'id', c.id, 'SUPPORTED_BY', 'Source', 'key', sourceKey(ref.sourceId, ref.revision), { sourceId: ref.sourceId, revision: ref.revision });
    }
    for (const o of seed.observations) { s.edge('Case', 'id', o.caseId, 'HAS_OBSERVATION', 'ActionObservation', 'id', o.id); s.evidence('ActionObservation', o.id, o.evidenceRefs); }
    await this.statement('seed_history', s);
  }
  async getKnowledgeRevision(): Promise<number> {
    const rows = await this.query('knowledge_revision', 'MATCH (m:Metadata {id: \'athena\'}) RETURN m.knowledgeRevision AS revision');
    if (!rows.length) throw new AppError('NEEDS_TEACHING', 'Import company history first', 409);
    return Number(rows[0].revision);
  }
  async getDirectory(): Promise<Directory> {
    const people = (await this.query('directory_people', 'MATCH (n:Person) RETURN n.json AS json ORDER BY n.id')).map(r => record<Person>(r.json));
    const roles = (await this.query('directory_roles', 'MATCH (n:Role) RETURN n.json AS json ORDER BY n.id')).map(r => record<Role>(r.json));
    const assignments = (await this.query('directory_assignments', 'MATCH (p:Person)-[a:HOLDS_ROLE]->(r:Role) RETURN a.json AS json, a.validTo AS validTo, a.validFrom AS validFrom, a.revision AS revision, p.id AS personId, r.id AS roleId')).map(r => ({ ...record<Assignment>(r.json), validTo: (r.validTo ?? null) as string | null, validFrom: String(r.validFrom), revision: Number(r.revision), personId: String(r.personId), roleId: String(r.roleId) }));
    const processRows = await this.query('directory_processes', `MATCH (p:Process) OPTIONAL MATCH (owner:Person)-[o:OWNS]->(p) OPTIONAL MATCH (operator:Person)-[:OPERATES]->(p)
      RETURN p.json AS json, collect(DISTINCT owner.id) AS owners, collect(DISTINCT operator.id) AS operators, collect(DISTINCT o.revision) AS revisions`);
    const processes = processRows.map(r => {
      const owners = (r.owners as string[]).filter(Boolean);
      if (owners.length !== 1) throw new AppError('AMBIGUOUS_AUTHORITY', 'Process must have exactly one current owner', 409);
      return { ...record<Process>(r.json), ownerPersonId: owners[0], operatorPersonIds: (r.operators as string[]).filter(Boolean), ownershipRevision: Number((r.revisions as number[])[0]) };
    });
    return { people, roles, assignments, processes };
  }
  async getState(): Promise<State> {
    const directory = await this.getDirectory();
    const metadata = await this.query('state_revision', 'MATCH (m:Metadata {id: \'athena\'}) RETURN m.knowledgeRevision AS revision');
    const counts = await this.query('state_counts', 'MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count');
    const procedureRows = await this.query('state_procedures', 'MATCH (n:Procedure) RETURN n.id AS id ORDER BY n.createdAt DESC');
    const procedures: Procedure[] = [];
    for (const row of procedureRows) { const p = await this.getProcedure(String(row.id)); if (p) procedures.push(p); }
    return { ...directory, knowledgeRevision: Number(metadata[0]?.revision ?? 0), counts: Object.fromEntries(counts.map(r => [String(r.label), Number(r.count)])), procedures,
      cases: (await this.query('state_cases', 'MATCH (n:Case) RETURN n.json AS json ORDER BY n.id')).map(r => record(r.json)),
      requests: (await this.query('state_requests', 'MATCH (n:Request) RETURN n.json AS json ORDER BY n.createdAt DESC')).map(r => record(r.json)),
      learningRuns: (await this.query('state_learning', 'MATCH (n:LearningRun) RETURN n.json AS json ORDER BY n.createdAt DESC')).map(r => record(r.json)),
    };
  }
  async getHistory(processId: string, caseIds: string[] = []): Promise<HistoryBundle> {
    const rows = await this.query('Q1_history_evidence', QUERIES.history, { processId, caseIds });
    const extraSources = await this.query('Q1_case_sources', QUERIES.historySources, { processId, caseIds });
    const sourceRows = [...rows.map(r => record<Source>(r.sourceJson)), ...extraSources.map(r => record<Source>(r.json))];
    const result = { cases: unique(rows.map(r => record<HistoryBundle['cases'][number]>(r.caseJson))), observations: unique(rows.map(r => record<HistoryBundle['observations'][number]>(r.observationJson))), sources: [...new Map(sourceRows.map(source => [sourceKey(source.id, source.revision), source])).values()] };
    result.sources.forEach(assertSource);
    if (caseIds.some(id => !result.cases.some(c => c.id === id))) throw new AppError('NOT_FOUND', 'Requested history case is missing or belongs to another process', 404);
    return result;
  }
  async getSource(id: string, revision?: number): Promise<Source | null> {
    const rows = await this.query('source', `MATCH (s:Source {id: $id}) ${revision === undefined ? '' : 'WHERE s.revision = $revision'} RETURN s.json AS json ORDER BY s.revision DESC LIMIT 1`, { id, ...(revision === undefined ? {} : { revision }) });
    if (!rows.length) return null;
    const source = record<Source>(rows[0].json); assertSource(source);
    if (source.id !== id || (revision !== undefined && source.revision !== revision)) throw new AppError('INVALID_INPUT', 'Graph source identity does not match its requested revision');
    return source;
  }
  async validateEvidence(refs: EvidenceRef[]): Promise<void> {
    const sources: Source[] = [];
    const observations: HistoryBundle['observations'] = [];
    for (const ref of refs) {
      if (!sources.some(s => s.id === ref.sourceId && s.revision === ref.revision)) { const source = await this.getSource(ref.sourceId, ref.revision); if (source) sources.push(source); }
      if (ref.observationId) {
        const rows = await this.query('evidence_observation', `MATCH (o:ActionObservation)-[:SUPPORTED_BY]->(s:Source {key: $sourceKey}) WHERE o.id = $id OR o.auditEventId = $id RETURN o.json AS json`, { id: ref.observationId, sourceKey: sourceKey(ref.sourceId, ref.revision) });
        observations.push(...rows.map(r => record<HistoryBundle['observations'][number]>(r.json)));
      }
    }
    assertEvidence(refs, sources, observations);
  }
  private refs(row: Row): { evidenceRefs: EvidenceRef[]; confirmationRefs: EvidenceRef[] } {
    const refs = ((row.refs ?? []) as string[]).filter(Boolean).map(s => record<EvidenceRef & { confirmation: boolean }>(s));
    const plain = (ref: EvidenceRef & { confirmation: boolean }) => { const { confirmation: _, ...evidence } = ref; return evidence; };
    return { evidenceRefs: refs.filter(r => !r.confirmation).map(plain), confirmationRefs: refs.filter(r => r.confirmation).map(plain) };
  }
  private async hydrateProcedure(row: Row): Promise<Procedure> {
    const raw = record<Procedure>(row.json);
    const steps = (await this.query('Q2_procedure_steps_dependencies_sources', QUERIES.steps, { procedureId: row.id })).map(r => ({ ...record<Step>(r.json), dependsOn: ((r.dependencies ?? []) as string[]).filter(Boolean), ...this.refs(r) }));
    const rules = (await this.query('Q2_procedure_rules_roles_sources', QUERIES.rules, { procedureId: row.id })).map(r => {
      const rule = record<Rule>(r.json); const roleIds = ((r.roleIds ?? []) as string[]).filter(Boolean);
      if (roleIds.length > 1 || (rule.outcome === 'require_approval' && roleIds.length !== 1)) throw new AppError('AMBIGUOUS_AUTHORITY', `Rule ${rule.id} has missing or ambiguous role edges`, 409);
      return { ...rule, requiredRoleId: roleIds[0] ?? null, ...this.refs(r) };
    });
    if (row.status === 'PUBLISHED' && (!steps.length || !rules.length || [...steps, ...rules].some(x => !x.confirmationRefs.length))) throw new AppError('NEEDS_TEACHING', 'Published procedure is missing graph steps, rules, or confirming source links', 409);
    return ProcedureSchema.parse({ ...raw, status: row.status, knowledgeRevision: Number(row.knowledgeRevision), steps, rules });
  }
  async getCurrentProcedure(processId: string): Promise<Procedure | null> {
    const rows = await this.query('Q2_current_procedure', QUERIES.currentProcedure, { processId });
    if (rows.length > 1) throw new AppError('CONFLICT', 'Multiple published procedures exist for this process', 409);
    return rows.length ? this.hydrateProcedure(rows[0]) : null;
  }
  async getProcedure(id: string): Promise<Procedure | null> { const rows = await this.query('Q2_procedure', QUERIES.procedure, { id }); return rows.length ? this.hydrateProcedure(rows[0]) : null; }
  private addProcedure(s: Statement, procedure: Procedure): void {
    s.node('Procedure', procedure, { status: procedure.status, knowledgeRevision: procedure.knowledgeRevision, createdAt: procedure.createdAt });
    s.edge('Procedure', 'id', procedure.id, 'FOR_PROCESS', 'Process', 'id', procedure.processId);
    for (const step of procedure.steps) {
      const key = `${procedure.id}/${step.id}`; s.node('Step', step, { key, procedureId: procedure.id });
      s.edge('Procedure', 'id', procedure.id, 'HAS_STEP', 'Step', 'key', key);
      s.evidence('Step', key, step.evidenceRefs); s.evidence('Step', key, step.confirmationRefs, true);
    }
    for (const step of procedure.steps) for (const before of step.dependsOn) s.edge('Step', 'key', `${procedure.id}/${before}`, 'PRECEDES', 'Step', 'key', `${procedure.id}/${step.id}`);
    for (const rule of procedure.rules) {
      const key = `${procedure.id}/${rule.id}`; s.node('Rule', rule, { key, kind: rule.kind, status: rule.status });
      s.edge('Procedure', 'id', procedure.id, 'HAS_RULE', 'Rule', 'key', key);
      if (rule.requiredRoleId) s.edge('Rule', 'key', key, 'REQUIRES_ROLE', 'Role', 'id', rule.requiredRoleId);
      s.evidence('Rule', key, rule.evidenceRefs); s.evidence('Rule', key, rule.confirmationRefs, true);
    }
  }
  private async validateProcedure(procedure: Procedure, confirmation?: Source): Promise<void> {
    ProcedureSchema.parse(procedure);
    const ids = procedure.steps.map(s => s.id);
    if (new Set(ids).size !== ids.length || new Set(procedure.rules.map(r => r.id)).size !== procedure.rules.length) throw new AppError('INVALID_INPUT', 'Duplicate procedure step or rule IDs');
    const visited = new Set<string>(); const active = new Set<string>();
    const visit = (id: string) => { if (active.has(id)) throw new AppError('INVALID_INPUT', 'Procedure dependencies contain a cycle'); if (visited.has(id)) return; const step = procedure.steps.find(s => s.id === id); if (!step) throw new AppError('INVALID_INPUT', `Unknown step dependency ${id}`); active.add(id); step.dependsOn.forEach(visit); active.delete(id); visited.add(id); };
    ids.forEach(visit);
    const directory = await this.getDirectory();
    if (!directory.processes.some(p => p.id === procedure.processId)) throw new AppError('NOT_FOUND', 'Procedure process not found', 404);
    for (const rule of procedure.rules) if (rule.requiredRoleId && !directory.roles.some(r => r.id === rule.requiredRoleId)) throw new AppError('INVALID_INPUT', `Unknown role ${rule.requiredRoleId}`);
    const refs = [...procedure.observedPatterns, ...procedure.uncertainties, ...procedure.rules, ...procedure.steps].flatMap(x => x.evidenceRefs);
    const confirmations = [...procedure.rules, ...procedure.steps].flatMap(x => x.confirmationRefs);
    await this.validateEvidence(refs.filter(r => !confirmation || r.sourceId !== confirmation.id || r.revision !== confirmation.revision));
    if (confirmation) assertEvidence([...refs, ...confirmations].filter(r => r.sourceId === confirmation.id && r.revision === confirmation.revision), [confirmation], []);
    await this.validateEvidence(confirmations.filter(r => !confirmation || r.sourceId !== confirmation.id || r.revision !== confirmation.revision));
  }
  async saveDraft(procedure: Procedure): Promise<void> {
    if (!['DRAFT', 'NEEDS_REVIEW'].includes(procedure.status)) throw new AppError('INVALID_INPUT', 'Only drafts may be saved');
    await this.validateProcedure(procedure);
    const existing = await this.getProcedure(procedure.id);
    if (existing && ['PUBLISHED', 'SUPERSEDED'].includes(existing.status)) throw new AppError('CONFLICT', 'Published procedure versions are immutable', 409);
    const s = new Statement();
    if (existing) s.clauses.push(`MATCH (old:Procedure {id: ${s.value(procedure.id)}}) OPTIONAL MATCH (old)-[:HAS_STEP|HAS_RULE]->(child) DETACH DELETE old, child WITH count(*) AS removed`);
    this.addProcedure(s, procedure);
    await this.statement('save_draft', s);
  }
  async publish(input: Procedure, confirmation: Source, actorId: string, expectedRevision: number): Promise<Procedure> {
    assertSource(confirmation);
    const directory = await this.getDirectory(); const process = directory.processes.find(p => p.id === input.processId);
    if (!process || process.ownerPersonId !== actorId) throw new AppError('FORBIDDEN', 'Only the process owner may publish its procedure', 403);
    if (confirmation.kind !== 'confirmation' || !confirmation.authorPersonIds.includes(actorId)) throw new AppError('INVALID_INPUT', 'Publication needs an owner-authored confirmation source');
    if (await this.getKnowledgeRevision() !== expectedRevision) throw new AppError('STALE_PLAN', 'Knowledge changed during review', 409);
    const existing = await this.getProcedure(input.id);
    if (existing && ['PUBLISHED', 'SUPERSEDED'].includes(existing.status)) throw new AppError('CONFLICT', 'Publish a new immutable procedure version', 409);
    if (await this.getSource(confirmation.id, confirmation.revision)) throw new AppError('CONFLICT', 'Confirmation source already exists', 409);
    const published: Procedure = { ...input, status: 'PUBLISHED', publishedAt: new Date().toISOString(), publishedBy: actorId, knowledgeRevision: expectedRevision + 1, confirmationSourceId: confirmation.id };
    if (published.rules.some(r => r.status !== 'CONFIRMED') || [...published.rules, ...published.steps].some(x => !x.confirmationRefs.some(r => r.sourceId === confirmation.id && r.revision === confirmation.revision))) throw new AppError('INVALID_INPUT', 'Every published rule and step requires this owner confirmation');
    await this.validateProcedure(published, confirmation);
    const s = new Statement();
    s.clauses.push(`MATCH (meta:Metadata {id: 'athena'}) WHERE meta.knowledgeRevision = ${s.value(expectedRevision)} SET meta.knowledgeRevision = meta.knowledgeRevision + 1 WITH meta`);
    s.clauses.push(`OPTIONAL MATCH (old:Procedure {status: 'PUBLISHED'})-[:FOR_PROCESS]->(:Process {id: ${s.value(published.processId)}}) SET old.status = 'SUPERSEDED' WITH meta`);
    if (existing) s.clauses.push(`MATCH (draft:Procedure {id: ${s.value(input.id)}}) OPTIONAL MATCH (draft)-[:HAS_STEP|HAS_RULE]->(child) DETACH DELETE draft, child WITH DISTINCT meta`);
    s.node('Source', confirmation, { key: sourceKey(confirmation.id, confirmation.revision), revision: confirmation.revision, kind: confirmation.kind, contentHash: confirmation.contentHash });
    this.addProcedure(s, published);
    s.clauses.push('RETURN meta.knowledgeRevision AS revision');
    if (!(await this.statement('publish_reviewed_procedure', s)).length) throw new AppError('STALE_PLAN', 'Knowledge changed during publication', 409);
    return published;
  }
  async resolveAuthority(roleId: string, now: string): Promise<{ person: Person; assignment: Assignment }> {
    const rows = await this.query('Q3_current_role_holder', QUERIES.authority, { roleId, now });
    if (rows.length !== 1) throw new AppError('AMBIGUOUS_AUTHORITY', rows.length ? 'More than one person currently holds this approval role' : 'No current holder exists for this approval role', 409, { roleId, holderCount: rows.length });
    const r = rows[0]; const assignment = { ...record<Assignment>(r.assignmentJson), personId: String(r.personId), roleId: String(r.roleId), revision: Number(r.assignmentRevision), validFrom: String(r.validFrom), validTo: (r.validTo ?? null) as string | null };
    await this.validateEvidence(assignment.evidenceRefs);
    return { person: { ...record<Person>(r.personJson), id: String(r.personId) }, assignment };
  }
  async assignAuthority(roleId: string, personId: string, actorId: string, expectedRevision: number, source: Source): Promise<Assignment> {
    assertSource(source);
    const directory = await this.getDirectory();
    if (!directory.processes.some(p => p.ownerPersonId === actorId)) throw new AppError('FORBIDDEN', 'Only the process owner may manage authority', 403);
    if (!directory.roles.some(r => r.id === roleId) || !directory.people.some(p => p.id === personId)) throw new AppError('NOT_FOUND', 'Role or person does not exist', 404);
    if (source.kind !== 'authority' || !source.authorPersonIds.includes(actorId) || !source.text.length) throw new AppError('INVALID_INPUT', 'Authority change requires an owner-authored source');
    if (await this.getKnowledgeRevision() !== expectedRevision) throw new AppError('STALE_PLAN', 'Knowledge changed before authority assignment', 409);
    if (await this.getSource(source.id, source.revision)) throw new AppError('CONFLICT', 'Authority source already exists', 409);
    const now = new Date().toISOString(); const revision = Math.max(0, ...directory.assignments.filter(a => a.roleId === roleId).map(a => a.revision)) + 1;
    const assignment: Assignment = { id: `assignment_${roleId}_${revision}`, personId, roleId, revision, validFrom: now, validTo: null, evidenceRefs: [{ sourceId: source.id, revision: source.revision, quote: source.text, observationId: null }] };
    const s = new Statement();
    s.clauses.push(`MATCH (meta:Metadata {id: 'athena'}) WHERE meta.knowledgeRevision = ${s.value(expectedRevision)} SET meta.knowledgeRevision = meta.knowledgeRevision + 1 WITH meta`);
    s.clauses.push(`OPTIONAL MATCH (:Person)-[old:HOLDS_ROLE]->(:Role {id: ${s.value(roleId)}}) WHERE old.validTo IS NULL OR old.validTo > ${s.value(now)} SET old.validTo = ${s.value(now)} WITH DISTINCT meta`);
    s.node('Source', source, { key: sourceKey(source.id, source.revision), revision: source.revision, kind: source.kind, contentHash: source.contentHash });
    s.edge('Person', 'id', personId, 'HOLDS_ROLE', 'Role', 'id', roleId, { id: assignment.id, revision, validFrom: now, json: JSON.stringify(assignment), sourceId: source.id, sourceRevision: source.revision });
    s.clauses.push('RETURN meta.knowledgeRevision AS revision');
    if (!(await this.statement('assign_authority', s)).length) throw new AppError('STALE_PLAN', 'Knowledge changed during authority assignment', 409);
    return assignment;
  }
  private async upsert(label: string, data: { id: string }, props: Record<string, unknown> = {}): Promise<void> {
    const parameters = { id: data.id, json: JSON.stringify(data), ...props };
    await this.query(`save_${label.toLowerCase()}`, `MERGE (n:${label} {id: $id}) SET n.json = $json${Object.keys(props).map(k => `, n.${k} = $${k}`).join('')}`, parameters);
  }
  private async link(fromLabel: string, fromId: string, relation: string, toLabel: string, toId: string): Promise<void> {
    await this.query(`link_${relation.toLowerCase()}`, `MATCH (a:${fromLabel} {id: $fromId}), (b:${toLabel} {id: $toId}) MERGE (a)-[:${relation}]->(b)`, { fromId, toId });
  }
  async saveLearningRun(run: LearningRun): Promise<void> { await this.upsert('LearningRun', run, { createdAt: run.createdAt }); }
  async getLearningRun(id: string): Promise<LearningDetail | null> {
    const rows = await this.query('learning_run', 'MATCH (n:LearningRun {id: $id}) RETURN n.json AS json', { id }); if (!rows.length) return null;
    const run = record<LearningRun>(rows[0].json); const episodeRows = await this.query('learning_episode', 'MATCH (n:Episode {id: $id}) RETURN n.json AS json', { id: run.episodeId });
    return { run, candidate: run.procedureId ? await this.getProcedure(run.procedureId) : null, episode: episodeRows.length ? record<Episode>(episodeRows[0].json) : null, events: await this.getEvents(0, id) };
  }
  async saveRequest(request: TrialRequest): Promise<void> { await this.upsert('Request', request, { idempotencyKey: request.idempotencyKey, createdAt: request.createdAt }); }
  async findRequestByKey(key: string): Promise<TrialRequest | null> { const rows = await this.query('request_by_key', 'MATCH (n:Request {idempotencyKey: $key}) RETURN n.json AS json', { key }); return rows.length ? record<TrialRequest>(rows[0].json) : null; }
  async getRequest(id: string): Promise<RequestDetail | null> {
    const rows = await this.query('request', 'MATCH (n:Request {id: $id}) RETURN n.json AS json', { id }); if (!rows.length) return null;
    const request = record<TrialRequest>(rows[0].json); const plan = request.currentPlanId ? await this.getPlan(request.currentPlanId) : null;
    const approvalRows = plan ? await this.query('Q4_plan_approval_current_authority', QUERIES.approvalAuthority, { requestId: id, planId: plan.id, now: new Date().toISOString() }) : [];
    const approvals = unique(approvalRows.filter(r => r.approvalJson && r.actorId && r.roleId).map(r => ({ ...record<Approval>(r.approvalJson), actorId: String(r.actorId), roleId: String(r.roleId) })));
    const receipts = (await this.query('Q5_execution_receipts', QUERIES.receipts, { requestId: id })).map(r => record<ToolReceipt>(r.json));
    const verificationRows = await this.query('Q5_independent_verification', QUERIES.verification, { requestId: id });
    const episodes = (await this.query('request_episodes', 'MATCH (e:Episode)-[:WORKS_ON]->(:Request {id: $id}) RETURN e.json AS json ORDER BY e.startedAt', { id })).map(r => record<Episode>(r.json));
    return { request, plan, approvals, episodes, receipts, verification: verificationRows.length ? record<Verification>(verificationRows[0].json) : null, events: await this.getEvents(0, id) };
  }
  async savePlan(plan: Plan): Promise<void> {
    const old = await this.getPlan(plan.id); if (old && stableStringify(old) !== stableStringify(plan)) throw new AppError('CONFLICT', 'Plans are immutable', 409);
    await this.upsert('Plan', plan); await this.link('Request', plan.requestId, 'HAS_PLAN', 'Plan', plan.id); await this.link('Request', plan.requestId, 'USES_PROCEDURE', 'Procedure', plan.procedureId);
    if (plan.requiredApprovalRoleId) await this.link('Plan', plan.id, 'REQUIRES_ROLE', 'Role', plan.requiredApprovalRoleId);
  }
  async getPlan(id: string): Promise<Plan | null> { const rows = await this.query('plan', 'MATCH (n:Plan {id: $id}) RETURN n.json AS json', { id }); return rows.length ? record<Plan>(rows[0].json) : null; }
  async saveApproval(approval: Approval): Promise<void> { await this.upsert('Approval', approval); await this.link('Approval', approval.id, 'APPROVES', 'Plan', approval.planId); await this.link('Approval', approval.id, 'GRANTED_BY', 'Person', approval.actorId); }
  async saveEpisode(episode: Episode): Promise<void> {
    await this.upsert('Episode', episode, { startedAt: episode.startedAt });
    await this.query('episode_target', 'MATCH (e:Episode {id: $episodeId}), (target) WHERE target.id = $targetId AND (target:Request OR target:Procedure OR target:LearningRun) MERGE (e)-[:WORKS_ON]->(target)', { episodeId: episode.id, targetId: episode.targetId });
  }
  async saveReceipt(receipt: ToolReceipt): Promise<void> {
    const id = `${receipt.requestId}/${receipt.stepId}`;
    await this.query('save_receipt', 'MERGE (n:Receipt {id: $id}) SET n.json = $json, n.observedAt = $observedAt', { id, json: JSON.stringify(receipt), observedAt: receipt.observedAt });
    await this.link('Request', receipt.requestId, 'HAS_RECEIPT', 'Receipt', id);
  }
  async saveVerification(verification: Verification): Promise<void> { await this.upsert('Verification', verification, { checkedAt: verification.checkedAt }); await this.link('Request', verification.requestId, 'HAS_VERIFICATION', 'Verification', verification.id); }
  async appendEvent(event: Omit<Event, 'sequence'>): Promise<Event> {
    const rows = await this.query('append_event', `MATCH (m:Metadata {id: 'athena'}) SET m.eventSequence = m.eventSequence + 1
      CREATE (e:Event {id: $id, sequence: m.eventSequence, at: $at, targetId: $targetId, json: $json}) RETURN e.sequence AS sequence`, { id: event.id, at: event.at, targetId: event.targetId, json: JSON.stringify(event) });
    if (!rows.length) throw new AppError('NEEDS_TEACHING', 'Import history before recording events', 409);
    return { ...event, sequence: Number(rows[0].sequence) };
  }
  async getEvents(after = 0, targetId?: string): Promise<Event[]> {
    const rows = await this.query('events', `MATCH (e:Event) WHERE e.sequence > $after ${targetId ? 'AND e.targetId = $targetId' : ''} RETURN e.json AS json, e.sequence AS sequence ORDER BY e.sequence`, { after, ...(targetId ? { targetId } : {}) });
    return rows.map(r => ({ ...record<Omit<Event, 'sequence'>>(r.json), sequence: Number(r.sequence) }));
  }
}

export async function createGraphStore(options: GraphOptions = {}): Promise<GraphStore> {
  try {
    const socket = { host: options.host ?? process.env.FALKORDB_HOST ?? '127.0.0.1', port: options.port ?? Number(process.env.FALKORDB_PORT ?? 16379), connectTimeout: 5000, reconnectStrategy: false as const };
    const db = await FalkorDB.connect({ socket, password: (options.password ?? process.env.FALKORDB_PASSWORD) || undefined });
    // The client forwards socket errors through EventEmitter. The query path
    // reports these as structured failures; an unhandled emitter must not crash
    // the runtime before it can persist an unavailable-dependency state.
    db.on('error', () => {});
    const graph = db.selectGraph(options.graph ?? process.env.FALKORDB_GRAPH ?? 'athena');
    const store = new FalkorGraphStore(graph as unknown as QueryDriver, async () => { await db.close(); }, { queryTimeoutMs: options.queryTimeoutMs });
    try { await store.ping(); return store; }
    catch (error) { await store.close().catch(() => {}); throw error; }
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError('DEPENDENCY_UNAVAILABLE', 'Cannot connect to FalkorDB', 503, { cause: error instanceof Error ? error.message : String(error) }); }
}
