'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { EvidenceRef, HistoryCase, LearningDetail, Person, Procedure, RequestDetail, Review, Source, State, TrialRequestInput } from '@athena/contracts';

type Section = 'learn' | 'do' | 'verify';
type Notice = { kind: 'error' | 'success'; message: string; code?: string };
type Session = { actorId?: string | null; personId?: string | null; currentActorId?: string | null; demoMode?: boolean; hosted?: boolean; accessRequired?: boolean; people?: Person[] };
class ApiFailure extends Error { constructor(message: string, public code: string, public status: number) { super(message); } }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new ApiFailure(data.error?.message || 'This operation could not be completed.', data.error?.code || 'REQUEST_FAILED', response.status);
  return data as T;
}
const label = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replaceAll('_', ' ');
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    learn: <><path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z"/></>,
    do: <><path d="m9 4 11 8-11 8z"/><path d="M4 4v16"/></>,
    verify: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6"/></>,
    check: <path d="m5 12 4 4 10-10"/>,
    source: <><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    graph: <><circle cx="5" cy="5" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="11" cy="19" r="2"/><path d="m7 5 10 2M6 7l4 10m3 0 5-8"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/></>,
    alert: <><path d="m12 3 10 18H2zM12 9v4"/><circle cx="12" cy="17" r=".5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.graph}</svg>;
}
function Brand() { return <span className="brand"><span className="brand-mark"><i/><i/><i/></span>athena<span className="brand-period">.</span></span>; }
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function Status({ state }: { state: string }) { const tone = ['COMPLETED', 'PUBLISHED', 'SUCCEEDED'].includes(state) ? 'green' : ['FAILED', 'REJECTED', 'BLOCKED'].includes(state) ? 'red' : ['WAITING_APPROVAL', 'NEEDS_REVIEW'].includes(state) ? 'amber' : 'purple'; return <Badge tone={tone}><span className="status-dot"/>{label(state)}</Badge>; }
function Empty({ icon, title, children }: { icon: string; title: string; children: ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={28}/></span><h3>{title}</h3><p>{children}</p></div>; }
function DemoGuide() {
  return <details className="demo-guide">
    <summary>How to try this demo<span>People, example inputs, and expected results</span></summary>
    <div className="demo-guide-content">
      <p>HelioWorks gives customers trial workspaces. Use <strong>Demo persona</strong> at the top to play each person. The settings below are examples for this walkthrough.</p>
      <ol>
        <li><strong>Mira teaches the policy</strong><p>In <b>Learn</b>, open a case’s source, then choose <b>Learn from these cases</b>. Review the result: set a normal trial to <b>7 days</b>, an extended trial to <b>30 days</b>, access to <b>Member</b>, and approval to <b>Trial Extension Approver</b>. Check all three confirmations and publish. If a policy is already published, use its confirmed durations in the next step.</p></li>
        <li><strong>Ana requests a workspace</strong><p>Switch to <b>Ana</b> and open <b>Do</b>. Enter <b>Atlas Robotics</b>, <code>owner@atlas.example</code>, and <b>30</b> days. Choose <b>Create trial request</b>. Expect it to wait for the current approver, initially Ravi. Use a new customer if you repeat this example.</p></li>
        <li><strong>The approver authorizes the work</strong><p>Switch to the person named on the approval card and choose <b>Approve this plan</b>. After execution, choose <b>Inspect outcome</b>. <b>Verify</b> shows the actual workspace, access, expiry, and independent checks.</p></li>
        <li><strong>Change one relationship in the graph</strong><p>As <b>Mira</b>, open <b>Demo controls</b>, assign <b>Trial Extension Approver</b> to <b>Leena</b>, and choose <b>Update authority</b>. As Ana, request another 30-day trial for <b>Orion Instruments</b>, <code>owner@orion.example</code>. It now waits for Leena. Open <b>Activity & graph evidence</b> to inspect the query behind that decision.</p></li>
      </ol>
      <p className="demo-guide-result">What to look for: the company remembers the policy and current approver in FalkorDB. Each new agent retrieves that knowledge before acting.</p>
    </div>
  </details>;
}
function Evidence({ refs, open, text = 'View evidence' }: { refs: EvidenceRef[]; open: (ref: EvidenceRef) => void; text?: string }) {
  const unique = refs.filter((r, index, all) => index === all.findIndex(item => item.sourceId === r.sourceId && item.revision === r.revision));
  return <div className="evidence-links">{unique.map((ref, i) => <button className="text-button evidence-link" key={`${ref.sourceId}-${ref.revision}`} onClick={() => open(ref)}><Icon name="source" size={14}/>{unique.length === 1 ? text : `${text} ${i + 1}`}</button>)}</div>;
}
function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><Icon name="close"/></button></div>{children}</dialog>;
}

