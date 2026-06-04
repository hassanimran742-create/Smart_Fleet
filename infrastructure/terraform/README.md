# Infrastructure as Code

This directory defines all cloud resources used by Smart_Fleet. The same
application code runs against any of the targets — only the Terraform
module imports change when migrating between clouds.

## Layout

```
terraform/
├── live/
│   ├── production/        # prod tfstate
│   └── staging/           # staging tfstate
└── modules/
    ├── railway/           # API host (production stack)
    ├── neon/              # Postgres
    ├── cloudflare-r2/     # Object storage
    ├── upstash-redis/     # Cache + queue
    └── aws/               # Optional migration target
        ├── ecs-api/
        ├── rds-postgres/
        ├── elasticache-redis/
        └── s3/
```

## Day-1 status

Modules are stubs. The pilot deployment is done via dashboards (Railway,
Neon, Upstash, Cloudflare) because Terraform providers for Railway/Neon
are still early. Once the pilot stabilises, codify each resource.

## Migration to AWS (recipe)

1. Stand up `modules/aws/*` resources via `terraform apply` against a new
   AWS account.
2. `pg_dump` from Neon, `pg_restore` to RDS.
3. `aws s3 sync` from R2 to S3 (R2 supports S3 list/get).
4. Update the API's environment variables to point at AWS endpoints.
   No application code change is required — every external dep is
   addressed by an env var (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`,
   etc).
5. Cut over DNS.
