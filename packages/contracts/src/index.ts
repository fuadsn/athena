import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ErrorCodeSchema = z.enum(['FORBIDDEN', 'STALE_PLAN', 'APPROVAL_REQUIRED', 'AMBIGUOUS_AUTHORITY', 'NEEDS_TEACHING', 'UNSUPPORTED_REQUEST', 'DEPENDENCY_UNAVAILABLE', 'VERIFICATION_FAILED', 'INVALID_INPUT', 'CONFLICT', 'NOT_FOUND', 'BUDGET_EXCEEDED']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status = 400, public details: unknown = null) { super(message); this.name = 'AppError'; }
}
export const ApiErrorSchema = z.object({ error: z.object({ code: ErrorCodeSchema, message: z.string(), details: z.unknown().optional() }) });
export const IdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);
export const TimestampSchema = z.iso.datetime();
export const EvidenceRefSchema = z.object({ sourceId: IdSchema, revision: z.number().int().positive(), quote: z.string().min(1).nullable(), observationId: IdSchema.nullable() }).strict().refine(r => r.quote !== null || r.observationId !== null, 'A literal quote or observation is required');
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export const SourceSchema = z.object({ id: IdSchema, revision: z.number().int().positive(), kind: z.enum(['directory', 'ticket', 'chat', 'audit', 'confirmation', 'authority']), title: z.string(), occurredAt: TimestampSchema, importedAt: TimestampSchema, authorPersonIds: z.array(IdSchema), synthetic: z.literal(true), text: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type Source = z.infer<typeof SourceSchema>;
export const PersonSchema = z.object({ id: IdSchema, name: z.string(), email: z.email(), title: z.string(), evidenceRefs: z.array(EvidenceRefSchema) });
export type Person = z.infer<typeof PersonSchema>;
export const RoleSchema = z.object({ id: IdSchema, name: z.string(), evidenceRefs: z.array(EvidenceRefSchema) });
export type Role = z.infer<typeof RoleSchema>;
export const AssignmentSchema = z.object({ id: IdSchema, personId: IdSchema, roleId: IdSchema, revision: z.number().int().positive(), validFrom: TimestampSchema, validTo: TimestampSchema.nullable(), evidenceRefs: z.array(EvidenceRefSchema) });
export type Assignment = z.infer<typeof AssignmentSchema>;
export const ProcessSchema = z.object({ id: IdSchema, name: z.string(), ownerPersonId: IdSchema, operatorPersonIds: z.array(IdSchema), ownershipRevision: z.number().int(), ownerEvidenceRefs: z.array(EvidenceRefSchema), operatorEvidenceRefs: z.array(EvidenceRefSchema) });
export type Process = z.infer<typeof ProcessSchema>;
export const ObservationSchema = z.object({ id: IdSchema, caseId: IdSchema, auditEventId: IdSchema, sequence: z.number().int(), occurredAt: TimestampSchema, actorPersonId: IdSchema, action: z.string(), observedArguments: z.record(z.string(), z.unknown()), observedResult: z.record(z.string(), z.unknown()), evidenceRefs: z.array(EvidenceRefSchema) });
export type Observation = z.infer<typeof ObservationSchema>;
export const HistoryCaseSchema = z.object({ id: IdSchema, processId: IdSchema, customerId: IdSchema, customerName: z.string(), ownerEmail: z.email(), openedAt: TimestampSchema, closedAt: TimestampSchema, status: z.literal('CLOSED'), sourceRefs: z.array(z.object({ sourceId: IdSchema, revision: z.number().int() })), observationIds: z.array(IdSchema), outcome: z.record(z.string(), z.unknown()), historicalConsent: z.record(z.string(), z.unknown()).optional() });
export type HistoryCase = z.infer<typeof HistoryCaseSchema>;
export const HistorySeedSchema = z.object({ schemaVersion: z.literal('1.0.0'), datasetId: IdSchema, synthetic: z.literal(true), description: z.string(), importBoundary: z.record(z.string(), z.unknown()), company: z.object({ id: IdSchema, name: z.string() }), knowledgeRevision: z.literal(0), people: z.array(PersonSchema), processes: z.array(ProcessSchema), roles: z.array(RoleSchema), roleAssignments: z.array(AssignmentSchema), sources: z.array(SourceSchema), cases: z.array(HistoryCaseSchema), observations: z.array(ObservationSchema) }).strict();
export type HistorySeed = z.infer<typeof HistorySeedSchema>;
export type HistoryBundle = { cases: HistoryCase[]; observations: Observation[]; sources: Source[] };

export const ScalarSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
export type Scalar = z.infer<typeof ScalarSchema>;
export const RequestFieldSchema = z.enum(['requestedDays', 'ownerEmail', 'customerId', 'customerName']);
export const OperandSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('request'), key: RequestFieldSchema }).strict(), z.object({ kind: z.literal('rule'), key: IdSchema }).strict()]);
export const PredicateSchema = z.discriminatedUnion('op', [z.object({ op: z.literal('eq'), left: OperandSchema, right: OperandSchema }).strict(), z.object({ op: z.literal('in'), left: OperandSchema, right: z.array(OperandSchema).min(1).max(8) }).strict()]);
export const ConditionSchema = z.union([PredicateSchema, z.object({ op: z.literal('all'), conditions: z.array(PredicateSchema).min(1).max(8) }).strict()]);
export type Condition = z.infer<typeof ConditionSchema>;
export const RuleSchema = z.object({ id: IdSchema, key: IdSchema, kind: z.enum(['scalar', 'branch']), value: ScalarSchema.nullable(), condition: ConditionSchema.nullable(), outcome: z.enum(['permit', 'require_approval', 'clarify']).nullable(), requiredRoleId: IdSchema.nullable(), status: z.enum(['PROPOSED', 'CONFIRMED']), evidenceRefs: z.array(EvidenceRefSchema).min(1), confirmationRefs: z.array(EvidenceRefSchema) }).strict();
export type Rule = z.infer<typeof RuleSchema>;
export const ToolNameSchema = z.enum(['create_workspace', 'set_expiry', 'grant_access', 'activate_workspace', 'read_workspace', 'check_access']);
export type ToolName = z.infer<typeof ToolNameSchema>;
export const BindingSchema = z.object({ kind: z.enum(['request', 'rule', 'output', 'derived']), key: z.string().min(1), stepId: IdSchema.nullable() }).strict();
export type Binding = z.infer<typeof BindingSchema>;
export const StepSchema = z.object({ id: IdSchema, tool: ToolNameSchema, dependsOn: z.array(IdSchema), bindings: z.record(z.string(), BindingSchema), evidenceRefs: z.array(EvidenceRefSchema).min(1), confirmationRefs: z.array(EvidenceRefSchema) }).strict();
export type Step = z.infer<typeof StepSchema>;
export const CandidateContentSchema = z.object({ summary: z.string().min(1), observedPatterns: z.array(z.object({ text: z.string(), evidenceRefs: z.array(EvidenceRefSchema).min(1) }).strict()).min(1), uncertainties: z.array(z.object({ question: z.string().min(1), evidenceRefs: z.array(EvidenceRefSchema).min(1) }).strict()).min(1), rules: z.array(RuleSchema).min(1), steps: z.array(StepSchema).min(1).max(12) }).strict();
export type CandidateContent = z.infer<typeof CandidateContentSchema>;
export const ProcedureSchema = CandidateContentSchema.extend({ id: IdSchema, processId: IdSchema, version: z.number().int().nonnegative(), status: z.enum(['DRAFT', 'NEEDS_REVIEW', 'PUBLISHED', 'SUPERSEDED']), createdAt: TimestampSchema, publishedAt: TimestampSchema.nullable(), publishedBy: IdSchema.nullable(), knowledgeRevision: z.number().int().nonnegative(), confirmationSourceId: IdSchema.nullable() }).strict();
export type Procedure = z.infer<typeof ProcedureSchema>;
export type ProcedureDraft = Procedure;
export const ReviewSchema = z.object({ normalDurationDays: z.number().int().min(1).max(365), extendedDurationDays: z.number().int().min(1).max(365), accessRole: z.literal('member'), extensionApprovalRoleId: IdSchema, configureWhileInactive: z.literal(true), activateAfterConfiguration: z.literal(true), confirmAllFields: z.literal(true) }).strict().refine(r => r.extendedDurationDays > r.normalDurationDays, 'Extended duration must exceed normal duration');
export type Review = z.infer<typeof ReviewSchema>;

