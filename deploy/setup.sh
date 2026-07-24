#!/usr/bin/env bash
# One-time server setup for Explainer Studio on a fresh Ubuntu 24.04 Droplet.
# Run as root: sudo bash deploy/setup.sh <git-repo-url>
#
# This script installs Node/nginx/certbot, clones the repo, installs
# dependencies, builds the frontend, and wires up the systemd service +
# nginx site. It stops before starting the backend so you can create the
# production .env file first (see deploy/env.production.example).

set -euo pipefail

REPO_URL="${1:-}"
APP_DIR=/var/www/explainerstudio
DOMAIN=explainerstudio.org

if [ -z "$REPO_URL" ]; then
  echo "Usage: sudo bash deploy/setup.sh <git-repo-url>"
  exit 1
fi

# Fully non-interactive apt: DigitalOcean's droplet images pre-modify
# /etc/ssh/sshd_config, which otherwise makes `apt upgrade` stop and prompt
# to merge config files. --force-confdef/--force-confold tells dpkg to keep
# the existing (DigitalOcean-tuned) config automatically instead of asking.
export DEBIAN_FRONTEND=noninteractive
APT_OPTS=(-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

echo "==> Updating packages"
apt-get update -y
apt-get upgrade -y "${APT_OPTS[@]}"

echo "==> Installing Node.js 22 LTS"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "==> Installing nginx, certbot, git"
apt-get install -y nginx certbot python3-certbot-nginx git

echo "==> Cloning repository into $APP_DIR"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "    (already cloned, pulling latest instead)"
  git -C "$APP_DIR" pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Installing backend dependencies"
cd "$APP_DIR/backend"
npm install --omit=dev

echo "==> Installing frontend dependencies and building for production"
cd "$APP_DIR/frontend"
npm install
npm run build

echo "==> Setting ownership so the app (running as www-data) can write videos/audio/avatars"
mkdir -p "$APP_DIR/videos/audio" "$APP_DIR/videos/generated" "$APP_DIR/videos/avatars"
chown -R www-data:www-data "$APP_DIR"

echo "==> Installing nginx site config (HTTP-only bootstrap — no certificate yet)"
cp "$APP_DIR/deploy/nginx-bootstrap.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Installing systemd service (not starting yet)"
cp "$APP_DIR/deploy/explainer-backend.service" /etc/systemd/system/explainer-backend.service
systemctl daemon-reload
systemctl enable explainer-backend

cat <<'EOF'

==============================================================
Setup complete. Two things left before the app is actually live:

1. Create the production .env file:
     sudo nano /var/www/explainerstudio/.env
   Copy the template from deploy/env.production.example and fill in
   your real values (Supabase, Claude, ElevenLabs, PayPal, Google).
   Then:  sudo chown www-data:www-data /var/www/explainerstudio/.env

2. Point your domain at this server (DNS A record -> this Droplet's
   IP), then once DNS has propagated, get HTTPS — see deploy/DEPLOY.md
   step 5 for the full certbot + config-swap steps.

Once .env exists, start the backend:
     sudo systemctl start explainer-backend
     sudo systemctl status explainer-backend
==============================================================
EOF
