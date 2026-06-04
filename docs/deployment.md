# Smart_Fleet — Production Deployment Guide

This document is the operator's checklist for taking the pilot live. The
detailed reasoning lives in the deployment plan; this is the action list.

## Estimated time & cost

- **Time:** ~6–7 hours end-to-end (excluding the 1–3 day Eocean SMS KYC wait).
- **Monthly cost:** ~$13/mo at pilot scale (1–5 distributors).

---

## Phase A — Cloud account sign-ups (you must do these)

The agent cannot create paid accounts on your behalf. Sign up here using
the same email everywhere:

| Service          | URL                          | Plan       | Action                                                     |
|------------------|------------------------------|------------|------------------------------------------------------------|
| GitHub           | github.com                   | Free       | Repo is already pushed; just confirm Actions are enabled.  |
| Railway          | railway.app                  | Hobby ($5) | Add payment method. We will create 1 project, 2 envs.      |
| Neon             | neon.tech                    | Free       | Create project `smart-fleet`, region Singapore.            |
| Upstash          | upstash.com                  | Free       | Create 2 Redis DBs: `smart-fleet-prod`, `smart-fleet-staging`. |
| Cloudflare       | cloudflare.com               | Free       | Add R2 (one-time card-on-file required by CF for R2).      |
| Expo             | expo.dev                     | Free       | Create org; we'll wire EAS later.                          |
| Sentry           | sentry.io                    | Free       | Create org; 3 projects (api-prod, api-staging, mobile).    |
| Better Stack     | betterstack.com              | Free       | Create team; 2 log sources, 2 uptime monitors.             |
| PostHog          | posthog.com                  | Free       | Create project; copy API key.                              |
| Eocean SMS       | eocean.com / sendpk.com      | Pay-as-you-go | Submit KYC (CNIC + business letter). Takes 1–3 days.    |

---

## Phase B — Provision infrastructure (~1 hour, after sign-ups)

### B1. Neon Postgres

1. Create project `smart-fleet`, region nearest to Pakistan (Singapore).
2. In the SQL editor on the `main` branch:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
3. Copy the **pooled** connection string. Save as `DATABASE_URL_PROD`.
4. **Branches → New branch → name "staging", parent = main.** Copy its
   pooled connection string. Save as `DATABASE_URL_STAGING`.

### B2. Upstash Redis (×2)

1. Create DB `smart-fleet-prod` (region: closest to Railway region).
2. Create DB `smart-fleet-staging`.
3. Copy each `rediss://` URL. Save as `REDIS_URL_PROD`, `REDIS_URL_STAGING`.

### B3. Cloudflare R2 (×3 buckets)

1. R2 → Create buckets `smart-fleet-prod`, `smart-fleet-staging`, `smart-fleet-archive`.
2. R2 → Manage API tokens → Create token "smart-fleet-api" with
   **Object Read & Write** on the three buckets.
3. Copy `Access Key ID` and `Secret Access Key`. Save as
   `R2_ACCESS_KEY`, `R2_SECRET_KEY`.
4. Note your account-id-based S3 endpoint:
   `https://<account_id>.r2.cloudflarestorage.com`

### B4. Sentry (3 projects)

1. Create projects: `api-prod` (Node.js), `api-staging` (Node.js),
   `mobile` (React Native).
2. Copy each DSN. Save as `SENTRY_DSN_PROD`, `SENTRY_DSN_STAGING`,
   `SENTRY_DSN_MOBILE`.
3. **Project settings → Data scrubbing → enable default + add custom
   patterns:** `\b\d{13}\b` (CNIC), `\+92\d{10}` (PK phone).

### B5. Better Stack

1. Logs → Create source "smart-fleet-prod" → copy ingest token.
2. Logs → Create source "smart-fleet-staging" → copy ingest token.
3. Uptime → Add monitor for `https://<prod>.up.railway.app/api/v1/health/live`.
4. Uptime → Add monitor for `https://<staging>.up.railway.app/api/v1/health/live`.

### B6. PostHog

1. Project Settings → copy Project API Key. Save as `POSTHOG_API_KEY`.
2. Feature Flags → New flag → key `feature.example`, off by default,
   linked to "Distributors" group. This is our verification flag.

### B7. Generate application secrets

On your laptop:
```bash
openssl rand -hex 32  # JWT_ACCESS_SECRET (prod)
openssl rand -hex 32  # JWT_REFRESH_SECRET (prod)
openssl rand -hex 32  # ENCRYPTION_KEY (prod)
openssl rand -hex 32  # BLIND_INDEX_KEY (prod)
# Repeat 4 times for staging.
```
Store all eight values in your password manager.

---

## Phase C — Railway API deploy (production + staging)

### C1. Create project

1. Railway → New Project → Deploy from GitHub repo.
2. Settings → Source → ensure Dockerfile path is `apps/api/Dockerfile`
   (the included `railway.toml` declares this).

### C2. Production environment

