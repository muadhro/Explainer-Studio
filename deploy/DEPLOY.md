# Deploying to the Droplet (explainerstudio.org)

One-time setup to get the app live at `https://explainerstudio.org` on the
DigitalOcean Droplet at `159.89.162.123`.

## 1. Point DNS at the Droplet

DNS is hosted at the registrar (GoDaddy) directly — no DigitalOcean
nameserver delegation needed. In GoDaddy's **DNS** / **Manage DNS** page for
the domain, under **DNS Records**, add:

| Type | Name | Value            | TTL  |
| ---- | ---- | ---------------- | ---- |
| A    | @    | 159.89.162.123   | 600  |
| A    | www  | 159.89.162.123   | 600  |

Remove any pre-existing parking A/CNAME records GoDaddy added by default so
they don't conflict.

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

At this point `http://explainerstudio.org` should load the app (once DNS
has propagated), just without HTTPS yet.

## 5. Get HTTPS (once DNS has propagated)

We use `certbot certonly` to just obtain the certificate files, then swap in
the full HTTPS nginx config ourselves — `certbot --nginx`'s automatic config
editor can fail to detect the server block on some setups (it did on this
one), so this sidesteps that entirely:

```bash
sudo certbot certonly --nginx -d explainerstudio.org -d www.explainerstudio.org
```

This obtains the certificate (saved to `/etc/letsencrypt/live/explainerstudio.org/`)
without touching the nginx config. It also registers a scheduled renewal
task automatically. Then swap in the HTTPS-ready config:

```bash
sudo cp /var/www/explainerstudio/deploy/nginx.conf /etc/nginx/sites-available/explainerstudio.org
sudo nginx -t && sudo systemctl reload nginx
```

`deploy/nginx.conf` (as opposed to `deploy/nginx-bootstrap.conf`, which
`setup.sh` installs initially) includes both the HTTPS server block and an
http→https redirect.

## 6. Switch the app to https:// and update Google

```bash
sudo nano /var/www/explainerstudio/.env
```

Change both `FRONTEND_URL` and `BACKEND_URL` to `https://explainerstudio.org`,
then:

```bash
sudo systemctl restart explainer-backend
```

Also update **Google Cloud Console → APIs & Services → Credentials** → your
OAuth client → Authorized redirect URIs: add
`https://explainerstudio.org/api/auth/google/callback` (keep the localhost
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

### One-time: install the Whiteboard Animation handwriting font

The "Whiteboard Animation" style renders titles/labels in a bundled font
(Caveat, `backend/assets/fonts/Caveat-Variable.ttf`) that has to be
installed system-wide so `sharp`/librsvg can resolve it when rasterizing
frames — it isn't picked up automatically from the repo checkout. Run this
once (and again only if the font file itself changes):

```bash
sudo mkdir -p /usr/share/fonts/truetype/explainerstudio
sudo cp /var/www/explainerstudio/backend/assets/fonts/Caveat-Variable.ttf /usr/share/fonts/truetype/explainerstudio/
sudo fc-cache -f
fc-list | grep -i caveat   # sanity check it's registered
```

### Site access is password-walled (HTTP Basic Auth)

The live site currently requires a shared username/password before anyone
can browse it (`/api/` and `/avatars/` are exempt, so PayPal webhooks and
the Google OAuth callback still work without a password prompt). This is
enforced in `deploy/nginx.conf`'s main `location /` block via
`auth_basic`/`auth_basic_user_file`, pointing at `/etc/nginx/.htpasswd` on
the Droplet — that file is **not** in the repo (credentials shouldn't be
committed). To add/change a user:

```bash
sudo htpasswd -b /etc/nginx/.htpasswd <username> '<password>'   # add or update a user
sudo htpasswd -D /etc/nginx/.htpasswd <username>                 # remove a user
sudo nginx -t && sudo systemctl reload nginx
```

To lift the restriction entirely, remove the `auth_basic`/`auth_basic_user_file`
lines from the `location /` block in both `deploy/nginx.conf` and
`/etc/nginx/sites-available/explainerstudio.org`, then `nginx -t && systemctl reload nginx`.

## Notes

- The backend runs as the `www-data` user via systemd — logs are at
  `sudo journalctl -u explainer-backend -f`.
- Generated videos/audio live on the Droplet's own disk at
  `/var/www/explainerstudio/videos/` — back this up periodically; it isn't
  replicated anywhere.
- PayPal stays on Sandbox (`PAYPAL_MODE=sandbox`) until you deliberately
  switch to Live credentials — see the earlier conversation about the
  sandbox currency mismatch that's still unresolved.