export const RequestStateSchema = z.enum(['QUEUED', 'PLANNING', 'WAITING_APPROVAL', 'READY', 'BLOCKED', 'EXECUTING', 'VERIFYING', 'COMPLETED', 'REJECTED', 'FAILED']);
export type RequestState = z.infer<typeof RequestStateSchema>;
export const TrialRequestInputSchema = z.object({ processId: IdSchema.default('process_trial'), customerId: IdSchema, customerName: z.string().min(1).max(160), ownerEmail: z.email(), requestedDays: z.number().int().positive().max(365).nullable().default(null), idempotencyKey: z.string().min(1).max(160) }).strict();
export type TrialRequestInput = z.infer<typeof TrialRequestInputSchema>;
export const TrialRequestSchema = z.object({ id: IdSchema, processId: IdSchema, customerId: IdSchema, customerName: z.string(), ownerEmail: z.email(), requestedDays: z.number().int().positive().nullable(), revision: z.number().int().positive(), idempotencyKey: z.string(), inputHash: z.string(), requestedBy: IdSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema, state: RequestStateSchema, reason: z.string().nullable(), errorCode: ErrorCodeSchema.nullable(), currentPlanId: IdSchema.nullable() }).strict();
export type TrialRequest = z.infer<typeof TrialRequestSchema>;
export const PlanSchema = z.object({ id: IdSchema, requestId: IdSchema, requestRevision: z.number().int().positive(), procedureId: IdSchema, knowledgeRevision: z.number().int().nonnegative(), planHash: z.string(), createdAt: TimestampSchema, parameters: z.object({ durationDays: z.number().int().positive(), accessRole: z.literal('member'), customerId: IdSchema, customerName: z.string(), ownerEmail: z.email() }).strict(), steps: z.array(StepSchema), requiredApprovalRoleId: IdSchema.nullable(), approverPersonId: IdSchema.nullable(), assignmentRevision: z.number().int().nullable(), evidenceRefs: z.array(EvidenceRefSchema), justification: z.string() }).strict();
export type Plan = z.infer<typeof PlanSchema>;
export const ApprovalSchema = z.object({ id: IdSchema, requestId: IdSchema, planId: IdSchema, planHash: z.string(), actorId: IdSchema, roleId: IdSchema, assignmentRevision: z.number().int(), knowledgeRevision: z.number().int(), decision: z.enum(['APPROVED', 'REJECTED']), createdAt: TimestampSchema, expiresAt: TimestampSchema }).strict();
export type Approval = z.infer<typeof ApprovalSchema>;
export const EpisodeSchema = z.object({ id: IdSchema, mission: z.enum(['LEARN', 'HANDLE_REQUEST']), targetId: IdSchema, startedAt: TimestampSchema, endedAt: TimestampSchema.nullable(), status: z.enum(['RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED']), initialContextMessages: z.literal(0), modelTurns: z.number().int(), toolCalls: z.number().int(), activeMs: z.number(), inputTokens: z.number().int(), outputTokens: z.number().int(), model: z.string().nullable(), error: z.string().nullable() }).strict();
export type Episode = z.infer<typeof EpisodeSchema>;
export const ToolReceiptSchema = z.object({ requestId: IdSchema, stepId: IdSchema, operationKey: z.string(), inputHash: z.string(), resourceId: IdSchema, observedAt: TimestampSchema, result: z.enum(['APPLIED', 'ALREADY_APPLIED']) }).strict();
export type ToolReceipt = z.infer<typeof ToolReceiptSchema>;
export const GrantSchema = z.object({ email: z.email(), role: z.enum(['member', 'admin', 'viewer']) }).strict();
export const WorkspaceSchema = z.object({ id: IdSchema, requestId: IdSchema, customerId: IdSchema, createdAt: TimestampSchema, expiresAt: TimestampSchema.nullable(), grants: z.array(GrantSchema), active: z.boolean() }).strict();
export type Workspace = z.infer<typeof WorkspaceSchema>;
export const LabOperationSchema = z.object({ operationKey: z.string(), inputHash: z.string(), workspace: WorkspaceSchema, receipt: ToolReceiptSchema }).strict();
export type LabOperation = z.infer<typeof LabOperationSchema>;
export const VerificationSchema = z.object({ id: IdSchema, requestId: IdSchema, planId: IdSchema, checkedAt: TimestampSchema, passed: z.boolean(), checks: z.array(z.object({ name: z.string(), passed: z.boolean(), expected: z.unknown(), actual: z.unknown() })), workspace: WorkspaceSchema.nullable(), resourceCount: z.number().int() }).strict();
export type Verification = z.infer<typeof VerificationSchema>;
export const EventSchema = z.object({ id: IdSchema, sequence: z.number().int().nonnegative(), at: TimestampSchema, actorId: z.string(), targetId: z.string(), type: z.string(), message: z.string(), data: z.record(z.string(), z.unknown()) }).strict();
export type Event = z.infer<typeof EventSchema>;
export const LearningRunSchema = z.object({ id: IdSchema, processId: IdSchema, caseIds: z.array(IdSchema), state: z.enum(['RUNNING', 'NEEDS_REVIEW', 'PUBLISHED', 'FAILED']), procedureId: IdSchema.nullable(), episodeId: IdSchema, createdAt: TimestampSchema, error: z.string().nullable() }).strict();
export type LearningRun = z.infer<typeof LearningRunSchema>;
export type RequestDetail = { request: TrialRequest; plan: Plan | null; approvals: Approval[]; episodes: Episode[]; receipts: ToolReceipt[]; verification: Verification | null; events: Event[] };
export type LearningDetail = { run: LearningRun; candidate: Procedure | null; episode: Episode | null; events: Event[] };
export type Directory = { people: Person[]; roles: Role[]; assignments: Assignment[]; processes: Process[] };
export type State = Directory & { knowledgeRevision: number; counts: Record<string, number>; cases: HistoryCase[]; procedures: Procedure[]; requests: TrialRequest[]; learningRuns: LearningRun[]; modelConfigured?: boolean; demoMode?: boolean; currentActorId?: string | null };
export type QueryTrace = { name: string; query: string; parameters: Record<string, unknown>; rowCount: number; durationMs: number };

