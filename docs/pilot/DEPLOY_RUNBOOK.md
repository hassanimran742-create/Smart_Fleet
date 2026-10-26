# Deploy runbook: the two pilot releases

For the IT person who deploys Smart Fleet. There are two releases, deployed in this order, each one to staging first and then to production:

| Release | What it does | Commit on branch `release/pilot` |
|---|---|---|
| **1, the baseline** | Records the live database's migration history. On a server that runs af889bf, it changes no table, no data and no app. | The first commit, "Release 1, the baseline: …" |
| **2, the switch-over** | Increments 1, 2 and 3: the new server, office website and phone apps, and six database migrations (the last, flat_delivery_cost, makes the delivery cost one amount per order). | The second commit, "Release 2: …" |

If release 2 is deployed to a database that hasn't had release 1, it stops with `DB_NOT_BASELINED: deploy the baseline release first` and changes nothing.

The steps are for the AWS server: the EC2 host, with everything under `/srv/smartfleet`. For Railway, see [If live runs on Railway](#if-live-runs-on-railway). Run each command on the host as `ec2-user`. On staging, use `.env.staging`, `smartfleet-api-staging`, port 3002 and `staging.smartfleetpk.com`. On production, use `.env.prod`, `smartfleet-api-prod`, port 3001 and `api.smartfleetpk.com`.

## Before you start

1. **Find out what runs today.**
   ```bash
   sudo git -C /srv/smartfleet/src log -1 --format='%H %s'
   docker inspect --format '{{.Name}} {{.Config.Image}}' smartfleet-api-prod smartfleet-api-staging
   ```
   Write down both images: they are what release 1 rolls back to.
   - The commit should be `af889bf…` "drivers: fix 500 on create when optional fields are blank".
   - An older commit means the old `main` runs; see release 1, step 6.
   - No `/srv/smartfleet` on this host means live isn't this AWS server.
2. **Get the two commit ids.** The branch must be on GitHub.
   ```bash
   sudo git -C /srv/smartfleet/src fetch origin release/pilot
   sudo git -C /srv/smartfleet/src log --format='%H %s' -2 FETCH_HEAD
   R1=<the full id of "Release 1, the baseline: …">
   R2=<the full id of "Release 2: …">
   ```
   `R1` and `R2` are shell variables: set them again in every new terminal.
3. **Pick a quiet hour, and tell the shops and drivers.** Release 2 takes about an hour with the phones. During its deploy, the old apps may show errors for a minute.

## Release 1: the baseline

1. **Take a database snapshot.** If staging and production are on one RDS instance, one snapshot covers both.
   ```bash
   SNAP=sf-before-release1-$(date -u +%Y%m%d-%H%M)
   aws rds create-db-snapshot --db-instance-identifier <the RDS instance> --db-snapshot-identifier $SNAP
   aws rds wait db-snapshot-available --db-snapshot-identifier $SNAP
   ```
   For a database that isn't on RDS, see [Snapshots and restores](#snapshots-and-restores).
2. **Put the new deploy script and compose file on the host (once).** `deploy.sh` runs from the host's copy of the repo, so check out release 1 there first:
   ```bash
   sudo git -C /srv/smartfleet/src checkout --force --detach $R1
   cd /srv/smartfleet
   sudo cp docker-compose.aws.yml docker-compose.aws.yml.before-release1
   sudo cp src/infrastructure/aws/docker-compose.aws.yml .
   ```
   - The new compose file takes each API's image from `/srv/smartfleet/images.env`, which `deploy.sh` writes. Pass that file to every compose command (`--env-file images.env`).
   - If the old copy had other changes, carry them over: compare the two files with `diff`. Don't carry over the `image:` lines.
3. **For production only, write `/srv/smartfleet/deploy.env`.**
   - Put `RDS_INSTANCE_ID=<the prod RDS instance>` in it. Add `AWS_REGION=<region>` when the region isn't ap-southeast-1.
   - The host's IAM role needs `rds:CreateDBSnapshot` and `rds:DescribeDBSnapshots`.
   - Before every production migration, `deploy.sh` takes an RDS snapshot. Without this file it refuses to deploy to production.
4. **The env files need no change for release 1.** It runs the af889bf app code, which needs no new variable.
5. **Deploy to staging, check it, then deploy to production.**
   ```bash
   sudo bash /srv/smartfleet/src/infrastructure/aws/deploy.sh staging $R1
   sudo bash /srv/smartfleet/src/infrastructure/aws/deploy.sh prod $R1
   ```
   - Each run builds the image, which is slow on a t3.micro.
   - The log shows `is from before Inc 1 (no boot guards): no env check`, then `Migration 0_baseline marked as applied.`
   - It ends with `==> [prod] healthy at commit <R1>`.
   - A second run of the same commit prints `No pending migrations to apply.`

   **Check it worked:**
   ```bash
   docker exec smartfleet-api-prod wget -qO- http://localhost:3001/api/v1/health
   ```
   It should show `"status":"ok"` and `"version":"<R1>"`.
   ```bash
   . /srv/smartfleet/images.env
   sudo docker run --rm --env-file /srv/smartfleet/.env.prod "$IMAGE_PROD" npx prisma migrate status
   ```
   It should end with `Database schema is up to date!`. Sign in to the office website and open the orders; a shop places an order as usual.
6. **If it stops,** the running API and the database are as they were.

   | Message | What to do |
   |---|---|
   | `REFUSED: … docker-compose.aws.yml gives …` | Do step 2: copy the compose file. |
   | `REFUSED: set RDS_INSTANCE_ID …` | Do step 3. |
   | `Use the --accept-data-loss flag`, with only the warning "A unique constraint covering the columns `[user_id]` on the table `clients` will be added" | Live runs the old `main`. The new index is on a new, empty column, so it is safe. Run the command below **once** for this environment, then deploy again. If there is any other warning, stop and send the output to the developer. |
   | `DRIFT: …` or any other error | Stop, and send the output to the developer. Nothing was marked applied. |
   | `FAILED health check …` | Send `docker logs smartfleet-api-prod` to the developer. |

   The command for the `--accept-data-loss` case:
   ```bash
   IMG=smartfleet-api:$(sudo git -C /srv/smartfleet/src rev-parse --short $R1)
   sudo docker run --rm --env-file /srv/smartfleet/.env.prod $IMG npx prisma db push --skip-generate --accept-data-loss
   ```
7. **To roll back,** put the old image back. Release 1 only added the migration history (and, on the old `main`, new empty columns), so the old API runs on the database as it is.
   ```bash
   cd /srv/smartfleet
   sudo sed -i 's|^IMAGE_PROD=.*|IMAGE_PROD=<the image you wrote down>|' images.env
   sudo docker compose --env-file images.env -f docker-compose.aws.yml up -d --no-deps --force-recreate api-prod
   ```
   The full undo is to also restore the snapshot of step 1.

## Release 2: the switch-over

Start only when release 1 runs on that environment: `migrate status` lists `0_baseline` as applied.

1. **Finish the open work with today's apps, then run the readiness check.**
   - Deliver or cancel every open order and finish every run.
   - Finish every refill past "Pending", or have the shop cancel it.
   - Finish or cancel every transfer that is on the road.
   - Check the top-ups that are waiting.

   Then run the check. It must print `(0 rows)`:
   ```bash
   URL=$(sudo sed -n 's/^DATABASE_URL=//p' /srv/smartfleet/.env.prod | sed -e 's/schema=public&//' -e 's/[?&]schema=public$//')
   sudo git -C /srv/smartfleet/src show $R2:docs/pilot/release2-ready.sql | docker run --rm -i postgres:16-alpine psql "$URL" -f -
   ```
   - Each row names a problem and its fix.
   - A balance below zero, or two customers of one shop with the same phone number, needs the developer.
   - Each migration also checks this, and stops if something is still open. A stop after the first migration leaves the earlier ones applied while the old apps run, so fix everything first.
2. **Update the env files** (`/srv/smartfleet/.env.prod` and `.env.staging`). The templates are `src/infrastructure/aws/.env.prod.example` and `.env.staging.example`.

   | Variable | Production | Staging | Rule |
   |---|---|---|---|
   | `APP_ENV` | `production` | `staging` | |
   | `BULLMQ_PREFIX` | `sf-prod` | `sf-staging` | It must contain the environment's name. |
   | `CORS_ORIGINS` | the office website, e.g. `https://admin.smartfleetpk.com` | the staging website | Copy it from the browser's address bar: `https://` and the host only. No path, never `*`. Separate several with commas. |
   | `ENCRYPTION_KEY`, `BLIND_INDEX_KEY` | 64 hex characters each | other values | **If they are already set to 64 hex characters, keep them.** A new key makes every stored CNIC unreadable. Only when one is missing: `openssl rand -hex 32`. Never change them afterwards. |
   | `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_ENDPOINT` | the real private bucket and its keys | the staging bucket | Never `minio` / `minio123`. |
   | `PUBLIC_LINK_BASE_URL` | `https://api.smartfleetpk.com` | `https://staging.smartfleetpk.com` | https |
   | `CONFIRM_LINK_SECRET` | `openssl rand -hex 32` | another one | Set it once: it signs the customers' links. |
   | `MESSAGING_PROVIDER` | `mock` | `mock` | |
   | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | keep them if they are at least 32 characters and different | | New ones sign everyone out. |

   - Delete `ALLOWED_ORIGINS`: `CORS_ORIGINS` replaces it.
   - Fill in or delete every value that still starts with `REPLACE_` (`SENTRY_DSN`, `POSTHOG_API_KEY`…).
   - On production, delete `AUTH_EXPOSE_OTP`, `TEST_PHONES`, `ALLOW_DEMO_SEED`, any `SEED_…` and `PAYMENTS_WEBHOOK_ENABLED=true`.
   - Before it touches the database, `deploy.sh` checks the file. If something is wrong, it stops with one line that names it, for example `BOOT_REFUSED: BULLMQ_PREFIX is not set; CORS_ORIGINS is not set; CONFIRM_LINK_SECRET is not set; PUBLIC_LINK_BASE_URL is not set`.
3. **Take a database snapshot,** as in release 1 but named `sf-before-release2-…`. On production, `deploy.sh` takes another one.
4. **Deploy to staging, check it, then deploy to production.**
   ```bash
   sudo bash /srv/smartfleet/src/infrastructure/aws/deploy.sh staging $R2
   sudo bash /srv/smartfleet/src/infrastructure/aws/deploy.sh prod $R2
   ```
   The log shows `BOOT_PREFLIGHT_OK`, then `Applying migration …` six times (inc1a, inc1b, inc2, inc3, users_app_seen, flat_delivery_cost). It ends with `healthy at commit <R2>`.

   **Check it worked:**
   ```bash
   curl -s https://api.smartfleetpk.com/api/v1/health
   ```
   It should show `"status":"ok"` and `"version":"<R2>"`.
   ```bash
   . /srv/smartfleet/images.env
   sudo docker run --rm --env-file /srv/smartfleet/.env.prod "$IMAGE_PROD" npx prisma migrate status
   ```
   It should show `6 migrations found` and `Database schema is up to date!`.
   ```bash
   curl -si -X OPTIONS https://api.smartfleetpk.com/api/v1/auth/login -H 'Origin: https://admin.smartfleetpk.com' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
   ```
   It must print the website's address.
   ```bash
   docker logs smartfleet-api-prod 2>&1 | grep -E 'CORS origins|Could not check bucket'
   ```
   It should show the website addresses, and no "Could not check bucket" line.
5. **Publish the office website** built from `$R2`, where it is hosted today. Set these variables:
   - `VITE_API_BASE_URL=https://api.smartfleetpk.com/api/v1`
   - `VITE_API_ORIGIN=https://api.smartfleetpk.com`
   - `VITE_APP_ENV=live`. On staging, use the staging host and `test`.

   Then sign in to it.
6. **Update Caddy,** for the customers' links.
   - If your host names are `api.smartfleetpk.com` and `staging.smartfleetpk.com`, copy the new file. If they differ, copy only its `log` and `header` blocks.
   ```bash
   cd /srv/smartfleet && sudo cp Caddyfile Caddyfile.before-release2 && sudo cp src/infrastructure/aws/Caddyfile .
   docker exec smartfleet-caddy caddy reload --config /etc/caddy/Caddyfile
   ```
7. **Switch the day-end sheet off at once.** It is on by default. Customer confirmation stays off.
   ```bash
   . /srv/smartfleet/images.env
   sudo docker run --rm --env-file /srv/smartfleet/.env.prod "$IMAGE_PROD" node dist/modules/settings/cli/set-setting.js \
     --key dayEnd.enabled --value false --reason "Switch-over: back on after the phone update"
   ```
   - The running API picks up a change made this way within 30 seconds.
   - You can also use the office website: Settings, Features, Day-end sheet: Off.
   - **Don't assign any driver until step 9 is done.**
8. **Run the pilot setup with the client's data file.** It creates the shops, prices, drivers and vans, stations, office users, settings and starting stock.
   - The file follows `docs/pilot/pilot-setup.sample.json`, **without** `openingBalances`: on live, balances come only from top-ups.
   - If live already has some of these shops, use their codes from the Distributors page.
   - On staging, load the test data instead: `pilot/test.json` with `--test` (infrastructure/aws/README.md, "Pilot setup and reset on the server").
   ```bash
   cd /srv/smartfleet && sudo mkdir -p pilot && sudo cp ~/client.json pilot/ && . ./images.env
   sudo docker run --rm -it --log-driver none --env-file .env.prod -v /srv/smartfleet/pilot:/pilot "$IMAGE_PROD" \
     node dist/modules/pilot-setup/cli/pilot-setup.js --file /pilot/client.json --dry-run
   sudo docker run --rm -it --log-driver none --env-file .env.prod -v /srv/smartfleet/pilot:/pilot "$IMAGE_PROD" \
     node dist/modules/pilot-setup/cli/pilot-setup.js --file /pilot/client.json --labels /pilot/labels-prod.csv
   ```
   - The dry run checks the whole file and writes nothing. If it refuses, it names the entry and the reason.
   - The real run writes everything or nothing. It prints each new login's password once: put them in the password manager and give each person theirs.
   - It writes the QR labels to `/srv/smartfleet/pilot/labels-prod.csv`. Running it again is safe.
9. **Update the phones over the air, in this order.**
   1. **Publish the update** (JS 0.1.1) of both apps. Use a computer with the repo at `$R2` (run `npm ci`), signed in to the Expo account that owns the apps (`eas login`).
      ```bash
      cd apps/mobile
      APP_VARIANT=distributor EXPO_PUBLIC_ENV=production EXPO_PUBLIC_API_BASE_URL=https://api.smartfleetpk.com/api/v1 \
        eas update --platform android --channel distributor-production --message "Smart Fleet 0.1.1"
      APP_VARIANT=driver EXPO_PUBLIC_ENV=production EXPO_PUBLIC_API_BASE_URL=https://api.smartfleetpk.com/api/v1 \
        eas update --platform android --channel driver-production --message "Smart Fleet 0.1.1"
      ```
      - Set all three variables exactly as shown: the update carries the server's address.
      - For staging, use the `-staging` channels, `EXPO_PUBLIC_ENV=staging` and `https://staging.smartfleetpk.com/api/v1`.
   2. **Set the lowest app versions to 0.1.1.** On the office website: Settings, Tech team, Lowest distributor app version and Lowest driver app version. Or run, once for each:
      ```bash
      . /srv/smartfleet/images.env
      sudo docker run --rm --env-file /srv/smartfleet/.env.prod "$IMAGE_PROD" node dist/modules/settings/cli/set-setting.js \
        --key app.minVersion.distributor --value '"0.1.1"' --reason "Switch-over: every phone on 0.1.1"
      ```
      The second time, use `--key app.minVersion.driver`. A phone still on the old app is now told to close the app and open it again.
   3. **Restart every pilot phone, shops first.** Close the app fully, open it again (it installs the update as it starts), and use it once.
   4. **Check every phone on the office website.** On the Distributors and Drivers pages, every pilot shop and driver must show **App: up to date** (hover: 0.1.1).
      - "App: needs update": that phone still runs the old app. Close it and open it again.
      - "App: not opened yet": the phone hasn't been used since the deploy.

      Each label compares the phone's last version with the lowest version of sub-step 2. That is why the setting comes first: at 0.0.0 a phone on the old app also reads "App: up to date".
   5. **Only then switch things on.**
      - Day-end sheet: On. Run step 7's command with `--value true`.
      - Customer confirmation: On, if the owner says so. Set Settings, Support, Office phone first.
      - The office can start assigning drivers. The scan runs come with release 2 and have no switch.
10. **Retire the seeded logins on production,** once the named office users exist:
    - "Test Distributor" (+923001111111): the Distributors page, Suspend….
    - "Test Driver" (+923002222222): the Drivers page, Archive….
    - "LPG Super Admin" (+923000000000) has no website button. Suspend it with these commands:
    ```bash
    API=https://api.smartfleetpk.com/api/v1
    TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -H 'X-App-Variant: admin-web' \
      -d '{"phone":"<your office phone>","password":"<your password>"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')
    curl -s "$API/users?role=SUPER_ADMIN" -H "Authorization: Bearer $TOKEN"
    ```
    The list shows each office user's `id` and `phone`. Use the `id` of +923000000000 in the next command.
    ```bash
    curl -s -X PATCH "$API/users/<that id>/status" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d '{"value":"SUSPENDED","reason":"Seeded login, replaced by the named office users"}'
    ```
11. **If it stops:**

    | Message | What it means | What to do |
    |---|---|---|
    | `BOOT_REFUSED: …` | The env file is missing something or has a wrong value. Nothing changed. | Fix what it names (step 2), then deploy again. |
    | `DB_NOT_BASELINED: deploy the baseline release first` | Release 1 isn't on this environment. Nothing changed. | Do release 1 first. |
    | `MIGRATION_BLOCKED incX: …, run "prisma migrate resolve --rolled-back <name>", then deploy again.` | Something is still open. That migration changed nothing, the ones before it stay applied, and the old API keeps running. | Do the fix it names, run the command below with the `<name>` from the message, then deploy again. |
    | `FAILED health check …` | The new API didn't come up. | Read `docker logs smartfleet-api-prod`, then roll back or send the logs to the developer. |

    The command for `MIGRATION_BLOCKED`:
    ```bash
    sudo docker run --rm --env-file /srv/smartfleet/.env.prod smartfleet-api:$(sudo git -C /srv/smartfleet/src rev-parse --short $R2) \
      npx prisma migrate resolve --rolled-back <name>
    ```
12. **To roll back, restore the snapshot of step 3.** Don't just put the old image back: the old API can't read what the migrations wrote.
    1. Restore the snapshot ([Snapshots and restores](#snapshots-and-restores)).
    2. Point `DATABASE_URL` in the env file, and `RDS_INSTANCE_ID` in `deploy.env`, at the restored database.
    3. Deploy release 1 again with `deploy.sh prod $R1`. Its image is still on the host.
    4. Put the previous website build back.
    5. If the phone update was already published, put the phones back on the update before it. `eas update:list --branch distributor-production` shows it (and the same for `driver-production`). Then run `eas update:republish --group <its group id>`.

## Snapshots and restores

- **RDS:** create a snapshot as in release 1, step 1. To restore, run `aws rds restore-db-instance-from-db-snapshot --db-instance-identifier sf-restored-<date> --db-snapshot-identifier <snapshot>` (or use the RDS console: Snapshots, Restore). It makes a new instance: wait until it is available, then put its endpoint in `DATABASE_URL`.
- **Another PostgreSQL:** set `URL` as in release 2, step 1, then:
  ```bash
  sudo mkdir -p /srv/smartfleet/backup
  docker run --rm postgres:16-alpine pg_dump -Fc "$URL" | sudo tee /srv/smartfleet/backup/prod-before-release1.dump >/dev/null
  ```
  To restore into a new, empty database, then point `DATABASE_URL` at it:
  ```bash
  sudo cat /srv/smartfleet/backup/prod-before-release1.dump | docker run --rm -i postgres:16-alpine pg_restore --no-owner -d "<the new database's URL>"
  ```

## If live runs on Railway

- **Release 1:** make Railway deploy commit `R1` (point the branch it builds at that commit).
  - Its start command (`railway.toml`) runs the boot check (release 1 has none), then `prisma/scripts/migrate.sh`, then the API.
  - The deploy log shows `Migration 0_baseline marked as applied.`
  - The database needs PostGIS.
- **Release 2:** first set step 2's variables in Railway (the service, then Variables), then deploy `R2`.
  - A refused variable stops the new deployment before the migration, and the previous deployment keeps serving.
  - The phone steps are the same.
- **Snapshot:** use the database's Backups in Railway, or `pg_dump` with its public URL. To roll back, restore the backup, then redeploy release 1's deployment.

How these steps were tested on the Docker test server: [CHANGELOG.md](CHANGELOG.md), "Release prep, 2026-10-25". The reasoning behind the order is in DATA_MODEL §2.3 and §2.6, and API_CONTRACT §8.5.
