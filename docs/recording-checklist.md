# Test Athena and record your demo

**[Open the live app](https://athena-0gfk.onrender.com)** · **[Get the shared demo code](../README.md#demo-access)** · **[Watch the existing video](https://fuadsn.github.io/athena/)**

You can test and record entirely in the browser. The hosted app already has its model configured; you do not need to start a server or enter an API key.

## Fastest option: upload the existing recording

The finished **3:11 MP4** is at **[`docs/demo/athena-demo.mp4`](demo/athena-demo.mp4)** in this repository, or [download it directly](https://fuadsn.github.io/athena/demo/athena-demo.mp4). It shows the actual working app, live model waits, the graph query, changing approval authority, and verified workspaces. It has captions and no audio. It uses an earlier interface layout; the demonstrated workflow is the same.

Watch it first. You can upload this file or make your own narrated recording using the steps below. **The submission form requires a public or unlisted YouTube video URL. The GitHub Pages player and MP4 are available, but the YouTube upload is still pending.**

## 1. Practice the complete flow once

Open the live app, enter the [README code](../README.md#demo-access), and select **Mira** in **Demo persona**. If the free host is waking up, allow about a minute.

For a clean practice run, open **Demo controls**, check **I want to reset the demo data.**, and click **Reset demo**. This clears the shared demo's learned procedures, requests, and workspaces and restores the three historical cases. Only reset when you intend to start over. You should see no published procedure and no verified workspaces.

Follow this sequence, checking each result before continuing:

| Step | What to do | What proves it worked |
|---|---|---|
| Read the evidence | As **Mira**, open **Learn**, then **Read source** on Northstar. Close the source dialog. | The actual source text is visible. There are three historical cases, but no executable policy yet. |
| Teach the policy | Click **Learn from these cases** and wait. Review the question. Enter **7** normal days, **30** extended days, **Member** access, and **Trial Extension Approver**. Check all three confirmations and click **Confirm & publish procedure**. | A published procedure appears with its human confirmation source. |
| Request an extension | Switch to **Ana**, open **Do**, enter `Atlas Robotics`, `owner@atlas.example`, and **30** days. Click **Create trial request**. | The request waits for **Ravi**. No workspace has been created yet. |
| Approve and verify | Switch to **Ravi**, click **Approve this plan**, wait, then click **Inspect outcome**. | **Verify** shows the actual workspace, active state, member access, expiry, one resource, and successful checks. |
| Change authority | Switch to **Mira**, open **Demo controls**, select **Trial Extension Approver**, choose **Leena** as **Current role holder**, and click **Update authority**. | The role assignment changes in the graph. |
| Prove the next agent uses it | Switch to **Ana** and submit **30** days for `Orion Instruments`, `owner@orion.example`. | The new request waits for **Leena**. Switching to Ravi does not enable approval. |
| Show the graph doing the work | In the new request's **Activity & graph evidence**, find `Q3_current_role_holder` and open **Recorded details**. Then switch to **Leena**, approve, and inspect the outcome. | The actual Cypher follows `HOLDS_ROLE` to the current approver; the second workspace is independently verified. |

Use new customer names and emails when repeating requests without a reset. If you skip resetting, follow the already published policy and the approver currently named on the card; the initial values may have changed.

Optional extra test: as Ana, request another customer with duration blank. With the policy above, it should use **7 days** and complete without extension approval. This shows that the default comes from confirmed policy.

If a button is disabled, check **Demo persona**: Mira teaches and changes authority; Ana requests; the currently named approver approves. If a model call reports an error or quota limit, show the error and retry only when the cause is resolved. Do not present an unsuccessful run as a completed one. The existing recording remains available if the shared host is unavailable.

## 2. What to show and say in your video

Aim for a clear **3–5 minute** walkthrough; actual model waits can make it longer. Keep the working interface readable. You can follow the same sequence as the practice run, after resetting once more if you want to capture learning from a cold start.

| Show on screen | Suggested narration |
|---|---|
| Learn tab and the three historical cases | “Athena is a company brain for agents. Past tickets show what happened, but they do not tell the next agent what is allowed. Here, some customers got seven-day trials and one got thirty days.” |
| Original source, model question, Mira's teaching form | “Athena reads evidence from FalkorDB and asks the process owner to resolve uncertainty. Mira confirms seven days normally, with approval required for thirty days. That reviewed policy is saved in the graph.” |
| Ana's new request, fresh episode, and waiting-for-Ravi card | “This is a new agent episode. It retrieves the policy and current approver from FalkorDB. It cannot create the extended trial before approval.” |
| Ravi approves; Verify shows the actual result | “Athena creates a workspace in our separate demo application, then reads it back to check access, expiry, active state, and uniqueness. A model saying ‘done’ is not enough.” |
| Mira assigns Leena; new request waits for Leena; recorded Q3 query | “Now the company changes. I update one role assignment in the graph. The next request finds Leena without changing the prompt or application code. This is the actual relationship query used.” |
| Leena's verified result, then the README graph map | “FalkorDB connects the evidence, reviewed procedure, current authority, and execution record. Each agent starts fresh and uses that shared company knowledge.” |

The **authority change and actual graph query** are the most important proof for this demo. Briefly show the [README graph map](../README.md#why-falkordb-matters) at the end. The full narrated technical script is in [demo-script.md](demo-script.md).

Describe the resources accurately: Workspace Lab is an independent synthetic application. These are working demo resources, not newly provisioned accounts in a third-party SaaS product. Graph knowledge survives between agent episodes; the free hosted instance can reset when it sleeps or restarts.

## 3. Record on your Mac

1. Open the app in your browser, enter the code, and prepare the starting screen. Hide unrelated windows and notifications.
2. Press **Shift–Command–5** and choose **Record Selected Portion**. Frame the browser so text and buttons remain readable.
3. Under **Options**, select your microphone for narration and enable **Show Mouse Clicks**.
4. Click **Record**, then follow the sequence above. Keep real model waits and outcomes visible.
5. Stop using the menu-bar stop button or **Command–Control–Esc**. Recordings save to the Desktop by default unless you chose another location.
6. Play the saved video once. Confirm that your voice is audible, the text is readable, and the authority change and verified result are visible.

[Apple's screen-recording instructions](https://support.apple.com/en-ie/102618).

## 4. Upload and submit

1. Open [YouTube Studio](https://studio.youtube.com), choose **Create → Upload videos**, and select your recording or the existing MP4.
2. Suggested title: **Athena — Company Brain with FalkorDB | Graph Hacks**. Complete the required upload fields and choose **Unlisted** or **Public**, as required by the submission form.
3. Save the video, allow processing to finish, and check that its link plays in a signed-out/private browser window. [YouTube's upload instructions](https://support.google.com/youtube/answer/57407?co=GENIE.Platform%3DDesktop&hl=en).
4. Paste that **YouTube URL** into the form's **Demo video** field. Use the repository and live app links below in their respective fields.
5. Submit through the participant's account at the [official submission page](https://www.wemakedevs.org/hackathons/falkordb/submit). Prepared project text is in [submission.md](submission.md).

Copy these into your video description so judges can find the app and its code:

```text
Athena turns company experience into reviewed procedures that fresh agents can use.
Track 3: Company Brain — WeMakeDevs × FalkorDB Graph Hacks.

Live app: https://athena-0gfk.onrender.com
Demo access code and walkthrough: https://github.com/fuadsn/athena#demo-access
Source and graph model: https://github.com/fuadsn/athena
```

The organizer's stated deadline is **18 October 2026, 11:59 PM IST**. Uploading a video does not submit the project; complete the form too.