/** A single runtime MutationBroker owns all calls that mutate this store. */
export interface GraphStore {
  close(): Promise<void>;
  ping(): Promise<void>;
  reset(seed: HistorySeed): Promise<void>;
  seed(seed: HistorySeed): Promise<void>;
  getState(): Promise<State>;
  getDirectory(): Promise<Directory>;
  getKnowledgeRevision(): Promise<number>;
  getHistory(processId: string, caseIds?: string[]): Promise<HistoryBundle>;
  getSource(id: string, revision?: number): Promise<Source | null>;
  validateEvidence(refs: EvidenceRef[]): Promise<void>;
  getCurrentProcedure(processId: string): Promise<Procedure | null>;
  getProcedure(id: string): Promise<Procedure | null>;
  saveDraft(procedure: Procedure): Promise<void>;
  publish(procedure: Procedure, confirmation: Source, actorId: string, expectedRevision: number): Promise<Procedure>;
  resolveAuthority(roleId: string, now: string): Promise<{ person: Person; assignment: Assignment }>;
  assignAuthority(roleId: string, personId: string, actorId: string, expectedRevision: number, source: Source): Promise<Assignment>;
  saveLearningRun(run: LearningRun): Promise<void>;
  getLearningRun(id: string): Promise<LearningDetail | null>;
  saveRequest(request: TrialRequest): Promise<void>;
  findRequestByKey(key: string): Promise<TrialRequest | null>;
  getRequest(id: string): Promise<RequestDetail | null>;
  savePlan(plan: Plan): Promise<void>;
  getPlan(id: string): Promise<Plan | null>;
  saveApproval(approval: Approval): Promise<void>;
  saveEpisode(episode: Episode): Promise<void>;
  saveReceipt(receipt: ToolReceipt): Promise<void>;
  saveVerification(verification: Verification): Promise<void>;
  appendEvent(event: Omit<Event, 'sequence'>): Promise<Event>;
  getEvents(after?: number, targetId?: string): Promise<Event[]>;
  drainTraces(): QueryTrace[];
}