export function AthenaWorkspace() {
  const [section, setSection] = useState<Section>('learn');
  const [state, setState] = useState<State | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [connected, setConnected] = useState(false);
  const [learningId, setLearningId] = useState<string | null>(null);
  const [learning, setLearning] = useState<LearningDetail | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRef | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [controls, setControls] = useState(false);
  const [revisionReview, setRevisionReview] = useState(false);
  const actorId = state?.currentActorId ?? session?.actorId ?? session?.personId ?? session?.currentActorId ?? null;
  const actor = state?.people.find(p => p.id === actorId);
  const trialProcess = state?.processes[0];
  const owner = actorId === trialProcess?.ownerPersonId;
  const published = state?.procedures.find(p => p.status === 'PUBLISHED');
  const candidate = learning?.candidate ?? null;

  const report = useCallback((error: unknown) => { setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'An unexpected error occurred.', code: error instanceof ApiFailure ? error.code : undefined }); }, []);
  const refresh = useCallback(async () => {
    try { const next = await api<State>('/state'); setState(next); setConnected(true); return next; }
    catch (error) { setConnected(false); throw error; }
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await api<Session>('/session');
        if (!active) return;
        setSession(current);
        if (current.actorId || current.personId || current.currentActorId) await refresh();
      } catch (error) { if (active) report(error); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [refresh, report]);
  useEffect(() => {
    if (!state) return;
    if (!learningId && state.learningRuns.length) setLearningId([...state.learningRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!.id);
    if (!requestId && state.requests.length) setRequestId([...state.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!.id);
  }, [state, learningId, requestId]);
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    const update = async () => {
      try {
        const [nextState, nextLearning, nextRequest] = await Promise.all([
          api<State>('/state'),
          learningId ? api<LearningDetail>(`/learning-runs/${learningId}`) : Promise.resolve(null),
          requestId ? api<RequestDetail>(`/requests/${requestId}`) : Promise.resolve(null),
        ]);
        if (!cancelled) { setState(nextState); setLearning(nextLearning); setRequest(nextRequest); setConnected(true); }
      } catch (error) { if (!cancelled) { setConnected(false); if (!(error instanceof ApiFailure && error.status === 404)) report(error); } }
    };
    void update();
    const interval = setInterval(() => { void update(); }, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  // Keep polling keyed to session and selection, never to each fetched state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(state), learningId, requestId, actorId, report]);
  useEffect(() => {
    if (!evidence) return;
    let active = true;
    setSource(null); setSourceError(null);
    void api<Source>(`/sources/${encodeURIComponent(evidence.sourceId)}?revision=${evidence.revision}`).then(result => { if (active) setSource(result); }).catch(error => { if (active) setSourceError(error.message); });
    return () => { active = false; };
  }, [evidence]);

  async function action(key: string, run: () => Promise<void>) { setBusy(key); setNotice(null); try { await run(); } catch (error) { report(error); } finally { setBusy(null); } }
  async function selectPersona(personId: string) { await action('session', async () => { setSession(await api<Session>('/session', { personId, ...(session?.accessRequired ? { accessCode } : {}) })); setAccessCode(''); await refresh(); }); }
  async function startLearning() { await action('learn', async () => { const result = await api<{ id?: string; run?: { id: string }; runId?: string }>('/learning-runs', { caseIds: state!.cases.map(c => c.id) }); setLearningId(result.id || result.runId || result.run?.id || null); setLearning(null); }); }
  async function publish(review: Review, procedure: Procedure) { await action('publish', async () => { await api(`/procedures/${procedure.id}/publish`, { review, expectedRevision: state!.knowledgeRevision }); await refresh(); if (learningId) setLearning(await api<LearningDetail>(`/learning-runs/${learningId}`)); setRevisionReview(false); setNotice({ kind: 'success', message: 'Procedure published. A fresh agent can now retrieve your confirmed policy from FalkorDB.' }); }); }
  async function submitRequest(input: TrialRequestInput) { await action('request', async () => { const result = await api<{ id?: string; requestId?: string; request?: { id: string } }>('/requests', input); const id = result.id || result.requestId || result.request?.id; if (!id) throw new Error('The runtime did not return a request ID. Refresh before trying again.'); setRequestId(id); setRequest(await api<RequestDetail>(`/requests/${id}`)); await refresh(); }); }
  async function approve(decision: 'APPROVED' | 'REJECTED') { if (!request?.plan) return; await action('approval', async () => { await api(`/plans/${request.plan!.id}/approval`, { planHash: request.plan!.planHash, decision }); setRequest(await api<RequestDetail>(`/requests/${request.request.id}`)); await refresh(); }); }
  async function resume() { if (!request) return; await action('resume', async () => { await api(`/requests/${request.request.id}/resume`, {}); setRequest(await api<RequestDetail>(`/requests/${request.request.id}`)); await refresh(); }); }
  const openEvidence = (ref: EvidenceRef) => setEvidence(ref);
  const selectRequest = (id: string) => { setRequestId(id); setRequest(null); };

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand-link" aria-label="Athena home"><Brand/></a>
      <div className="company"><span className="company-avatar">H</span><div><strong>HelioWorks</strong><span>Company workspace</span></div><Badge>Demo</Badge></div>
      <div className="nav-label">THE COMPANY BRAIN</div>
      <nav aria-label="Main navigation">{(['learn', 'do', 'verify'] as const).map((tab, index) => <button key={tab} className={`nav-item ${section === tab ? 'active' : ''}`} aria-label={tab === 'learn' ? 'Learn' : tab === 'do' ? 'Do' : 'Verify'} onClick={() => setSection(tab)} aria-current={section === tab ? 'page' : undefined}><Icon name={tab}/><span>{tab === 'learn' ? 'Learn' : tab === 'do' ? 'Do' : 'Verify'}</span><span className="nav-number">0{index + 1}</span></button>)}</nav>
      <div className="sidebar-note"><Icon name="graph" size={23}/><p>Knowledge that stays.<br/>Agents that start fresh.</p><span>Powered by FalkorDB</span></div>
      <div className="sidebar-bottom"><button className="controls-button" onClick={() => setControls(true)} disabled={!state || !state.demoMode}><Icon name="settings" size={18}/>Demo controls</button><div className="connection"><span className={`status-dot ${connected ? 'online' : ''}`}/>{connected ? 'Connected to company graph' : state ? 'Connection interrupted' : session?.hosted ? 'Hosted demo environment' : 'Local demo environment'}</div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{section === 'learn' ? 'Learn a procedure' : section === 'do' ? 'Put knowledge to work' : 'Verify the outcome'}</strong></div><div className="persona">{state && <><span className="persona-caption">DEMO PERSONA</span><span className="avatar">{actor?.name[0] || '?'}</span><select aria-label="Demo persona" value={actorId || ''} onChange={e => void selectPersona(e.target.value)} disabled={!!busy || !state.demoMode}>{state.people.map(person => <option key={person.id} value={person.id}>{person.name} · {person.title}</option>)}</select></>}</div></header>
      <main>
        {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`notice ${notice.kind}`}><Icon name={notice.kind === 'error' ? 'alert' : 'check'} size={18}/><div>{notice.code && <strong>{label(notice.code)}. </strong>}{notice.message}</div><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" size={16}/></button></div>}
        {state && !connected && <div className="notice error" role="status">The graph is unavailable. Displayed records may be stale; changes cannot safely continue.</div>}
        {loading ? <div className="loading-page"><span className="spinner"/><p>Connecting to Athena…</p></div> : !state ? <div className="welcome"><span className="eyebrow">MEET YOUR COMPANY BRAIN</span><h1>Your company knows how.<br/><span>Now your agents do, too.</span></h1><p>HelioWorks gives customers trial workspaces. Teach Athena the policy, request a new trial, and see the right person approve it before the result is verified.</p><div className="welcome-steps"><span><Icon name="learn"/>Learn from evidence</span><span><Icon name="do"/>Act with authority</span><span><Icon name="verify"/>Verify the outcome</span></div>{session?.accessRequired && <label className="demo-access">Demo access code<input type="password" autoComplete="current-password" value={accessCode} onChange={event => setAccessCode(event.target.value)} placeholder="Code supplied with the submission"/></label>}{session?.demoMode !== false && <button className="button primary" disabled={!!busy} onClick={() => void selectPersona(session?.people?.find(person => person.id === 'person_mira')?.id || session?.people?.[0]?.id || 'person_mira')}>{busy ? 'Connecting…' : session?.hosted ? 'Enter hosted demo' : 'Enter local demo'}<Icon name="arrow" size={17}/></button>}<small>Four synthetic personas. One real workspace application.</small></div> : <>
          <div className="page-heading"><div><span className="eyebrow">{section === 'learn' ? '01 / LEARN' : section === 'do' ? '02 / DO' : '03 / VERIFY'}</span><h1>{section === 'learn' ? 'From experience to expertise.' : section === 'do' ? 'Knowledge, put to work.' : 'Proof of work.'}</h1><p>{section === 'learn' ? 'A procedure grounded in your history. A policy confirmed by your team.' : section === 'do' ? 'A fresh agent. Your reviewed procedure. The right authority, right now.' : 'Completion comes from the actual workspace, independently checked.'}</p></div><div className="graph-revision"><Icon name="graph" size={17}/><span>Knowledge revision <strong>{state.knowledgeRevision}</strong></span></div></div>
          <div className="journey-strip"><div className="journey-item"><span className={`journey-icon ${state.cases.length ? 'done' : ''}`}><Icon name="source" size={16}/></span><span><strong>{state.cases.length} historical cases</strong><small>Evidence, imported</small></span></div><span className="journey-line"/><div className="journey-item"><span className={`journey-icon ${published ? 'done' : ''}`}><Icon name="learn" size={16}/></span><span><strong>{published ? `Procedure v${published.version}` : 'No published procedure'}</strong><small>{published ? 'Human confirmed' : 'Waiting for teaching'}</small></span></div><span className="journey-line"/><div className="journey-item"><span className={`journey-icon ${state.requests.some(r => r.state === 'COMPLETED') ? 'done' : ''}`}><Icon name="verify" size={16}/></span><span><strong>{state.requests.filter(r => r.state === 'COMPLETED').length} verified workspaces</strong><small>Independent read-back</small></span></div></div>
          <DemoGuide/>
          {section === 'learn' && <>
            <section className="section-block"><div className="section-title"><div><h2>Every procedure starts with evidence <span className="count">{state.cases.length}</span></h2><p>Historical outcomes reveal patterns. They don’t establish policy.</p></div><Badge tone="purple">Observed</Badge></div><div className="case-grid">{state.cases.map((item, index) => <HistoryCard key={item.id} item={item} index={index} open={openEvidence}/>)}</div></section>
            {published ? <section className="panel published-panel"><div className="panel-header"><div className="heading-with-icon"><span className="green-icon"><Icon name="check"/></span><div><h2>Trial workspace provisioning</h2><p>Confirmed by {state.people.find(p => p.id === published.publishedBy)?.name || published.publishedBy} · version {published.version} · {published.publishedAt && date(published.publishedAt)}</p></div></div><Status state="PUBLISHED"/></div><p className="body-copy">{published.summary}</p><RuleCards procedure={published} open={openEvidence}/><div className="panel-footer"><Evidence refs={published.rules.flatMap(rule => rule.confirmationRefs)} open={openEvidence} text="Human confirmation"/><div className="button-row"><button className="button secondary" disabled={!owner || !!busy} onClick={() => setRevisionReview(!revisionReview)}>{revisionReview ? 'Cancel changes' : 'Review a new version'}</button><button className="button primary" onClick={() => setSection('do')}>Use this procedure<Icon name="arrow" size={16}/></button></div></div>{revisionReview && <ReviewForm key={published.id} procedure={published} state={state} owner={owner} busy={busy === 'publish'} onPublish={review => void publish(review, published)}/>}</section> : !learning ? <section className="learn-prompt"><div className="learn-spark"><Icon name="graph" size={30}/></div><div><h2>What can Athena learn from these cases?</h2><p>Find recurring actions, compare the exceptions, and bring the uncertain parts to a person.</p>{state.modelConfigured === false && <p className="warning-text">A live model must be configured before learning can start.</p>}{!owner && <p className="warning-text">Choose Mira in Demo persona at the top to start learning.</p>}</div><button className="button primary" onClick={() => void startLearning()} disabled={!!busy || !owner || state.modelConfigured === false || !connected}>{busy === 'learn' ? 'Starting…' : 'Learn from these cases'}<Icon name="arrow" size={16}/></button></section> : <section className="panel"><div className="panel-header"><div><span className="eyebrow">LEARNING EPISODE</span><h2>{learning.run.state === 'RUNNING' ? 'Reading the company’s experience…' : learning.run.state === 'FAILED' ? 'Learning needs attention' : 'A pattern found. A question remains.'}</h2></div><Status state={learning.run.state}/></div>{learning.episode && <EpisodeInfo episode={learning.episode}/>}<p className="muted mono tiny">{learning.run.id}</p>{learning.run.error && <div className="notice error">{learning.run.error}</div>}{learning.run.state === 'FAILED' && <button className="button secondary" onClick={() => void startLearning()} disabled={!!busy || !owner}>Start a fresh learning episode</button>}{learning.run.state === 'RUNNING' && <div className="learning-progress"><span className="spinner"/><p>Athena is retrieving evidence and proposing a procedure. Human review is required before it becomes policy.</p></div>}{candidate && <><p className="body-copy">{candidate.summary}</p><div className="observation-list">{candidate.observedPatterns.map((pattern, i) => <div className="observation" key={i}><span className="observation-number">0{i + 1}</span><div><p>{pattern.text}</p><Evidence refs={pattern.evidenceRefs} open={openEvidence}/></div></div>)}</div><div className="teaching-question"><div className="question-label"><Icon name="learn" size={18}/>A PERSON NEEDS TO CONFIRM</div>{candidate.uncertainties.map((uncertainty, i) => <div key={i}><h3>{uncertainty.question}</h3><Evidence refs={uncertainty.evidenceRefs} open={openEvidence}/></div>)}</div><RuleCards procedure={candidate} open={openEvidence}/><ReviewForm key={candidate.id} procedure={candidate} state={state} owner={owner} busy={busy === 'publish'} onPublish={review => void publish(review, candidate)}/></>}{learning.events.length > 0 && <EventList events={learning.events}/>}</section>}
          </>}
          {section === 'do' && <div className="work-grid"><div><RequestForm state={state} busy={busy === 'request'} onSubmit={submitRequest}/><RequestList state={state} selected={requestId} select={selectRequest}/></div><div>{request ? <RequestPanel detail={request} state={state} actorId={actorId} busy={busy} open={openEvidence} approve={approve} resume={resume} verify={() => setSection('verify')}/> : <section className="panel"><Empty icon="do" title="Ready for the next case">Submit a customer request. Athena will retrieve the reviewed procedure in a fresh episode and resolve who can approve it.</Empty></section>}</div></div>}
          {section === 'verify' && <><div className="section-title"><div><h2>Workspace verification</h2><p>Persisted by the Workspace Lab. Checked by deterministic verifier code.</p></div><select className="request-picker" aria-label="Request to verify" value={requestId || ''} onChange={e => selectRequest(e.target.value)}><option value="" disabled>Select a request</option>{state.requests.map(item => <option key={item.id} value={item.id}>{item.customerName} · {label(item.state)}</option>)}</select></div>{request ? <VerificationPanel detail={request} open={openEvidence}/> : <section className="panel"><Empty icon="verify" title="An outcome you can inspect">Completed work appears here with its resource, receipts, and independent checks. Submit a request in Do to begin.</Empty><div className="center-button"><button className="button secondary" onClick={() => setSection('do')}>Create a request<Icon name="arrow" size={16}/></button></div></section>}</>}
          <footer className="page-footer"><span><span className="small-brand">a.</span> Company knowledge, with a chain of evidence.</span><span>Synthetic company · Workspace Lab</span></footer>
        </>}
      </main>
    </div>
    {evidence && <Modal title="Source evidence" close={() => setEvidence(null)} wide>{sourceError ? <div className="notice error">{sourceError}</div> : !source ? <div className="loading-page"><span className="spinner"/>Loading source…</div> : <div className="source-content"><div className="source-meta"><Badge tone="purple">{source.kind}</Badge><Badge>Revision {source.revision}</Badge><span>{date(source.occurredAt)}</span></div><h3>{source.title}</h3>{evidence.quote && <blockquote>{evidence.quote}</blockquote>}{evidence.observationId && <p className="muted">Audit observation: <code>{evidence.observationId}</code></p>}<h4>Complete source</h4><pre className="source-text">{source.text}</pre><dl className="source-provenance"><dt>Immutable source</dt><dd>{source.id}</dd><dt>Content hash · SHA-256</dt><dd className="mono hash">{source.contentHash}</dd><dt>Dataset</dt><dd>Synthetic company evidence</dd></dl></div>}</Modal>}
    {controls && state && <Modal title="Demo controls" close={() => setControls(false)}><DemoControls state={state} owner={owner} busy={!!busy} onAssign={(roleId, personId) => action('authority', async () => { await api('/authority/assign', { roleId, personId, expectedRevision: state.knowledgeRevision }); await refresh(); setNotice({ kind: 'success', message: 'Authority updated in FalkorDB. New plans will resolve the current role holder.' }); setControls(false); })} onReset={() => action('reset', async () => { await api('/demo/reset', {}); await refresh(); setLearningId(null); setLearning(null); setRequestId(null); setRequest(null); setSection('learn'); setRevisionReview(false); setControls(false); setNotice({ kind: 'success', message: 'Demo reset to historical evidence. No published procedure or current workspace remains.' }); })}/></Modal>}
  </div>;
}

function HistoryCard({ item, index, open }: { item: HistoryCase; index: number; open: (ref: EvidenceRef) => void }) {
  const duration = item.outcome.observedDurationDays ?? item.outcome.durationDays ?? item.outcome.trialDurationDays;
  const access = item.outcome.ownerAccessRole ?? item.outcome.accessRole ?? item.outcome.ownerRole;
  return <article className={`case-card case-${index % 3}`}><div className="case-top"><span className="customer-avatar">{item.customerName.slice(0, 1)}</span><Badge>Closed case</Badge></div><h3>{item.customerName}</h3><p className="case-date">{date(item.closedAt)}</p><div className="case-facts"><div><small>Observed duration</small><strong>{duration === undefined ? 'See evidence' : `${duration} days`}</strong></div><div><small>Observed access</small><strong>{typeof access === 'string' ? access : 'See evidence'}</strong></div></div><div className="case-bottom"><span>{item.observationIds.length} recorded actions</span><button className="text-button" aria-label={`Open ${item.customerName} source`} onClick={() => open({ ...item.sourceRefs[0], quote: null, observationId: null })}>Read source<Icon name="arrow" size={15}/></button></div></article>;
}
function RuleCards({ procedure, open }: { procedure: Procedure; open: (ref: EvidenceRef) => void }) {
  return <div className="rules-grid">{procedure.rules.map(rule => {
    const sourceCount = new Set(rule.evidenceRefs.map(ref => `${ref.sourceId}-${ref.revision}`)).size;
    const value = rule.kind === 'scalar'
      ? typeof rule.value === 'boolean' ? rule.value ? 'Yes' : 'No'
        : typeof rule.value === 'number' && /Days$/.test(rule.key) ? `${rule.value} days` : String(rule.value)
      : rule.outcome ? label(rule.outcome) : 'Conditional rule';
    return <div className="rule-card" key={rule.id}>
      <div className="rule-title"><span>{label(rule.key)}</span><Badge tone={rule.status === 'CONFIRMED' ? 'green' : 'purple'}>{label(rule.status)}</Badge></div>
      <strong>{value}</strong>
      {rule.requiredRoleId && <p className="rule-role">{label(rule.requiredRoleId.replace(/^role_/, ''))}</p>}
      {sourceCount > 0 && <details className="rule-sources"><summary>{sourceCount} evidence {sourceCount === 1 ? 'source' : 'sources'}</summary><Evidence refs={rule.evidenceRefs} open={open}/></details>}
    </div>;
  })}</div>;
}
function scalar(procedure: Procedure, kind: 'normal' | 'extended') {
  const key = kind === 'normal' ? 'normalDurationDays' : 'extendedDurationDays';
  const exact = procedure.rules.find(rule => rule.kind === 'scalar' && rule.key === key && typeof rule.value === 'number');
  return exact ? String(exact.value) : '';
}
function ReviewForm({ procedure, state, owner, busy, onPublish }: { procedure: Procedure; state: State; owner: boolean; busy: boolean; onPublish: (review: Review) => void }) {
  const [normal, setNormal] = useState(scalar(procedure, 'normal'));
  const [extended, setExtended] = useState(scalar(procedure, 'extended'));
  const [roleId, setRoleId] = useState(procedure.rules.find(rule => rule.requiredRoleId)?.requiredRoleId || '');
  const [inactive, setInactive] = useState(false);
  const [activate, setActivate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const isValid = Number(normal) > 0 && Number(extended) > Number(normal) && roleId && inactive && activate && confirmed;
  function submit(event: FormEvent) { event.preventDefault(); if (!isValid) return; onPublish({ normalDurationDays: Number(normal), extendedDurationDays: Number(extended), accessRole: 'member', extensionApprovalRoleId: roleId, configureWhileInactive: true, activateAfterConfiguration: true, confirmAllFields: true }); }
  return <form className="review-form" onSubmit={submit}><div className="section-title"><div><h3>Teach the reusable policy</h3><p>Review every field. Your confirmation becomes the authority for future requests.</p></div><Badge tone="amber">Owner review</Badge></div>{!owner && <div className="permission-note">Switch to {state.people.find(p => p.id === state.processes[0]?.ownerPersonId)?.name || 'the process owner'} to publish this procedure.</div>}<fieldset disabled={!owner || busy}><div className="form-grid"><label>Normal trial duration<div className="input-unit"><input aria-label="Normal trial duration" type="number" min="1" max="365" required value={normal} onChange={e => setNormal(e.target.value)}/><span>days</span></div></label><label>Extended trial duration<div className="input-unit"><input aria-label="Extended trial duration" type="number" min="1" max="365" required value={extended} onChange={e => setExtended(e.target.value)}/><span>days</span></div></label><label>Workspace access<select aria-label="Workspace access" value="member" onChange={() => undefined}><option value="member">Member</option></select></label><label>Extension approval role<select aria-label="Extension approval role" value={roleId} required onChange={e => setRoleId(e.target.value)}><option value="">Select a role</option>{state.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label></div><div className="review-checks"><label className="check-label"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)}/><span>Configure access and expiry while the workspace is inactive.</span></label><label className="check-label"><input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)}/><span>Activate only after both access and expiry are correctly configured.</span></label><label className="check-label final-confirmation"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>I confirm these settings as reusable policy. Each extension needs approval from the current role holder.</span></label></div><div className="review-submit"><p>Only the two confirmed durations are permitted.<br/>Other durations require clarification.</p><button className="button primary" type="submit" disabled={!isValid || busy}>{busy ? 'Publishing…' : 'Confirm & publish procedure'}<Icon name="check" size={17}/></button></div></fieldset></form>;
}
function RequestForm({ state, busy, onSubmit }: { state: State; busy: boolean; onSubmit: (input: TrialRequestInput) => Promise<void> }) {
  const [customer, setCustomer] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('');
  const key = useRef<string | null>(null);
  const actor = state.currentActorId;
  const isOperator = state.processes[0]?.operatorPersonIds.includes(actor || '') ?? false;
  const procedure = state.procedures.find(p => p.status === 'PUBLISHED');
  function change(setter: (value: string) => void, value: string) { setter(value); key.current = null; }
  async function submit(event: FormEvent) { event.preventDefault(); key.current ||= crypto.randomUUID(); await onSubmit({ processId: state.processes[0]?.id || 'process_trial', customerId: `customer_${customer.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'trial'}`, customerName: customer, ownerEmail: email, requestedDays: days ? Number(days) : null, idempotencyKey: key.current }); }
  return <section className="panel request-form"><div className="panel-header"><h2>New trial workspace</h2><Icon name="plus" size={19}/></div><p className="muted">Tell Athena the outcome you need.</p>{!procedure && <div className="permission-note">No reviewed procedure exists yet. A request will remain blocked until the company teaches one.</div>}{!isOperator && <div className="permission-note">Choose Ana in Demo persona at the top to request a workspace.</div>}<form onSubmit={event => void submit(event)}><fieldset disabled={busy || !isOperator}><label>Customer name<input required maxLength={160} placeholder="e.g. Atlas Robotics" value={customer} onChange={e => change(setCustomer, e.target.value)}/></label><label>Workspace owner<input type="email" required placeholder="name@customer.example" value={email} onChange={e => change(setEmail, e.target.value)}/></label><label>Requested duration <span className="optional">optional</span><div className="input-unit"><input type="number" min="1" max="365" placeholder="Use confirmed default" value={days} onChange={e => change(setDays, e.target.value)}/><span>days</span></div></label><p className="field-help">{procedure ? `Omit duration to use the normal trial from procedure v${procedure.version}. Exceptions route to current authority.` : 'Duration is resolved from confirmed graph knowledge, never a built-in default.'}</p><button className="button primary full" type="submit" disabled={busy || !isOperator}>{busy ? 'Starting a fresh episode…' : 'Create trial request'}<Icon name="arrow" size={16}/></button></fieldset></form><div className="form-footnote"><Icon name="graph" size={14}/>Every request starts with a fresh agent context.</div></section>;
}
function RequestList({ state, selected, select }: { state: State; selected: string | null; select: (id: string) => void }) { return <section className="request-list"><h3>Recent requests <span className="count">{state.requests.length}</span></h3>{state.requests.length === 0 ? <p className="muted">No requests yet.</p> : [...state.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(request => <button key={request.id} onClick={() => select(request.id)} className={`request-list-item ${selected === request.id ? 'selected' : ''}`}><span><strong>{request.customerName}</strong><small>{date(request.createdAt)}</small></span><Status state={request.state}/></button>)}</section>; }
function EpisodeInfo({ episode }: { episode: RequestDetail['episodes'][number] }) { return <div className="episode-info"><span><span className="status-dot"/>{label(episode.mission)} episode</span><span>{episode.initialContextMessages} prior messages</span><span>{episode.modelTurns} model turns</span><span>{(episode.activeMs / 1000).toFixed(1)}s active</span><details><summary>Episode details</summary><dl><dt>ID</dt><dd className="mono">{episode.id}</dd><dt>Model</dt><dd>{episode.model || 'Not recorded'}</dd><dt>Tokens</dt><dd>{episode.inputTokens} input / {episode.outputTokens} output</dd><dt>Status</dt><dd>{label(episode.status)}</dd></dl></details></div>; }
function RequestPanel({ detail, state, actorId, busy, open, approve, resume, verify }: { detail: RequestDetail; state: State; actorId: string | null; busy: string | null; open: (ref: EvidenceRef) => void; approve: (decision: 'APPROVED' | 'REJECTED') => Promise<void>; resume: () => Promise<void>; verify: () => void }) {
  const { request, plan } = detail;
  const approver = state.people.find(person => person.id === plan?.approverPersonId);
  const role = state.roles.find(role => role.id === plan?.requiredApprovalRoleId);
  const procedure = state.procedures.find(procedure => procedure.id === plan?.procedureId);
  return <section className="panel request-detail"><div className="panel-header"><div><span className="eyebrow">CURRENT REQUEST</span><h2>{request.customerName}</h2></div><Status state={request.state}/></div><p className="muted">{request.ownerEmail}</p>{request.reason && <div className={`notice ${['FAILED', 'BLOCKED', 'REJECTED'].includes(request.state) ? 'error' : 'info'}`}><Icon name={request.state === 'WAITING_APPROVAL' ? 'clock' : 'alert'} size={18}/><span>{request.reason}</span></div>}{detail.episodes.at(-1) && <EpisodeInfo episode={detail.episodes.at(-1)!}/>}<p className="mono tiny muted">{request.id}</p>{plan && <><div className="plan-summary"><div><small>Resolved duration</small><strong data-testid="planned-duration">{plan.parameters.durationDays}<span> days</span></strong></div><div><small>Workspace access</small><strong className="plan-access">{plan.parameters.accessRole}</strong></div><div><small>Procedure</small><strong>{procedure ? `v${procedure.version}` : 'Versioned'}<span> · rev {plan.knowledgeRevision}</span></strong></div></div><p className="body-copy">{plan.justification}</p><div className="relationship-path" aria-label="Graph decision path"><span>Request</span><Icon name="arrow" size={13}/><span>Reviewed rule</span>{role && <><Icon name="arrow" size={13}/><span>{role.name}</span><Icon name="arrow" size={13}/><strong>{approver?.name || 'Unresolved holder'}</strong></>}</div><Evidence refs={plan.evidenceRefs} open={open} text="Decision evidence"/><div className="plan-steps"><h3>Plan from the reviewed procedure</h3>{plan.steps.map((step, index) => { const receipt = detail.receipts.find(receipt => receipt.stepId === step.id); return <div className="plan-step" key={step.id}><span className={`step-number ${receipt ? 'done' : ''}`}>{receipt ? <Icon name="check" size={13}/> : index + 1}</span><span><strong>{label(step.tool)}</strong><small>{step.dependsOn.length ? `After ${step.dependsOn.length} prerequisite${step.dependsOn.length > 1 ? 's' : ''}` : 'No prerequisite'}</small></span>{receipt && <Badge tone="green">{label(receipt.result)}</Badge>}</div>; })}</div>{request.state === 'WAITING_APPROVAL' && <div className="approval-card"><div className="approval-heading"><span className="amber-icon"><Icon name="clock" size={20}/></span><div><h3>Waiting for {approver?.name || 'current authority'}</h3><p>{role?.name || 'Required approval role'}</p></div></div><p>Approval authorizes this exact plan. Current authority and knowledge are checked again before every workspace change.</p><div className="plan-hash"><span>PLAN SHA-256</span><code>{plan.planHash}</code></div>{actorId !== plan.approverPersonId && <p className="permission-note">Select {approver?.name || 'the current approver'} in the demo persona menu to review this request.</p>}<div className="button-row"><button className="button secondary" disabled={!!busy || actorId !== plan.approverPersonId} onClick={() => void approve('REJECTED')}>Reject</button><button className="button primary" disabled={!!busy || actorId !== plan.approverPersonId} onClick={() => void approve('APPROVED')}>{busy === 'approval' ? 'Checking authority…' : 'Approve this plan'}<Icon name="check" size={16}/></button></div></div>}</>}{detail.approvals.length > 0 && <div className="approval-records"><h3>Approval record</h3>{detail.approvals.map(approval => <div key={approval.id}><Status state={approval.decision}/><span>{state.people.find(person => person.id === approval.actorId)?.name || approval.actorId} · {date(approval.createdAt)} · assignment rev {approval.assignmentRevision}</span></div>)}</div>}{request.state === 'COMPLETED' && <div className="completion-card"><span className="green-icon"><Icon name="verify"/></span><div><h3>Workspace independently verified</h3><p>{detail.verification?.checks.filter(check => check.passed).length ?? 0} postconditions passed against the Workspace Lab.</p></div><button className="button primary" onClick={verify}>Inspect outcome<Icon name="arrow" size={16}/></button></div>}{['FAILED', 'BLOCKED', 'READY'].includes(request.state) && <div className="resume-action"><p>Resume reconciles persisted receipts and rechecks the current procedure and authority.</p><button className="button secondary" disabled={!!busy || !(request.requestedBy === actorId || state.processes.some(process => process.id === request.processId && process.ownerPersonId === actorId))} onClick={() => void resume()}><Icon name="refresh" size={16}/>{busy === 'resume' ? 'Reconciling…' : 'Reconcile & resume'}</button></div>}<EventList events={detail.events}/></section>;
}
function EventList({ events }: { events: RequestDetail['events'] }) { return <details className="event-log" open><summary>Activity & graph evidence <span className="count">{events.length}</span></summary>{events.length ? <ol tabIndex={0} aria-label="Activity events">{events.map(event => <li key={event.id}><span className="event-dot"/><div><div className="event-title"><strong>{label(event.type)}</strong><time>{date(event.at)}</time></div><p>{event.message}</p>{Object.keys(event.data).length > 0 && <details className="event-data"><summary>Recorded details</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>}</div></li>)}</ol> : <p className="muted">No events recorded yet.</p>}</details>; }
function VerificationPanel({ detail, open }: { detail: RequestDetail; open: (ref: EvidenceRef) => void }) {
  const { request, verification, receipts } = detail;
  const workspace = verification?.workspace;
  return <div className="verification-layout"><section className="panel"><div className="panel-header"><div><span className="eyebrow">{verification ? 'INDEPENDENT READ-BACK' : 'AWAITING READ-BACK'}</span><h2>{request.customerName}</h2></div><Status state={request.state}/></div>{!verification ? <Empty icon="verify" title="No verification result yet">{request.state === 'WAITING_APPROVAL' ? 'The request is waiting for authorized approval. The workspace has not been verified.' : request.reason || 'Verification runs after eligible workspace actions finish.'}</Empty> : <><div className={`verification-banner ${verification.passed ? 'passed' : 'failed'}`}><Icon name={verification.passed ? 'verify' : 'alert'} size={30}/><div><h3>{verification.passed ? 'The result matches the approved plan.' : 'The result did not pass verification.'}</h3><p>{verification.checks.filter(check => check.passed).length} of {verification.checks.length} checks passed · {date(verification.checkedAt)}</p></div></div><div className="verification-checks">{verification.checks.map((check, index) => <div key={`${check.name}-${index}`} className="verification-check"><span className={check.passed ? 'check-pass' : 'check-fail'}><Icon name={check.passed ? 'check' : 'close'} size={15}/></span><div><strong>{label(check.name)}</strong><p>Expected: <code>{formatValue(check.expected)}</code></p><p>Observed: <code>{formatValue(check.actual)}</code></p></div><Badge tone={check.passed ? 'green' : 'red'}>{check.passed ? 'Passed' : 'Failed'}</Badge></div>)}</div></>}<EventList events={detail.events}/></section><aside><section className="panel resource-panel"><div className="panel-header"><h2>Workspace Lab</h2><Badge>Local app</Badge></div>{workspace ? <><div className="resource-avatar"><Icon name="do" size={27}/></div><h3>{request.customerName}</h3><Badge tone={workspace.active ? 'green' : 'amber'}>{workspace.active ? 'Active' : 'Inactive'}</Badge><dl className="resource-data"><dt>Resource ID</dt><dd className="mono">{workspace.id}</dd><dt>Resources for this request</dt><dd>{verification?.resourceCount}</dd><dt>Created at</dt><dd>{date(workspace.createdAt)}</dd><dt>Expires at</dt><dd>{workspace.expiresAt ? date(workspace.expiresAt) : 'Not set'}</dd><dt>Access grants</dt><dd>{workspace.grants.map(grant => <div key={grant.email}>{grant.email}<Badge tone={grant.role === 'member' ? 'green' : 'red'}>{grant.role}</Badge></div>)}</dd></dl><p className="field-help">This snapshot comes from the separate persisted application at verification time.</p></> : <p className="muted">No independently read resource is available yet. No successful creation is implied.</p>}</section><section className="panel receipts-panel"><h2>Tool receipts <span className="count">{receipts.length}</span></h2>{receipts.length ? receipts.map(receipt => <div className="receipt" key={receipt.operationKey}><div><Icon name="source" size={16}/><strong>{label(detail.plan?.steps.find(step => step.id === receipt.stepId)?.tool || receipt.stepId)}</strong></div><Badge tone="green">{label(receipt.result)}</Badge><code>{receipt.operationKey}</code><small>{date(receipt.observedAt)}</small></div>) : <p className="muted">No mutation receipts recorded.</p>}{detail.plan && <Evidence refs={detail.plan.evidenceRefs} open={open} text="Plan evidence"/>}</section></aside></div>;
}
function formatValue(value: unknown) { return typeof value === 'string' ? value : JSON.stringify(value); }
function DemoControls({ state, owner, busy, onAssign, onReset }: { state: State; owner: boolean; busy: boolean; onAssign: (roleId: string, personId: string) => Promise<void>; onReset: () => Promise<void> }) {
  const [role, setRole] = useState(state.roles[0]?.id || '');
  const assignment = state.assignments.find(a => a.roleId === role && !a.validTo);
  const [person, setPerson] = useState(assignment?.personId || '');
  const [confirmReset, setConfirmReset] = useState(false);
  return <div className="demo-controls"><p>These controls belong to the demo operator. Agents cannot change authority or reset company history.</p>{!owner && <div className="permission-note">Select the process owner to make changes.</div>}<fieldset disabled={!owner || busy}><h3>Current approval authority</h3><p className="muted">Change the graph assignment. A fresh request will resolve the new holder.</p><label>Role<select value={role} onChange={e => { setRole(e.target.value); setPerson(state.assignments.find(a => a.roleId === e.target.value && !a.validTo)?.personId || ''); }}>{state.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label>Current role holder<select aria-label="Current role holder" value={person} onChange={e => setPerson(e.target.value)}>{state.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><p className="field-help">Assignment revision {assignment?.revision ?? 'unresolved'} · knowledge revision {state.knowledgeRevision}</p><button className="button primary" disabled={person === assignment?.personId || !person || busy} onClick={() => void onAssign(role, person)}>Update authority<Icon name="arrow" size={16}/></button><hr/><h3>Reset to a cold start</h3><p className="muted">Remove learned procedures, requests, and demo workspaces. Restore only the synthetic historical evidence.</p><label className="check-label"><input type="checkbox" checked={confirmReset} onChange={e => setConfirmReset(e.target.checked)}/><span>I want to reset the demo data.</span></label><button className="button danger" disabled={!confirmReset || busy} onClick={() => void onReset()}>Reset demo</button></fieldset></div>;
}
