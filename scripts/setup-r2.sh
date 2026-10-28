#!/usr/bin/env bash
# Turns on Cloudflare R2 for the CRM. Run on the server as root:
#   ssh -t root@200.234.44.216 "bash /opt/shotlin-crm/app/scripts/setup-r2.sh"
# It asks for your R2 details privately (the keys are never shown or logged), checks they work,
# copies your existing WhatsApp images into the bucket, and only then switches the CRM over.
# If anything fails before the switch, nothing is changed.
set -euo pipefail

ENV_FILE=/opt/shotlin-crm/.env
APP=/opt/shotlin-crm/app
NODE=/opt/node24/bin/node
TSX=/opt/shotlin-crm/tools/node_modules/tsx/dist/cli.mjs
BACKUP="$ENV_FILE.bak-r2-$(date +%Y%m%d%H%M%S)"

[ "$(id -u)" = "0" ] || { echo "Run this as root."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }

echo "Cloudflare R2 setup for Shotlin CRM"
echo "-----------------------------------"
read -r -p "Account ID (32 characters): " ACCOUNT_ID
read -r -p "Bucket name: " BUCKET
read -r -s -p "Access Key ID (hidden): " ACCESS_KEY; echo
read -r -s -p "Secret Access Key (hidden): " SECRET_KEY; echo
read -r -p "Storage limit in GB for warnings [10]: " LIMIT_GB
LIMIT_GB="${LIMIT_GB:-10}"

ACCOUNT_ID="$(printf '%s' "$ACCOUNT_ID" | tr -d '[:space:]')"
BUCKET="$(printf '%s' "$BUCKET" | tr -d '[:space:]')"
ACCESS_KEY="$(printf '%s' "$ACCESS_KEY" | tr -d '[:space:]')"
SECRET_KEY="$(printf '%s' "$SECRET_KEY" | tr -d '[:space:]')"

[[ "$ACCOUNT_ID" =~ ^[0-9a-fA-F]{32}$ ]] || { echo "The Account ID should be 32 letters and numbers. Nothing was changed."; exit 1; }
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || { echo "The bucket name should be lowercase letters, numbers and hyphens. Nothing was changed."; exit 1; }
[ -n "$ACCESS_KEY" ] && [ -n "$SECRET_KEY" ] || { echo "Both keys are needed. Nothing was changed."; exit 1; }
[[ "$LIMIT_GB" =~ ^[0-9]+$ ]] && [ "$LIMIT_GB" -gt 0 ] || { echo "The limit should be a whole number of GB. Nothing was changed."; exit 1; }

ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"

# Runs a CRM script with the new bucket settings, without saving them anywhere yet.
run_crm() {
  ( cd "$APP" && sudo -u crm env PATH=/opt/node24/bin:/usr/bin:/bin \
      NEW_ENDPOINT="$ENDPOINT" NEW_BUCKET="$BUCKET" NEW_ACCESS_KEY="$ACCESS_KEY" NEW_SECRET_KEY="$SECRET_KEY" \
      bash -c 'set -a; . /opt/shotlin-crm/.env; set +a
               export S3_ENDPOINT="$NEW_ENDPOINT" S3_BUCKET="$NEW_BUCKET" S3_ACCESS_KEY="$NEW_ACCESS_KEY" S3_SECRET_KEY="$NEW_SECRET_KEY" S3_REGION=auto S3_FORCE_PATH_STYLE=true
               exec '"$NODE $TSX"' "$@"' _ "$@" )
}

echo
echo "1/4 Checking the bucket accepts files..."
run_crm scripts/r2-check.ts || { echo "Nothing was changed."; exit 1; }

echo
echo "2/4 Copying your existing WhatsApp images into the bucket (the originals stay on the server)..."
run_crm scripts/migrate-media-to-r2.ts || { echo "Some files did not copy. Nothing was switched over."; exit 1; }

echo
echo "3/4 Switching the CRM to R2..."
cp -a "$ENV_FILE" "$BACKUP"
chmod 600 "$BACKUP"
TMP="$(mktemp)"
grep -vE '^(S3_MODE|S3_ENDPOINT|S3_REGION|S3_BUCKET|S3_ACCESS_KEY|S3_SECRET_KEY|S3_FORCE_PATH_STYLE|S3_PROVIDER|STORAGE_LIMIT_GB)=' "$ENV_FILE" > "$TMP"
{
  printf 'S3_MODE=s3\n'
  printf 'S3_PROVIDER=r2\n'
  printf 'S3_ENDPOINT=%s\n' "$ENDPOINT"
  printf 'S3_REGION=auto\n'
  printf 'S3_BUCKET=%s\n' "$BUCKET"
  printf 'S3_ACCESS_KEY=%s\n' "$ACCESS_KEY"
  printf 'S3_SECRET_KEY=%s\n' "$SECRET_KEY"
  printf 'S3_FORCE_PATH_STYLE=true\n'
  printf 'STORAGE_LIMIT_GB=%s\n' "$LIMIT_GB"
} >> "$TMP"
install -o crm -g crm -m 600 "$TMP" "$ENV_FILE"
rm -f "$TMP"

echo
echo "4/4 Restarting the CRM..."
systemctl restart crm-web crm-worker
sleep 12
if systemctl is-active --quiet crm-web && systemctl is-active --quiet crm-worker \
   && curl -fsS -o /dev/null http://127.0.0.1:3100/api/health/ready; then
  echo
  echo "Done. R2 is on. Your previous settings were saved to: $BACKUP"
  echo "New WhatsApp images and files now go to R2."
else
  echo "The CRM did not come back healthy. Restoring your previous settings..."
  install -o crm -g crm -m 600 "$BACKUP" "$ENV_FILE"
  systemctl restart crm-web crm-worker
  echo "Restored. Nothing is lost."
  exit 1
fi