1. Rename default env to `production`.
2. Variables → paste all of:
   - `NODE_ENV=production`
   - `DATABASE_URL=<DATABASE_URL_PROD>`
   - `REDIS_URL=<REDIS_URL_PROD>`
   - `S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com`
   - `S3_REGION=auto`
   - `S3_ACCESS_KEY=<R2_ACCESS_KEY>`
   - `S3_SECRET_KEY=<R2_SECRET_KEY>`
   - `S3_BUCKET=smart-fleet-prod`
   - `JWT_ACCESS_SECRET=<from B7>`
   - `JWT_REFRESH_SECRET=<from B7>`
   - `ENCRYPTION_KEY=<from B7>`
   - `BLIND_INDEX_KEY=<from B7>`
   - `SMS_PROVIDER=eocean`
   - `SMS_FROM=SmartFleet`
   - `EOCEAN_USERNAME=<from Eocean>`
   - `EOCEAN_PASSWORD=<from Eocean>`
   - `EOCEAN_BASE_URL=https://sendpk.com/api/sms.php`
   - `SENTRY_DSN=<SENTRY_DSN_PROD>`
   - `BETTER_STACK_TOKEN=<from B5>`
   - `POSTHOG_API_KEY=<POSTHOG_API_KEY>`
3. Settings → Networking → Generate Domain. Copy as
   `https://smart-fleet-production.up.railway.app`.
4. Deploy. Watch logs for `Smart_Fleet API listening on :3000`.
5. Verify: `curl https://smart-fleet-production.up.railway.app/api/v1/health/live`

### C3. Staging environment

1. Project → New Environment → name `staging`.
2. Copy all production variables, **then change**:
   - `NODE_ENV=staging`
   - `DATABASE_URL=<DATABASE_URL_STAGING>`
   - `REDIS_URL=<REDIS_URL_STAGING>`
   - `S3_BUCKET=smart-fleet-staging`
   - `JWT_ACCESS_SECRET=<staging value>`
   - `JWT_REFRESH_SECRET=<staging value>`
   - `ENCRYPTION_KEY=<staging value>`
   - `BLIND_INDEX_KEY=<staging value>`
   - `SENTRY_DSN=<SENTRY_DSN_STAGING>`
   - `BETTER_STACK_TOKEN=<staging token>`
   - `SMS_PROVIDER=mock` (until Eocean sandbox is set up)
3. Settings → connect to `main` branch with auto-deploy ON.
4. Settings → Networking → Generate Domain. Copy as
   `https://smart-fleet-staging.up.railway.app`.

### C4. Production should only auto-deploy from staging promote

1. Production env → Settings → Deploy → set "Auto-deploy" **off**.
   Production now only deploys via Railway's "Promote" button or the
   `promote-prod.yml` workflow.

---

## Phase D — Admin web on Cloudflare Pages

1. Cloudflare → Pages → Connect to Git.
2. Build settings:
   - Root: `apps/admin-web`
   - Build cmd: `cd ../.. && npm ci && cd apps/admin-web && npm run build`
   - Output: `dist`
3. Production env vars:
   - `VITE_API_BASE_URL=https://smart-fleet-production.up.railway.app/api/v1`
4. Preview env vars (used for PR deploys):
   - `VITE_API_BASE_URL=https://smart-fleet-staging.up.railway.app/api/v1`
5. Deploy.

---

## Phase E — Mobile apps via EAS

```bash
npm install -g eas-cli
cd apps/mobile
eas login
eas init           # populates app.config.ts with projectId

# First builds (counts against free 30/month)
eas build --platform android --profile staging
eas build --platform android --profile production

# Configure OTA updates
eas update:configure
eas update --branch staging --message "v0.1.0 initial staging"
```

After installing the staging APK on a phone and confirming OTA updates
work, repeat with `--branch production`.

---

## Phase F — Verify against the deployment plan

Run the 14-step verification list from `~/.claude/plans/hello-swirling-finch.md`
(under "Verification — does the stack meet every stated requirement?").

If all 14 pass, you are production-ready for the pilot.

---

## GitHub Actions secrets to set

In repo Settings → Secrets and variables → Actions:

**Repository variables:**
- `STAGING_API_URL` = `https://smart-fleet-staging.up.railway.app`
- `PROD_API_URL` = `https://smart-fleet-production.up.railway.app`

**Repository secrets** (only if you turn on auto-promote):
- `RAILWAY_TOKEN` (from railway.app/account/tokens)
- `RAILWAY_PROD_DEPLOYMENT_ID`

**Environment "production":**
- Add required reviewers (yourself) so the Promote workflow waits for manual approval.

---

## Day-2 operations

See the "Day-2 workflow" table in the deployment plan.

The short version:
- New feature: branch → PR → CI → merge → staging → click Promote.
- Mobile JS change: `eas update --branch production`.
- Roll back API: Railway dashboard → previous deploy → Redeploy.
- Kill a feature: toggle the PostHog flag.
- Investigate a bug: Better Stack search by `request_id`.
