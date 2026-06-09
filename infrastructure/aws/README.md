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

```bash
cd /srv/smartfleet

# Pull latest images and restart
docker compose -f docker-compose.aws.yml pull
docker compose -f docker-compose.aws.yml up -d

# View logs (also in CloudWatch /smartfleet/{prod,staging})
docker compose -f docker-compose.aws.yml logs -f api-prod
docker compose -f docker-compose.aws.yml logs -f api-staging
docker compose -f docker-compose.aws.yml logs -f caddy

# Health checks
curl -fsSL http://localhost:3001/api/v1/health/live   # prod
curl -fsSL http://localhost:3002/api/v1/health/live   # staging

# Restart one container without disturbing the others
docker compose -f docker-compose.aws.yml restart api-staging

# Stop everything
docker compose -f docker-compose.aws.yml down
```

## Security model

- `Caddy` is the only container exposed to the internet (ports 80, 443).
- `api-prod` and `api-staging` listen on internal Docker network only.
- Caddy auto-renews TLS certs from Let's Encrypt; no manual cert work.
- `awslogs` driver ships every container's stdout to CloudWatch Logs.

## When to use which env file

- Mobile app + admin web hit `api.smart-fleet.com` → routed to **api-prod**
- Test mobile build + staging admin hit `staging.smart-fleet.com` → routed to **api-staging**
- Caddy decides routing by `Host` header — no port confusion needed.
