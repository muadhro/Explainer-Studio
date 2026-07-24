# Deploying to the Droplet (explainerstudio.com)

One-time setup to get the app live at `https://explainerstudio.com` on the
DigitalOcean Droplet at `159.89.162.123`.

## 1. Point DNS at the Droplet

In the DigitalOcean dashboard, under your domain's **Domain records**, click
**Create a record** and add:

| Type | Hostname | Value            | TTL  |
| ---- | -------- | ---------------- | ---- |
| A    | @        | 159.89.162.123   | 3600 |
| A    | www      | 159.89.162.123   | 3600 |

DNS can take a few minutes to a few hours to propagate. You can move on to
the next steps while it does — the server setup doesn't depend on it, only
the HTTPS certificate step (5) does.

## 2. SSH into the Droplet

From the DigitalOcean dashboard, use the **Console** button on the Droplet's
page (works right in the browser, no local SSH setup needed), or from a
terminal:

```bash
ssh root@159.89.162.123
```

## 3. Run the setup script

```bash
# grab just the setup script first (repo isn't cloned yet)
curl -o setup.sh https://raw.githubusercontent.com/<you>/<repo>/main/deploy/setup.sh
sudo bash setup.sh https://github.com/<you>/<repo>.git
```

(Replace `<you>/<repo>` with your actual GitHub path once the repo exists.)

This installs Node.js, nginx, and certbot; clones the repo into
`/var/www/explainerstudio`; installs dependencies; builds the frontend; and
sets up the nginx site and the systemd service (but doesn't start it yet —
it needs `.env` first).

## 4. Create the production `.env`

```bash
sudo nano /var/www/explainerstudio/.env
```

Paste in the contents of `deploy/env.production.example` and fill in your
real values — copy your API keys straight from your local `.env`, they don't
need to change. Leave `FRONTEND_URL`/`BACKEND_URL` as `http://` for now
(fixed in step 6).

```bash
sudo chown www-data:www-data /var/www/explainerstudio/.env
sudo systemctl start explainer-backend
sudo systemctl status explainer-backend   # should show "active (running)"
```

At this point `http://explainerstudio.com` should load the app (once DNS
has propagated), just without HTTPS yet.

## 5. Get HTTPS (once DNS has propagated)

```bash
sudo certbot --nginx -d explainerstudio.com -d www.explainerstudio.com
```

Certbot edits the nginx config in place to add the SSL server block and an
http→https redirect, and sets up auto-renewal.

## 6. Switch the app to https:// and update Google

```bash
sudo nano /var/www/explainerstudio/.env
```

Change both `FRONTEND_URL` and `BACKEND_URL` to `https://explainerstudio.com`,
then:

```bash
sudo systemctl restart explainer-backend
```

Also update **Google Cloud Console → APIs & Services → Credentials** → your
OAuth client → Authorized redirect URIs: add
`https://explainerstudio.com/api/auth/google/callback` (keep the localhost
one too if you still want Google sign-in to work in local dev).

## Redeploying after code changes

```bash
ssh root@159.89.162.123
cd /var/www/explainerstudio
sudo -u www-data git pull
cd backend && sudo -u www-data npm install --omit=dev
cd ../frontend && sudo -u www-data npm install && sudo -u www-data npm run build
sudo systemctl restart explainer-backend
```

## Notes

- The backend runs as the `www-data` user via systemd — logs are at
  `sudo journalctl -u explainer-backend -f`.
- Generated videos/audio live on the Droplet's own disk at
  `/var/www/explainerstudio/videos/` — back this up periodically; it isn't
  replicated anywhere.
- PayPal stays on Sandbox (`PAYPAL_MODE=sandbox`) until you deliberately
  switch to Live credentials — see the earlier conversation about the
  sandbox currency mismatch that's still unresolved.
