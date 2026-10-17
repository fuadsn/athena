import seedJson from '../../../fixtures/company-history.json';
import { HistorySeedSchema, textHash, type Procedure, type Source } from '@athena/contracts';
export const seed = HistorySeedSchema.parse(seedJson);
export const makeConfirmation = (): Source => {
  const text = 'As process owner, I confirm normal trials last 7 days, extended trials last 30 days and need the current Trial Extension Approver for each request. Use member access; configure while inactive, then activate after expiry and access are correct.';
  return { id: 'source_test_confirmation', revision: 1, kind: 'confirmation', title: 'Test-only owner confirmation', occurredAt: new Date().toISOString(), importedAt: new Date().toISOString(), authorPersonIds: ['person_mira'], synthetic: true, text, contentHash: textHash(text) };
};
export function makeProcedure(confirmation: Source): Procedure {
  const evidenceRefs = [seed.observations[0].evidenceRefs[0]];
  const confirmationRefs = [{ sourceId: confirmation.id, revision: 1, quote: confirmation.text, observationId: null }];
  const binding = (kind: 'request' | 'rule' | 'output' | 'derived', key: string, stepId: string | null = null) => ({ kind, key, stepId });
  return {
    id: 'procedure_test_v1', processId: 'process_trial', version: 1, status: 'NEEDS_REVIEW', createdAt: new Date().toISOString(), publishedAt: null, publishedBy: null, knowledgeRevision: 0, confirmationSourceId: null,
    summary: 'Test-only reviewed trial procedure', observedPatterns: [{ text: 'Workspaces are created and configured.', evidenceRefs }], uncertainties: [{ question: 'Which duration is normal and which is an exception?', evidenceRefs }],
    rules: [
      ...([{ id: 'rule_normal', key: 'normalDurationDays', value: 7 }, { id: 'rule_extended', key: 'extendedDurationDays', value: 30 }, { id: 'rule_access', key: 'accessRole', value: 'member' }]).map(r => ({ ...r, kind: 'scalar' as const, condition: null, outcome: null, requiredRoleId: null, status: 'CONFIRMED' as const, evidenceRefs, confirmationRefs })),
      { id: 'rule_extended_branch', key: 'extended', kind: 'branch', value: null, condition: { op: 'eq', left: { kind: 'request', key: 'requestedDays' }, right: { kind: 'rule', key: 'extendedDurationDays' } }, outcome: 'require_approval', requiredRoleId: 'role_trial_extension_approver', status: 'CONFIRMED', evidenceRefs, confirmationRefs },
    ],
    steps: [
      { id: 'create', tool: 'create_workspace', dependsOn: [], bindings: { requestId: binding('request', 'id'), customerId: binding('request', 'customerId') }, evidenceRefs, confirmationRefs },
      { id: 'expiry', tool: 'set_expiry', dependsOn: ['create'], bindings: { workspaceId: binding('output', 'id', 'create'), expiresAt: binding('derived', 'expiryFromCreatedAt', 'create') }, evidenceRefs, confirmationRefs },
      { id: 'access', tool: 'grant_access', dependsOn: ['create'], bindings: { workspaceId: binding('output', 'id', 'create'), email: binding('request', 'ownerEmail'), role: binding('rule', 'accessRole') }, evidenceRefs, confirmationRefs },
      { id: 'activate', tool: 'activate_workspace', dependsOn: ['access', 'expiry'], bindings: { workspaceId: binding('output', 'id', 'create') }, evidenceRefs, confirmationRefs },
    ],
  };
}
