#!/bin/bash
# Smart_Fleet — deploy script, runs ON the EC2 host.
# Invoked over SSH by .github/workflows/deploy-staging.yml and promote-prod.yml.
#
# Usage: deploy.sh <staging|prod> [git-ref]
#   git-ref: a branch, a tag or a full commit SHA (default main). promote-prod passes the full SHA
#   that passed CI and was deployed to staging. Deploying an earlier SHA again is a code rollback:
#   its image is reused when it is still on the host. A rollback past a migration needs the
#   pre-deploy snapshot restored as well (docs/pilot/DATA_MODEL.md §2.6).
#
# Order, so that a bad release stops before it changes anything:
#   1. build (or reuse) smartfleet-api:<sha>, with the commit baked in (GET /api/v1/health version);
#   2. check that the host's compose file runs that image, and the env file against the new API's
#      boot guards (nothing touched yet);
#   3. prod only: take an RDS snapshot and wait until it is available;
#   4. apply the migrations (prisma/scripts/migrate.sh);
#   5. recreate only this service on exactly that image, recorded in /srv/smartfleet/images.env;
#   6. wait until GET /api/v1/health answers 200 with this commit as its version.
#
# Prerequisites on the EC2 host (one-time, see Phase I):
#   - repo cloned at /srv/smartfleet/src with a credentialed remote
#     (fine-grained read-only PAT embedded in the remote URL)
#   - /srv/smartfleet/.env.staging and .env.prod filled from .env.*.example in this folder
#   - /srv/smartfleet/docker-compose.aws.yml copied from this folder (its images come from
#     IMAGE_PROD and IMAGE_STAGING, which this script records in /srv/smartfleet/images.env)
#   - for prod: /srv/smartfleet/deploy.env with RDS_INSTANCE_ID=<the prod RDS instance> (and
#     AWS_REGION when it isn't ap-southeast-1), and an instance role allowed rds:CreateDBSnapshot
#     and rds:DescribeDBSnapshots on it
#   - docker + compose v2 + aws CLI installed (bootstrap.sh)

set -euo pipefail

ENV="${1:?usage: deploy.sh <staging|prod> [git-ref]}"
REF="${2:-main}"

REPO_DIR=/srv/smartfleet/src
COMPOSE_FILE=/srv/smartfleet/docker-compose.aws.yml
# The image each service runs (IMAGE_PROD=…, IMAGE_STAGING=…). Written only by this script; every
# compose command reads it with --env-file, so a restart never picks another build.
IMAGES_FILE=/srv/smartfleet/images.env
# Host settings for this script (RDS_INSTANCE_ID, AWS_REGION). `sudo bash` drops the caller's env.
DEPLOY_CONF=/srv/smartfleet/deploy.env

case "$ENV" in
  staging) SERVICE=api-staging; CONTAINER=smartfleet-api-staging; PORT=3002; ENV_FILE=/srv/smartfleet/.env.staging; RUN_AS=staging;    IMAGE_VAR=IMAGE_STAGING ;;
  prod)    SERVICE=api-prod;    CONTAINER=smartfleet-api-prod;    PORT=3001; ENV_FILE=/srv/smartfleet/.env.prod;    RUN_AS=production; IMAGE_VAR=IMAGE_PROD ;;
  *) echo "unknown env: $ENV (want staging|prod)"; exit 1 ;;
esac

if [ -f "$DEPLOY_CONF" ]; then
  # shellcheck disable=SC1090
  . "$DEPLOY_CONF"
fi

# Records the image a service runs: replaces its line in $IMAGES_FILE.
set_image() {
  touch "$IMAGES_FILE"
  { grep -v "^$1=" "$IMAGES_FILE" || true; echo "$1=$2"; } > "$IMAGES_FILE.tmp"
  mv "$IMAGES_FILE.tmp" "$IMAGES_FILE"
}

# A service this file doesn't know yet keeps the image its container runs now, so recreating one
# service never changes the other.
while read -r var container; do
  if ! grep -q "^$var=" "$IMAGES_FILE" 2>/dev/null; then
    running=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true)
    if [ -n "$running" ]; then set_image "$var" "$running"; fi
  fi
done <<'SERVICES'
IMAGE_PROD smartfleet-api-prod
IMAGE_STAGING smartfleet-api-staging
SERVICES

echo "==> [$ENV] fetching $REF"
cd "$REPO_DIR"
# A branch, a tag or a full SHA alike (GitHub serves a SHA only when a branch or tag reaches it).
git fetch --quiet origin "$REF"
git checkout --quiet --force --detach FETCH_HEAD
FULL_SHA=$(git rev-parse HEAD)
SHA=$(git rev-parse --short HEAD)
IMAGE="smartfleet-api:$SHA"
echo "==> [$ENV] at commit $FULL_SHA"

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> [$ENV] image $IMAGE is already on this host; reusing it"
else
  echo "==> [$ENV] building image $IMAGE (cache-friendly, may take a while on t3.micro)"
  docker build -f apps/api/Dockerfile --build-arg GIT_COMMIT_SHA="$FULL_SHA" -t "$IMAGE" .
