# Smart_Fleet — AWS pilot infrastructure

This directory contains everything needed to run Smart_Fleet on AWS Free Tier
in `ap-southeast-1` (Singapore) on a single EC2 host with both prod and staging
containers.

See `/root/.claude/plans/hello-swirling-finch.md` for the full deployment plan
(Phases A–L). This README is a quick-reference for the files in this folder.

## Files

| File | Purpose | Lives on |
|------|---------|----------|
| `docker-compose.aws.yml` | 3-container stack: Caddy reverse proxy + api-prod + api-staging | EC2 `/srv/smartfleet/` |
| `Caddyfile` | Hostname-based routing (`api.*` → prod, `staging.*` → staging) + auto Let's Encrypt | EC2 `/srv/smartfleet/` |
| `.env.prod.example` | Template for production environment variables | Copy to EC2 `/srv/smartfleet/.env.prod` and fill in real values |
| `.env.staging.example` | Same for staging | Copy to EC2 `/srv/smartfleet/.env.staging` |
| `deploy.sh` | The deploy (build, compose-image and boot-guard checks, prod snapshot, migrate, restart, version check) | Run from `/srv/smartfleet/src` by the workflows |
| (on the host only) `deploy.env` | `RDS_INSTANCE_ID=<prod RDS instance>` (and `AWS_REGION`), for the pre-deploy snapshot | EC2 `/srv/smartfleet/deploy.env` |
| (on the host only) `images.env` | The image each service runs, written by `deploy.sh` | EC2 `/srv/smartfleet/images.env` |
| `bootstrap.sh` | First-boot user-data script for the EC2 instance | Paste into EC2 "User data" field at launch |

## How they fit together

```
EC2 instance (Amazon Linux 2023, t3.micro)
└── /srv/smartfleet/
    ├── docker-compose.aws.yml    (this file, scp'd from repo)
    ├── Caddyfile                  (this file, scp'd from repo)
    ├── .env.prod                  (created by you on host, NEVER in git)
    ├── .env.staging               (created by you on host, NEVER in git)
    └── bootstrap.log              (written by bootstrap.sh on first boot)
```

## Operator commands (run on the EC2 host as ec2-user)

Deploys go through `deploy.sh` (run by the GitHub workflows): it builds `smartfleet-api:<sha>` on
this host, checks that `docker-compose.aws.yml` here takes the service's image from `IMAGE_PROD` /
`IMAGE_STAGING` (copy the file from this folder; a hand-edited one that pins an image is refused before
anything changes) and the env file against the API's boot guards, snapshots the prod database, migrates,
then recreates one service on exactly that image and waits until `GET /api/v1/health` reports the
commit. It records the image each service runs in `/srv/smartfleet/images.env`; pass that file to
every compose command, so a restart never picks another build. Earlier `smartfleet-api:<sha>` images
stay on the host for a code rollback (`deploy.sh prod <full sha>` reuses one); don't prune the last few.

```bash
cd /srv/smartfleet

# Restart with the recorded images (never `docker compose pull`: the images are built here)
docker compose --env-file images.env -f docker-compose.aws.yml up -d

# View logs (also in CloudWatch /smartfleet/{prod,staging})
docker compose --env-file images.env -f docker-compose.aws.yml logs -f api-prod
docker compose --env-file images.env -f docker-compose.aws.yml logs -f api-staging
docker compose --env-file images.env -f docker-compose.aws.yml logs -f caddy

# Health checks
curl -fsSL http://localhost:3001/api/v1/health/live   # prod
curl -fsSL http://localhost:3002/api/v1/health/live   # staging

# Restart one container without disturbing the others
docker compose --env-file images.env -f docker-compose.aws.yml restart api-staging

# Stop everything
docker compose --env-file images.env -f docker-compose.aws.yml down
```

## Pilot setup and reset on the server (API_CONTRACT §10.3)

The image has only the compiled API (`dist`), so the `npm run pilot:*` scripts (ts-node, `scripts/`) and
the repository's `pilot/` folder aren't in it. Run the compiled CLIs instead, with the setup file on the
host. The run prints each new login's password once: keep that output in your terminal only (`docker
exec` output and a container with `--log-driver none` never reach CloudWatch; the service's own logs do).

```bash
cd /srv/smartfleet
mkdir -p pilot && cp ~/test.json pilot/          # the setup file (docs/pilot/pilot-setup.sample.json format)

# Either: a one-off container of the deployed image, with the folder mounted (labels land on the host).
source images.env                                # IMAGE_STAGING=smartfleet-api:<sha>
docker run --rm -it --log-driver none --env-file .env.staging -e NODE_ENV=staging \
  -v /srv/smartfleet/pilot:/pilot "$IMAGE_STAGING" \
  node dist/modules/pilot-setup/cli/pilot-setup.js --file /pilot/test.json --test --dry-run
# … then the same without --dry-run, and with --labels /pilot/labels-staging.csv

# Or: inside the running container (copy the file in, and the labels out).
docker cp pilot/test.json smartfleet-api-staging:/tmp/test.json
docker exec -it smartfleet-api-staging node dist/modules/pilot-setup/cli/pilot-setup.js \
  --file /tmp/test.json --test --labels /tmp/labels-staging.csv
docker cp smartfleet-api-staging:/tmp/labels-staging.csv pilot/

# The reset (test rows only; --dry-run first)
docker exec -it smartfleet-api-staging node dist/modules/pilot-setup/cli/pilot-reset.js --dry-run
```

Without `--labels` the CSV goes to the container's working directory (`/app`), which a `--rm` container
throws away: always pass `--labels` under `/pilot` (or copy it out). Exit codes: 0 done, 1 refused or failed
(nothing written), 2 bad arguments, 3 done but the labels file could not be saved (the labels are printed,
and `GET /cylinders` lists the QR values).

## Security model

- `Caddy` is the only container exposed to the internet (ports 80, 443).
- `api-prod` and `api-staging` listen on internal Docker network only.
- Caddy auto-renews TLS certs from Let's Encrypt; no manual cert work.
- `awslogs` driver ships every container's stdout to CloudWatch Logs.

## When to use which env file

- Mobile app + admin web hit `api.smartfleetpk.com` → routed to **api-prod**
- Test mobile build + staging admin hit `staging.smartfleetpk.com` → routed to **api-staging**
- Caddy decides routing by `Host` header — no port confusion needed.
