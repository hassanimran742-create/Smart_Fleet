terraform {
  required_version = ">= 1.6.0"

  # Once Terraform Cloud / S3 backend is set up, configure here. For now
  # state is local until the pilot stabilises.
  # backend "s3" { ... }
}

# Populate when each provider's Terraform module stabilises.
# module "postgres" {
#   source = "../../modules/neon"
#   project_name = "smart-fleet"
#   region       = "ap-southeast-1"
# }
#
# module "redis" {
#   source = "../../modules/upstash-redis"
#   name   = "smart-fleet-prod"
# }
#
# module "object_storage" {
#   source = "../../modules/cloudflare-r2"
#   bucket = "smart-fleet-prod"
# }
#
# module "api" {
#   source                 = "../../modules/railway"
#   service_name           = "smart-fleet-api"
#   environment            = "production"
#   database_url           = module.postgres.connection_string
#   redis_url              = module.redis.connection_string
#   s3_endpoint            = module.object_storage.endpoint
#   s3_access_key          = module.object_storage.access_key
#   s3_secret_key          = module.object_storage.secret_key
#   s3_bucket              = module.object_storage.bucket
# }
