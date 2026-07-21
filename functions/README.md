# Tennis Edge — Whop webhook backend

This is the **only server-side component** of Tennis Edge. Everything else is a
static site on GitHub Pages with client-side Firebase. Whop needs somewhere to
POST webhooks, so this is one HTTPS Cloud Function on the **same** Firebase
project already in use (`tennis-edge-75cd9`).

It: verifies the Whop webhook signature → matches the member to a Firebase user
by email → sets `plan` on `users/{uid}` (the field the dashboard gating reads).

## What it costs

Cloud Functions requires the Firebase **Blaze (pay-as-you-go)** plan. Blaze has
a free monthly allowance (2M invocations, 400k GB-sec) that a membership webhook
will never come close to — realistic cost at this volume is **$0/month**. Blaze
just requires a billing card on file. This is the one thing that needs your
decision before deploy.

## One-time setup (needs Firebase CLI + your login — not available in the agent env)

```bash
npm i -g firebase-tools           # if not installed
firebase login                    # your Google account (project owner)
cd <repo> && firebase use tennis-edge-75cd9
cd functions && npm install && cd ..

# Config values:
firebase functions:secrets:set WHOP_WEBHOOK_SECRET   # paste the whsec_… from Whop
# Plan/product ids from the two Whop products (Step 1):
# put these in functions/.env  (NOT committed)
#   WHOP_PLAN_BASIC=plan_xxxxxxxx   (or the product/access-pass id)
#   WHOP_PLAN_PRO=plan_yyyyyyyy

firebase deploy --only functions
```

Deploy prints the function URL, e.g.
`https://us-central1-tennis-edge-75cd9.cloudfunctions.net/whopWebhook`

## Register it in Whop

Whop dashboard → Developer → Webhooks → add endpoint = the URL above. Select
events: `membership.went_valid`, `membership.went_invalid`, `membership.updated`,
`payment.failed` (this build also accepts the newer `activated`/`deactivated`
names). **Copy the signing secret** Whop shows you → that is the
`WHOP_WEBHOOK_SECRET` above. Nothing is processed without a valid signature.

## Test / go-live gates (still open — see TEN-8)

1. **Blaze billing** — your call to enable it.
2. **Webhook secret** — only exists after you create the webhook in Whop.
3. **Tier naming** — RESOLVED (2026-07-21): mid tier = **Edge, €49** (matches the
   live site). The function now writes `edge`/`pro`/`free`. No further change needed.

Until deployed, memberships bought on Whop will not sync automatically.
