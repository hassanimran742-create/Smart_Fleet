#!/bin/bash
# Smart_Fleet EC2 first-boot bootstrap.
# Paste this into "User data" when launching the EC2 instance in Phase D.
# It runs ONCE on first boot as root.
#
# What it does:
#   1. Updates the OS
#   2. Installs Docker + Compose v2 plugin
#   3. Installs AWS CLI v2 and CloudWatch Agent
#   4. Creates /srv/smartfleet/ layout
#   5. Enables Docker logging to CloudWatch
#
# It does NOT:
#   - Create the .env.prod / .env.staging files (you scp those in Phase G)
#   - Start the API containers (you docker-compose up after env files are placed)

set -euxo pipefail

# --- OS updates + base tools ---
dnf update -y
dnf install -y docker curl tar gzip jq

# --- Docker ---
systemctl enable --now docker
usermod -aG docker ec2-user

# --- Docker Compose v2 plugin ---
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# --- AWS CLI v2 (for ECR login, S3 sync, etc.) ---
cd /tmp
curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -q awscliv2.zip
./aws/install
rm -rf awscliv2.zip aws

# --- CloudWatch Agent ---
dnf install -y amazon-cloudwatch-agent

# Config: ship system journal + Docker container stdout to /smartfleet/system
cat >/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'JSON'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "metrics": {
    "namespace": "Smartfleet/EC2",
    "metrics_collected": {
      "mem": { "measurement": ["mem_used_percent"] },
      "disk": { "measurement": ["used_percent"], "resources": ["/"] }
    }
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/messages",
            "log_group_name": "/smartfleet/system",
            "log_stream_name": "{instance_id}/messages"
          },
          {
            "file_path": "/var/log/cloud-init-output.log",
            "log_group_name": "/smartfleet/system",
            "log_stream_name": "{instance_id}/cloud-init"
          }
        ]
      }
    }
  }
}
JSON

systemctl enable --now amazon-cloudwatch-agent

# --- Smart_Fleet directory layout ---
mkdir -p /srv/smartfleet
chown root:root /srv/smartfleet
chmod 0750 /srv/smartfleet

# Placeholder for env files; real ones come via scp in Phase G.
touch /srv/smartfleet/.env.prod /srv/smartfleet/.env.staging
chmod 0600 /srv/smartfleet/.env.prod /srv/smartfleet/.env.staging

# --- Mark bootstrap as done ---
echo "smartfleet-bootstrap-complete $(date -u +%Y-%m-%dT%H:%M:%SZ)" > /srv/smartfleet/bootstrap.log

echo "[bootstrap] Done. Next steps:"
echo "  1. scp Caddyfile + docker-compose.aws.yml to /srv/smartfleet/"
echo "  2. Edit /srv/smartfleet/.env.prod and .env.staging"
echo "  3. cd /srv/smartfleet && docker compose -f docker-compose.aws.yml up -d"
