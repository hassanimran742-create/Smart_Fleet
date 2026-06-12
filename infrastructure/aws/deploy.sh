#!/bin/bash
# Smart_Fleet — deploy script, runs ON the EC2 host.
# Invoked over SSH by .github/workflows/deploy-staging.yml and promote-prod.yml.
#
# Usage: deploy.sh <staging|prod> [git-ref]
#
# Prerequisites on the EC2 host (one-time, see Phase I):
#   - repo cloned at /srv/smartfleet/src with a credentialed remote
#     (fine-grained read-only PAT embedded in the remote URL)
#   - /srv/smartfleet/.env.staging and .env.prod populated
#   - docker + compose installed

set -euo pipefail

ENV="${1:?usage: deploy.sh <staging|prod> [git-ref]}"
REF="${2:-main}"

REPO_DIR=/srv/smartfleet/src
COMPOSE_FILE=/srv/smartfleet/docker-compose.aws.yml

case "$ENV" in
  staging) SERVICE=api-staging; CONTAINER=smartfleet-api-staging; PORT=3002; ENV_FILE=/srv/smartfleet/.env.staging ;;
  prod)    SERVICE=api-prod;    CONTAINER=smartfleet-api-prod;    PORT=3001; ENV_FILE=/srv/smartfleet/.env.prod ;;
  *) echo "unknown env: $ENV (want staging|prod)"; exit 1 ;;
esac

echo "==> [$ENV] fetching $REF"
cd "$REPO_DIR"
git fetch origin "$REF"
git checkout -q "$REF" 2>/dev/null || git checkout -qb "$REF" "origin/$REF"
git reset --hard "origin/$REF"
SHA=$(git rev-parse --short HEAD)
echo "==> [$ENV] at commit $SHA"

echo "==> [$ENV] building image smartfleet-api:$SHA (cache-friendly, may take a while on t3.micro)"
docker build -f apps/api/Dockerfile -t "smartfleet-api:$SHA" -t smartfleet-api:local .

echo "==> [$ENV] applying Prisma schema"
docker run --rm --env-file "$ENV_FILE" "smartfleet-api:$SHA" npx prisma db push --skip-generate

echo "==> [$ENV] restarting $SERVICE"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate "$SERVICE"

echo "==> [$ENV] waiting for health"
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" wget -qO- "http://localhost:$PORT/api/v1/health/live" >/dev/null 2>&1; then
    echo "==> [$ENV] healthy at commit $SHA"
    exit 0
  fi
  sleep 5
done

echo "==> [$ENV] FAILED health check after 150s; recent logs:"
docker logs --tail 50 "$CONTAINER" || true
exit 1
