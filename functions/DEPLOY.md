# Deploying the Whop webhook — no terminal required

The `whopWebhook` Cloud Function (Gen 2, project `tennis-edge-75cd9`,
region `us-central1`) is deployed by the GitHub Actions workflow
`.github/workflows/deploy-functions.yml`. You never run a terminal command.

## One-time setup (all in a web browser)

### 1. Create a service-account key (Firebase console)
1. https://console.firebase.google.com/project/tennis-edge-75cd9/settings/serviceaccounts/adminsdk
2. Click **Generate new private key** → a `.json` file downloads.
3. Open that file in TextEdit and copy its entire contents.

> The key needs deploy rights. If a run fails on permissions, open
> Google Cloud console → IAM, find this service account, and grant:
> **Cloud Functions Admin**, **Cloud Run Admin**, **Service Account User**,
> **Secret Manager Admin**, **Artifact Registry Administrator**.
> Also confirm the project is on the **Blaze** billing plan — Gen 2
> functions require it.

### 2. Add four repository secrets (GitHub, web UI)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | paste the full JSON from step 1 |
| `WHOP_WEBHOOK_SECRET` | `whsec_…` from Whop → Settings → Webhooks |
| `WHOP_PLAN_BASIC` | Whop plan_id / product_id for the Edge (€49) tier |
| `WHOP_PLAN_PRO` | Whop plan_id / product_id for the Pro (€99) tier |

## Deploy (one click)
Repo → **Actions** tab → **Deploy Whop Webhook** → **Run workflow** →
pick branch `ten8-whop-integration` → **Run workflow**.

The last log line prints the webhook URL:
`https://us-central1-tennis-edge-75cd9.cloudfunctions.net/whopWebhook`

Paste that URL into Whop → Settings → Webhooks so Whop starts sending events.

## To change a secret later
Update the repository secret in GitHub and re-run the workflow — it rewrites
the Secret Manager value and `functions/.env`, then redeploys.
