# Deploying Solaris to a VPS

This guide takes a fresh Ubuntu/Debian VPS to a public, HTTPS-served Solaris
instance using `docker-compose.prod.yml`. It's a single-server deployment —
SQLite is the database, so this isn't meant to be horizontally scaled across
multiple app containers.

## 1. Prerequisites

- A VPS (1 vCPU / 2 GB RAM minimum; more if you'll run local models via
  Cookbook). Any provider works — DigitalOcean, Hetzner, Linode, etc.
- A domain name, with an **A record pointing at the VPS's public IP**.
  Caddy (the reverse proxy) requests a Let's Encrypt certificate for this
  domain on first boot — that fails if DNS isn't already pointing at the
  server, so set this up first and let it propagate (a few minutes to a
  few hours) before continuing.
- SSH access to the VPS as a non-root user with `sudo`.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker   # or log out/in
docker --version
docker compose version
```

## 3. Firewall

Only 22 (SSH), 80, and 443 need to be reachable from the internet. Every
other service (ChromaDB, SearXNG, ntfy, the app itself) stays bound to
`127.0.0.1` inside the compose file — Caddy is the only public entry point.

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 4. Clone and configure

```bash
git clone https://github.com/Myerss00/Solaris.git
cd Solaris
cp .env.example .env
nano .env   # or vim/your editor of choice
```

Fill in at least these in `.env` — everything else has a safe default:

| Variable | Required for | Notes |
|---|---|---|
| `DOMAIN` | Caddy/TLS | e.g. `solaris.example.com` — must already resolve in DNS |
| `ADMIN_EMAIL` | Caddy/TLS | Let's Encrypt expiry/abuse contact |
| `SOLARIS_ADMIN_PASSWORD` | First login | Pre-seeds the admin account; otherwise it's generated and printed in the logs on first boot |
| `ADMIN_API_KEY` | `/impact` admin endpoint | Long random value — `openssl rand -hex 32` |
| `HUGGINGFACE_TOKEN` | `/generate` image generation | Free token from https://huggingface.co/settings/tokens — without it, `/generate` shows a friendly "still connecting" placeholder instead of generating |
| `ADSENSE_CLIENT_ID` / `ADSENSE_SLOT_ID` | Ad-gated HD/4K tiers | Only cosmetic until you wire a real ad network into the modal |

`AUTH_ENABLED` and `SECURE_COOKIES` are forced on in
`docker-compose.prod.yml` regardless of what's in `.env` — there's no
"auth optional" mode for a public deployment.

## 5. Bring up the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build takes a few minutes (installs Python deps + the Cookbook
toolchain). Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

You're looking for `Application startup complete.` from `solaris` and
Caddy logging that it obtained a certificate for `DOMAIN`.

## 6. Verify

```bash
curl -fsS https://$DOMAIN/api/health
```

Then open `https://your-domain/` in a browser — you should see the
Solaris landing page. `/app` is the authenticated chat workspace (log in
with the admin account); `/generate` and `/impact` are public.

If the cert didn't issue: confirm DNS has propagated (`dig +short
$DOMAIN`) and that ports 80/443 are actually reachable from the internet
(not blocked by a cloud-provider security group in addition to ufw).

## 7. First admin login

If you didn't set `SOLARIS_ADMIN_PASSWORD`, find the generated one in the
logs:

```bash
docker compose -f docker-compose.prod.yml logs solaris | grep -i "admin password"
```

Log in at `https://your-domain/login`, then change the password from the
admin settings.

## 8. Updating

```bash
cd Solaris
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Existing data (SQLite DB, uploads, auth) lives in `./data` on the host
and isn't touched by a rebuild.

## 9. Backups

Everything that matters is under `./data`:

```bash
tar czf solaris-backup-$(date +%F).tar.gz data/
```

Put that on a cron job and copy the archive off the VPS (e.g. to S3/B2 or
just `scp` it somewhere else). The SQLite DB (`data/app.db`) is the source
of truth for sessions, memories, the `/impact` stats/projects/feed, and
auth — losing it loses everything.

## 10. Logs and troubleshooting

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f solaris
docker compose -f docker-compose.prod.yml logs -f caddy
```

Common issues:
- **502 from Caddy** — `solaris` container isn't healthy yet or crashed;
  check `logs solaris`.
- **Cert not issuing** — DNS not pointing at this server yet, or 80/443
  blocked upstream of ufw (cloud firewall/security group).
- **`/generate` always shows the placeholder** — `HUGGINGFACE_TOKEN` isn't
  set, or HuggingFace rate-limited the free tier; check `logs solaris` for
  a `HuggingFace generation failed` warning.
