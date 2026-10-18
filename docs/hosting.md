# Free hosted demonstration

The hosted profile targets a **Render Free web service**, with the frontend, runtime, separate Workspace Lab process, and real embedded FalkorDB in one container. Only the web port is public. This is a shared hackathon demonstration, not durable company hosting.

The profile explicitly selects Gemini and removes OpenAI credentials from child processes. Configure a Gemini API key from a project without paid billing to use Google's free tier. Model availability and quotas depend on the account; exhausted quota fails visibly and never falls back to a paid provider. The original published recording and live evidence used OpenAI; adding this adapter does not establish a successful Gemini rehearsal.

## Deploy

1. Create a free [Render account](https://dashboard.render.com).
2. Open [Deploy Athena to Render](https://render.com/deploy?repo=https://github.com/fuadsn/athena). The checked-in `render.yaml` explicitly sets `plan: free`; do not select an upgrade.
3. Supply `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/api-keys) and a random `DEMO_ACCESS_CODE` of at least 16 characters. Keep both out of Git. Render generates the session-signing secret. The access code is shared privately with judges in the submission.
4. Deploy. Render's `RENDER_EXTERNAL_URL` selects the one accepted HTTPS origin. The public link is the URL Render returns; no deployment is claimed until that URL has been checked.
5. Open the URL, enter the access code, and run the complete Learn → Confirm → Do → Verify flow. Inspect an actual graph query and repeat the authority-change demonstration.

For automated deployment, the owner may supply `RENDER_API_KEY` through the ignored local `.env`. That key is only for deployment administration and must never be sent to the hosted application.

## Limits and access

- Render's Free web service has 512 MB RAM and 0.1 CPU. The hosted CI job builds this image and exercises entry through HTTPS under those limits, without a model key. Check the actual job result before calling the hosted package verified.
- Free services sleep after 15 minutes idle. Restarting, redeploying, or sleeping discards local graph and Lab files. The next start seeds historical evidence only; it does not fabricate a published procedure or successful request.
- A valid access code creates a signed, secure session. Within that demonstration, the user can select the four synthetic personas and exercise their distinct permissions. This is demonstration access, not enterprise identity management.
- A shared allowance permits at most 120 model turns per hour and one model call at a time. Failed provider calls consume the allowance. Provider free-tier limits may be lower. Resetting graph data does not reset the process's allowance.
- Never reuse the local service credentials pasted into chat for hosting. Internal Lab credentials are freshly generated at startup; the hosted session secret and entry code are separate.
- Keep the public recording available as a fallback while the free service wakes or is out of quota.

Official references: [Render Free limitations](https://render.com/docs/free), [Render Blueprint configuration](https://render.com/docs/blueprint-spec), [Gemini free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing), and [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).

## Local commands

The original development and Compose commands continue to work. To use Gemini locally, set:

```dotenv
MODEL_PROVIDER=gemini
GEMINI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your_private_key
```

The hosted container is built with `docker build -f Dockerfile.hosted -t athena-hosted .`. It requires a configured HTTPS origin, an access code, and TLS termination by the host. `scripts/hosted.ts` binds the internal services to loopback and starts the web listener on `PORT` (default 10000). Local data is stored under `.local/hosted`; its lifetime depends on the hosting filesystem.