fi

# The host's compose file must take this service's image from ${IMAGE_VAR} (the host's copy may be
# hand-edited). Checked before anything changes, so no other build can end up on a migrated database.
COMPOSE_IMAGE=$(env "$IMAGE_VAR=$IMAGE" docker compose -f "$COMPOSE_FILE" config --images "$SERVICE" || true)
if [ "$COMPOSE_IMAGE" != "$IMAGE" ]; then
  echo "==> [$ENV] REFUSED: $COMPOSE_FILE gives $SERVICE the image '${COMPOSE_IMAGE:-none}', not \${$IMAGE_VAR}; copy infrastructure/aws/docker-compose.aws.yml there"
  exit 1
fi

# The new API refuses to boot on an env file that misses what it requires (BULLMQ_PREFIX,
# CORS_ORIGINS, 64-hex ENCRYPTION_KEY and BLIND_INDEX_KEY…). Find out now, before the migration.
# An image from before Inc 1 (the baseline release, or a rollback to it) has no boot guards to check.
if docker run --rm --entrypoint test "$IMAGE" -f dist/common/bootstrap/boot-preflight.js; then
  echo "==> [$ENV] checking $ENV_FILE against the boot guards of $IMAGE"
  docker run --rm --env-file "$ENV_FILE" -e NODE_ENV="$RUN_AS" "$IMAGE" node dist/common/bootstrap/boot-preflight.js
else
  echo "==> [$ENV] $IMAGE is from before Inc 1 (no boot guards): no env check"
fi

if [ "$ENV" = prod ]; then
  echo "==> [$ENV] migration status before applying"
  docker run --rm --env-file "$ENV_FILE" "$IMAGE" npx prisma migrate status || true
  # The previous release can't read what a new migration writes, so rolling back past one means
  # restoring this snapshot (DATA_MODEL §2.6). No snapshot, no prod deploy.
  if [ -z "${RDS_INSTANCE_ID:-}" ]; then
    echo "==> [$ENV] REFUSED: set RDS_INSTANCE_ID in $DEPLOY_CONF so the pre-deploy snapshot can be taken"
    exit 1
  fi
  REGION="${AWS_REGION:-ap-southeast-1}"
  SNAPSHOT_ID="smartfleet-predeploy-$(date -u +%Y%m%d-%H%M%S)-$SHA"
  echo "==> [$ENV] taking RDS snapshot $SNAPSHOT_ID of $RDS_INSTANCE_ID and waiting for it"
  aws rds create-db-snapshot --region "$REGION" --db-instance-identifier "$RDS_INSTANCE_ID" \
    --db-snapshot-identifier "$SNAPSHOT_ID" >/dev/null
  aws rds wait db-snapshot-available --region "$REGION" --db-snapshot-identifier "$SNAPSHOT_ID"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $SNAPSHOT_ID before $FULL_SHA" >> /srv/smartfleet/snapshots.log
  echo "==> [$ENV] snapshot $SNAPSHOT_ID is available"
fi

# The only path to the database (docs/pilot/DATA_MODEL.md §2.3). A failed or blocked migration
# changes nothing and stops here, before the restart (set -e).
echo "==> [$ENV] applying database migrations"
docker run --rm --env-file "$ENV_FILE" "$IMAGE" sh prisma/scripts/migrate.sh

echo "==> [$ENV] restarting $SERVICE on $IMAGE"
set_image "$IMAGE_VAR" "$IMAGE"
docker compose --env-file "$IMAGES_FILE" -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "$SERVICE"
RUNNING=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
if [ "$RUNNING" != "$IMAGE" ]; then
  echo "==> [$ENV] FAILED: $CONTAINER runs $RUNNING, not $IMAGE. $COMPOSE_FILE must take its image from \${$IMAGE_VAR}."
  exit 1
fi

echo "==> [$ENV] waiting for GET /api/v1/health to report $FULL_SHA"
for i in $(seq 1 30); do
  body=$(docker exec "$CONTAINER" wget -qO- "http://localhost:$PORT/api/v1/health" 2>/dev/null || true)
  case "$body" in
    *"\"version\":\"$FULL_SHA\""*)
      echo "==> [$ENV] healthy at commit $FULL_SHA ($IMAGE)"
      exit 0
      ;;
  esac
  sleep 5
done

echo "==> [$ENV] FAILED health check after 150s (last answer: ${body:-none}); recent logs:"
docker logs --tail 50 "$CONTAINER" || true
exit 1
