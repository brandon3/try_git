# Argus ◉

Personal AI chief of staff — it watches your inbox and calendar so you don't have to.
See [`../GAMEPLAN.md`](../GAMEPLAN.md) for the full plan.

## Run it

```sh
npm install
npm run build && npm start   # or: npm run dev
```

With no configuration, Argus runs in **sandbox mode**: fixture emails/events
stand in for Gmail/Calendar, and triage uses a deterministic mock engine.
Everything else — the schema, the approval flow, the executor, the audit
log — is the real code.

## Turn on Claude triage

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Triage switches from the mock to `claude-opus-4-8` (structured outputs,
adaptive thinking, cached system prompt) automatically.

## Connect real Gmail + Calendar (home server)

1. Google Cloud console → new project → enable **Gmail API** and **Calendar API**
2. OAuth consent screen → *Testing* mode → add yourself as a test user
3. Credentials → OAuth client (*Web application*) → redirect URI:
   `http://<home-server>:3000/api/auth/callback`
4. ```sh
   export GOOGLE_CLIENT_ID=...
   export GOOGLE_CLIENT_SECRET=...
   export GOOGLE_REDIRECT_URI=http://<home-server>:3000/api/auth/callback
   ```
5. Visit `/api/auth/google` once from a browser on your network and grant access.

From then on `syncAll()` pulls real mail (last 3 days of inbox) and events
(next 7 days), and approved actions hit the real APIs: archive, label,
draft replies (never sends), accept/decline invitations.

## Layout

```
src/db/          schema + SQLite bootstrap
src/connectors/  fixtures (sandbox) · google/gmail/gcal (real)
src/engine/      triage (Claude/mock) · executor (trust ladder lives here)
src/app/         dashboard UI + API routes
```

## Safety model

- The model proposes actions from a fixed enum only; `send`/`delete` aren't in it.
- Approval is enforced in the executor, not the prompt.
- Drafts are drafts — sending is always a human act.
- Every side effect is recorded in the `actions` table.
