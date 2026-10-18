# Validation status

Updated **18 October 2026**. The final audited live batch passed **three consecutive reset-to-completion rehearsals** using **`gpt-5.4-2026-03-05`**, with nine independently verified requests and finalized episode counters. The public Render deployment has now also passed the full live browser flow. All three CI jobs passed at `f46d886`, including the full Compose build and the hosted container under free-tier resource limits.

The public repository is [fuadsn/athena](https://github.com/fuadsn/athena). The final paced browser flow passed with the same model, and its [working video](https://fuadsn.github.io/athena/) has been exported and visually reviewed. The project owner has confirmed personal review of the code and working demonstration. Official submission remains outstanding.

## Public deployment

[Athena is running on Render Free](https://athena-0gfk.onrender.com), with the application at `8a25638` and the browser rehearsal at `f46d886`. The complete live headline browser test passed in **103.2 seconds** through public HTTPS. It learned from cold graph evidence, submitted explicit owner confirmation through the UI, verified Atlas and approved Orion workspaces, blocked Vela's stale plan after authority changed, routed Peregrine to Leena, and verified that replay did not create a duplicate resource. Three workspaces passed independent verification. [Actual hosted episodes, receipts, verification results and authority-query traces](hosted-evidence.json).

Separate public-browser checks passed for rejected incorrect access codes, secure session cookies, rejected foreign origins, literal Northstar source access, no browser exceptions, and no horizontal overflow at 390 pixels. Desktop and mobile screenshots were visually inspected. The hosted model calls used 67,950 input and 4,043 output tokens with `gpt-5.4-2026-03-05` (approximately $0.23 at uncached standard rates).

[CI run 39149278769](https://github.com/fuadsn/athena/actions/runs/39149278769) passed **85 unit tests**, **68 integration tests**, production builds, the Compose browser check, and hosted HTTPS checks under **512 MB RAM / 0.1 CPU**. CI has no model key. Render's service plan was confirmed as `free`; model calls still use the owner's OpenAI credits. Free hosting sleeps and loses local data on restart, so the verified state is a recorded result rather than a guarantee that it remains present after a cold start. The access code is supplied privately with the submission.

## Completed checks

| Check | Actual outcome |
|---|---|
| Synthetic JSON consistency | Ten source hashes, thirty-one citations, chronology, observed durations, and T01–T16 specification coverage passed |
| Last reported local `npm test` | **78 passed**; four opt-in graph cases skipped in this command and covered by the integration command |
| Last reported local `npm run typecheck` | Passed |
| Production web build | Next.js production webpack build passed locally and in CI |
| Last reported local `npm run test:integration` | **67 passed**, including real embedded FalkorDB and persisted Workspace Lab checks |
| Local cold browser flow | Passed against development and production previews using installed Chrome |
| Desktop/mobile inspection | Fourteen actual-service checks passed; screenshots inspected, mobile evidence readability corrected |
| Local production preview | All four services started; persisted graph reopened; health endpoint reported available |
| Real OpenAI schema probe | Passed with `gpt-5.4-mini-2026-03-17`; subsequent full live results are recorded separately below |
| Final audited live batch | **3/3 consecutive passes** with `gpt-5.4-2026-03-05`; nine requests independently verified; every recorded episode ended with final counters |
| Final headline browser recording | Passed with `gpt-5.4-2026-03-05` through `npm run demo:record`; the complete 3:11 MP4 is public |
| CI: deterministic job at `40e27dd` | Passed on Node.js 24 with pinned FalkorDB 4.22.1: typechecking, production build, unit tests, and integration tests |
| CI: container smoke job at `40e27dd` | Passed: full Compose build/start, service readiness, and the actual cold browser flow |

Both CI jobs passed in [Verify Athena run 39125498278](https://github.com/fuadsn/athena/actions/runs/39125498278). Earlier CI runs at `4cabf62`, `ce273a2`, `21effa7`, `280d4a9`, and `041767b` also passed both jobs. The [workflow](../.github/workflows/verify.yml) uses the digest-pinned FalkorDB image from Compose. CI's model credentials are intentionally empty: live-model results come from the separate recorded rehearsals. This CI result belongs to `40e27dd`; subsequent implementation changes need their own checks.

Runtime integration coverage uses explicit test-only model responses and includes both real-graph and graph-double cases. Lab resources are persisted independently. Deterministic success and live-model success are reported separately.

## Final audited live results

Evidence directory: `.local/live-rehearsals/2026-10-18T11-42-06.365Z/`. Its saved `summary.json` records `consecutivePasses: 3` and `releaseGatePassed: true`. The repository includes a [machine-readable evidence export](live-evidence.json) with source-record hashes, episode data, model identity, and outcomes. It identifies runtime revision `7d32f4f` and CI revision `ce273a2`.

| Rehearsal | Outcome | Elapsed time | Input tokens | Output tokens | Independently verified requests |
|---|---|---:|---:|---:|---:|
| 1 | Passed | 67.383 seconds | 72,539 | 4,434 | 3 |
| 2 | Passed | 76.369 seconds | 78,327 | 6,153 | 3 |
| 3 | Passed | 70.017 seconds | 72,558 | 4,645 | 3 |

All three runs used `gpt-5.4-2026-03-05`. Each learning episode took three model turns and had zero rejected candidates. Every episode ended and included finalized usage counters. Each rehearsal covered a normal request, an approved extension, and a new extension after the authority change: **nine verified requests total**.

The harness submits explicit teaching input through the owner-review endpoint after live induction; it does not insert an executable procedure into the cold seed or provide evaluation answers to the learner. These results establish the bounded synthetic demonstration, not a general company-workflow benchmark.

## Preserved attempts and corrections

Every failed attempt remains under `.local/live-rehearsals/`, with a completed failed-batch summary recording `releaseGatePassed: false`. Directory timestamps below are UTC.

| Preserved batch | Actual outcome |
|---|---|
| `2026-10-17T17-15-46.396Z` | Failed because no live model was configured at the time |
| `2026-10-18T11-19-54.038Z` | Failed at the strict-tool schema boundary: unsupported `oneOf` |
| `2026-10-18T11-24-13.247Z` | Failed because the proposed procedure had invalid step dependencies |
| `2026-10-18T11-28-28.893Z` | Failed after repeated invalid binding proposals exhausted the episode budget |
| `2026-10-18T11-32-06.785Z` | First **3/3 consecutive passes**, using the mini model after `280d4a9`; retained as historical evidence |
| `2026-10-18T11-38-27.154Z` | Audit-capture rerun failed rehearsal 1: the eight-turn learning budget was exhausted after repeated omission of the required `create_workspace` request-ID argument |
| `2026-10-18T11-42-06.365Z` | Final audited batch: **3/3 consecutive passes** with `gpt-5.4-2026-03-05`, finalized episode records, and `releaseGatePassed: true` |

The fixes replace unsupported tool-schema unions with supported `anyOf`, return specific validation feedback, and make the allowed technical binding grammar explicit. Invalid proposals remain recorded, and repairs must fit the existing turn, tool-call, and time budgets. Feedback explains dependencies and tool parameters without supplying hidden company-policy answers.

An audit recorder could capture request completion before the final episode status and usage writes finished. The workspace verification itself remained valid. Harness fix `21effa7` waits for terminal episodes before saving metrics. The first follow-up failed during learning as recorded above. Revision `7d32f4f` then improved exact parameter feedback, and the locally selected model changed from `gpt-5.4-mini-2026-03-17` to `gpt-5.4-2026-03-05`. The final successful batch records that changed configuration explicitly; earlier failures were not discarded.

## Browser recording

An earlier live headline browser run passed in about 1.5 minutes and produced this actual local recording:

`.local/demo-recordings/2026-10-18T11-36-46.382Z/headline-cold-evidence-→-o-ca10b-ed-work-→-changed-authority-chromium/video.webm`

That WebM is 6,830,185 bytes and used the mini model. It remains historical evidence.

The final `npm run demo:record` passed with `gpt-5.4-2026-03-05`, using the capture and application source at `ce273a2`. It records cold learning, structured owner teaching, a normal request, an approved extension, invalidation of a pending plan, current authority changing to Leena, independent verification, and idempotent replay. It opens the actual Q3 `HOLDS_ROLE` query and pauses on the evidence.

The original recording is preserved under `.local/demo-recordings/2026-10-18T11-47-18.999Z/`. The [public MP4](demo/athena-demo.mp4) is 190.6 seconds, 1440 × 1100, and 5,951,358 bytes. Captions occupy an added strip below the complete interface; live waits and original video timing are preserved. No simulated state, substituted model output, or audio was added. Source, query, and final-verification frames were visually inspected. [Recording metadata and hashes](demo/recording.json) · [Caption timestamps](demo/chapters.json).

The [public viewing page](https://fuadsn.github.io/athena/) deployed successfully through GitHub Pages. An anonymous Chrome check verified video metadata, `video/mp4` delivery, playback advancing after the authority chapter button, no browser exceptions, and no horizontal overflow at a 390-pixel viewport. Desktop and mobile screenshots were inspected. The first probe used an incorrect accessible-name locator for the chapter button; correcting the probe to match the rendered name passed without changing the page. The page hosts the recording and project links only.

## Other verified behavior

Cold API and browser checks confirmed historical-only state, literal source retrieval, owner/operator separation, and blocked work with zero mutation receipts when no reviewed procedure exists. Deterministic runtime checks also cover current role replacement, stale revisions, graph dependence, interrupted operations, independent verification, and owner-authorized reset.

Browser checks found and fixed an origin mismatch between Next's normalized localhost URL and a browser using 127.0.0.1. The proxy now validates the actual local Host and exact Origin. Permanent coverage checks legitimate entry, rejected foreign origins, sources, persona permissions, absent-model messaging, mobile dialogs, and browser exceptions.

An earlier integration timer test advanced fake time before real-database setup finished. It now waits for the model call before advancing time. Subsequent complete suites passed; the initial failure was not counted as a pass.

## Environment and reproducibility

Node.js 24 LTS is the documented setup and container base and is verified in CI. Local checks also ran on the available Node.js v25.2.1. Local graph integration used embedded FalkorDB 4.18.3 with Redis 8.4.0; CI separately verified pinned FalkorDB 4.22.1 and the full Compose application.

Initial sandbox restrictions blocked sockets and Chrome; those checks subsequently ran after permissions were enabled. A later local Colima build encountered disk exhaustion and filesystem errors. Colima was stopped without deleting unrelated user files or volumes. That incident is no longer a container-release blocker because full Compose verification passed in CI. Repair the local VM storage and provide sufficient space before using Colima again.

The local production preview uses separate persisted graph and Lab stores with live model configuration loaded. Secrets do not belong in committed evidence. `npm run demo:reset` resets both stores through the serialized runtime and refuses while episodes are active.

## Remaining work before submission

The project owner has confirmed personal code and demo review. Review the [submission copy](submission.md), then submit through the participant's signed-in [official submission page](https://www.wemakedevs.org/hackathons/falkordb/submit) before the deadline.

The technical release checks, video, and participant review are complete. The official submission remains pending.