export type ModelTool = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelCall = { id: string; name: string; arguments: unknown };
export type ModelTurn = { output: unknown[]; calls: ModelCall[]; text: string; inputTokens: number; outputTokens: number; model: string; responseId: string };
export interface ModelAdapter {
  readonly mode: 'live' | 'test';
  readonly model: string;
  turn(input: unknown[], tools: ModelTool[], signal: AbortSignal): Promise<ModelTurn>;
}
export type EpisodeHooks = { onUpdate: (episode: Episode) => Promise<void>; onEvent: (type: string, message: string, data?: Record<string, unknown>) => Promise<void> };
export const EPISODE_LIMITS = { modelTurns: 8, toolCalls: 12, activeMs: 120_000 } as const;

export const LabCreateSchema = z.object({ requestId: IdSchema, stepId: IdSchema, customerId: IdSchema, operationKey: z.string().min(1), inputHash: z.string().min(1) }).strict();
export const LabExpirySchema = z.object({ requestId: IdSchema, stepId: IdSchema, expiresAt: TimestampSchema, operationKey: z.string().min(1), inputHash: z.string().min(1) }).strict();
export const LabGrantsSchema = z.object({ requestId: IdSchema, stepId: IdSchema, grants: z.array(GrantSchema).min(1).max(20), operationKey: z.string().min(1), inputHash: z.string().min(1) }).strict();
export const LabActivateSchema = z.object({ requestId: IdSchema, stepId: IdSchema, operationKey: z.string().min(1), inputHash: z.string().min(1) }).strict();
export interface LabClient {
  create(input: z.infer<typeof LabCreateSchema>): Promise<LabOperation>;
  setExpiry(id: string, input: z.infer<typeof LabExpirySchema>): Promise<LabOperation>;
  setGrants(id: string, input: z.infer<typeof LabGrantsSchema>): Promise<LabOperation>;
  activate(id: string, input: z.infer<typeof LabActivateSchema>): Promise<LabOperation>;
  read(id: string): Promise<Workspace>;
  list(requestId: string): Promise<Workspace[]>;
  checkAccess(id: string, email: string): Promise<{ allowed: boolean; role: string | null; evaluatedAt: string }>;
  operation(key: string): Promise<LabOperation | null>;
  reset(): Promise<void>;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new AppError('INVALID_INPUT', 'Cannot hash undefined');
  return encoded;
}
export const hash = (value: unknown): string => createHash('sha256').update(stableStringify(value)).digest('hex');
export const textHash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
export function planHash(plan: Omit<Plan, 'planHash'> | Plan): string {
  const { id: _id, createdAt: _at, justification: _why, ...rest } = plan;
  const { planHash: _hash, ...identity } = rest as typeof rest & { planHash?: string };
  return hash(identity);
}
/** Hash semantic inputs, including tool and resource, excluding envelope hashes/keys. */
export function operationHash(tool: ToolName, resourceId: string | null, input: Record<string, unknown>): string {
  const { operationKey: _key, inputHash: _hash, ...parameters } = input;
  return hash({ tool, resourceId, parameters });
}
