# Athena demonstration

Primary track: Company Brain. Use synthetic HelioWorks data and the local Workspace Lab. This script is a recording plan, not a claim that a rehearsal has passed. Record actual outcomes and model latency; never replace waiting or failure with a simulated result.

Submission closes **18 October 2026 at 11:59 PM IST**. The organizer's final checklist is: public repository, working demo video, a graph map in the README, and visible evidence that graph relationships drive the result. The README contains the map and decision-to-traversal table; the recording must show actual execution and the authority change below. Complete the form at https://www.wemakedevs.org/hackathons/falkordb/submit only after the public repository and working-video links are available.

## Before recording

1. Follow the root README to start FalkorDB, the Workspace Lab, the runtime, and the web application.
2. Configure a tested live `OPENAI_MODEL` and `OPENAI_API_KEY` on the server. Open `http://127.0.0.1:3100`.
3. Select Mira in the **Local demo persona** control. Open **Demo controls**, acknowledge the local reset, and choose **Reset demo**. Confirm zero published procedures and zero verified workspaces.
4. Keep recording at a readable browser size, ideally 1440 × 1000. Close unrelated applications. Do not show keys or local environment files.
5. Use `npm run build` followed by `npm run preview -- --embedded` for recording, after stopping development mode. This serves the production interface without Next.js development controls.

## The demonstration

### 1. A company with experience, but no procedure

Show **Learn**. Three historical cases are visible; there is no published procedure. Open Northstar’s source and its immutable source revision. Then show the observed durations on Northstar, Cedar, and Lumen.

Say: “These are three synthetic cases, not an executable playbook. Two customers received seven days. One received thirty. Athena needs to learn what is reusable, and ask a person what the variation means.”

Choose **Learn from these cases**. The live model retrieves graph evidence and produces observations and uncertainty. Show the question and an exact source excerpt. If the model fails, show the failure, fix the cause, and restart the rehearsal; do not edit a fake successful candidate into the recording.

### 2. A person establishes the policy

As Mira, inspect the proposed fields and explicitly teach:

- Normal duration: 7 days.
- Extended duration: 30 days.
- Access: member.
- Extension approval role: Trial Extension Approver.
- Configure while inactive; activate only after expiry and access are correct.
- Confirm all fields as reusable policy.

Choose **Confirm & publish procedure**. Show the published version, updated knowledge revision, and human confirmation source.

Say: “Historical observations suggest the procedure. Mira authorizes the reusable policy. Each exception still needs its own approval.”

### 3. A fresh agent acts using current authority

Switch the demo persona to Ana. Choose **Use this procedure**. Submit an unseen customer, for example Atlas Robotics, `owner@atlas.example`, requesting 30 days.

Show the new episode with zero prior messages, resolved duration/access, real graph decision evidence, and the waiting card for Ravi. Open recorded graph details if useful; do not narrate invented internal reasoning.

Say: “This episode has no conversation memory from learning. It retrieves the procedure and the current role holder from FalkorDB. Approval is tied to this exact plan hash.”

Switch to Ravi, choose **Approve this plan**, and wait for real execution. Show the actual receipt events. Choose **Inspect outcome** and show active state, expiry, precise member access, resource count, and successful independent checks.

Say: “A separate local application persists the workspace. Deterministic code reads it back and checks access, expiry, and uniqueness. Only that verification can mark the request complete.”

### 4. Change the company, not the prompt

Switch to Mira. Open **Demo controls** and change the Trial Extension Approver from Ravi to Leena. Show the incremented graph revision.

Switch to Ana and submit a new 30-day request with a different customer. Show **Waiting for Leena** and the graph path. Switch to Ravi: the approval control is unavailable because he no longer holds the required role. Server enforcement is also tested by the release test; a UI-disabled button alone is not the security boundary.

Switch to Leena, approve the plan, and show the second independently verified workspace.

Say: “The approval role stayed the same. Its holder changed in the graph. A fresh agent resolved the new authority without a prompt or engine change.”

### Optional evidence, after the headline works

- As Mira, use **Review a new version** to change the normal duration to 9 days, confirm the structured policy again, then submit a request with the duration blank. Show 9 days resolved from the new graph version.
- For a real interrupted request, inspect the partial-state record and use **Reconcile & resume** as Mira or Ana. Show existing receipts and exactly one resource. Do not invent an interruption for a recording.
- Request 14 days and show clarification/blocking without silent substitution.

## Accurate closing claim

“Athena learned a reviewed procedure from three synthetic historical cases, resolved uncertainty through human teaching, and executed new requests using current graph-based authority. Company knowledge persists; each agent episode starts fresh.”

The demonstration proves one bounded local workflow. It does not provision a production cloud environment or establish enterprise identity security. The synthetic persona selector is explicitly a local demonstration control.

## Browser release test

`npm run test:e2e` runs the headline flow against the actual running services and live model. It resets local demo state, so do not run it against a rehearsal whose state must be preserved. The test covers owner teaching, a default request, approval gating, a changed authority assignment, stale pending approval rejection, and idempotent replay. The narrower after-approval/before-mutation race and interrupted-receipt recovery require the integration suite.

Install the browser with `npx playwright install chromium` if necessary, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing Chromium/Chrome executable. `PLAYWRIGHT_BASE_URL` defaults to `http://127.0.0.1:3100`. Traces, failed screenshots, and the HTML report are written under `.local/`.

The available in-app Browser skill was inspected during implementation. Its required Node REPL execution tool and tool-discovery endpoint were unavailable in this agent session; standalone Playwright is the documented fallback for automated release verification. No mock success data is used by the production UI or headline release test.

## Capture the working flow

After the live release checks pass, keep the production preview running and execute:

```sh
npm run demo:record
```

This runs the actual headline browser flow with video retained on success and failure, at 1440 × 1000, under a new `.local/demo-recordings/<timestamp>/` directory. Browser interactions are slowed slightly for readability; model waits and actual outcomes remain intact. It calls the real runtime, resets the synthetic demo, and requires a configured live model. A failed run is evidence for debugging, not a successful demo.

Review the resulting `video.webm` before publishing. Add your narration using the sequence above, and keep the working interface and graph-driven authority change visible. Do not replace failed behavior with a successful-looking edit. The capture command does not upload anything.

Recording mode pauses on the evidence, teaching form, verified resource, and authority change. It opens the actual `Q3_current_role_holder` Cypher record and saves `chapters.json` beside the video. With FFmpeg installed, create a captioned MP4 using:

```sh
npm run demo:render -- '.local/demo-recordings/<timestamp>/<test-directory>/video.webm'
```

The output is `.local/demo-final/athena-demo.mp4`. Captions appear in an added strip below the complete interface. Every original frame and live wait is preserved; there are no simulated states or speed changes. The renderer adds no audio and uploads nothing.
