# Server setup and operations

How to put the pickup app on a VPS running **Debian 13 or Ubuntu 24.04**, and how to run it
afterwards: deploys, backups, restores and monitoring. Commands are run as root unless they say
otherwise. `hamta.example.se` and `s3.hamta.example.se` stand for your two host names.

| What                                    | Where                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| App (git checkout, built on the server) | `/opt/hamtning/app`                                                                                     |
| Web app releases, `current` is live     | `/var/www/hamtning/releases/`, `/var/www/hamtning/current`                                              |
| Database                                | `/var/lib/hamtning/app.db`                                                                              |
| Photos (Garage)                         | `/var/lib/garage/{meta,data}`, config `/etc/garage.toml`                                                |
| Settings                                | `/etc/hamtning/{api,web,backup}.env`                                                                    |
| Services                                | `hamtning-api`, `garage`, `nginx`; timers `hamtning-backup` (hourly), `hamtning-restore-test` (monthly) |
| Logs                                    | `journalctl -u hamtning-api`, `/var/log/nginx/hamtning*.access.log` (tokens redacted)                   |

## Before you start

- A VPS with at least 2 GB RAM and enough disk for the photos (a few GB to start).
- A domain, with two DNS names pointing at the VPS (A and, if it has IPv6, AAAA records):
  the site (`hamta.example.se`) and photo storage (`s3.hamta.example.se`).
- An S3-compatible bucket **at another provider** for the backups (Backblaze B2, Hetzner Object
  Storage, Scaleway, AWS...), with an access key that can read and write it.
- Later, for email: an email provider with SMTP (Resend, Postmark, Amazon SES, Brevo...). Until
  then the site runs with emails written to the log only, which means customers can't confirm
  their requests. Don't open the site to the public before email works.

## 1. Base system

```sh
apt update && apt full-upgrade -y
apt install -y nginx certbot sqlite3 git curl restic ufw unattended-upgrades
# Node.js 26 (NodeSource) and the pnpm version the repo pins (package.json "packageManager")
curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
apt install -y nodejs
npm install -g pnpm@12.6.0

ufw allow OpenSSH && ufw allow "Nginx Full" && ufw enable
```

Only SSH, HTTP and HTTPS are reachable from outside. The API (port 3000) and Garage (3900-3903)
listen on 127.0.0.1 only. Use SSH keys and turn off password login (`PasswordAuthentication no`
in `/etc/ssh/sshd_config`).

## 2. Users and folders

```sh
adduser --system --group --home /opt/hamtning --shell /bin/bash hamtning
adduser --system --group --no-create-home garage
install -d -o root -g hamtning -m 0750 /etc/hamtning
install -d -o hamtning -g hamtning /var/www/hamtning /var/www/hamtning/releases /var/lib/hamtning
install -d -o garage -g garage -m 0750 /var/lib/garage /var/lib/garage/meta /var/lib/garage/data
install -d /var/www/letsencrypt
usermod -aG systemd-journal hamtning   # deploy.sh shows the API log when a deploy fails
```

## 3. Garage (photo storage)

Install the binary from <https://garagehq.deuxfleurs.fr/download/>: the latest 2.x release, the
`x86_64-unknown-linux-musl` build for a normal VPS. Copy its link from that page. The app was
developed against 2.4.1, so for that version:

```sh
curl -fLo /usr/local/bin/garage \
  https://garagehq.deuxfleurs.fr/_releases/v2.4.1/x86_64-unknown-linux-musl/garage
chmod +x /usr/local/bin/garage && garage --version
```

## 4. The app

```sh
sudo -iu hamtning git clone https://github.com/hydrarguru/furniture-pickup.git /opt/hamtning/app
cd /opt/hamtning/app
cp deploy/env/api.env.example /etc/hamtning/api.env
chown root:hamtning /etc/hamtning/*.env && chmod 0640 /etc/hamtning/*.env
```

Edit `/etc/hamtning/api.env`: every line marked **FILL IN**
(the two host names and a `SESSION_SECRET` from `openssl rand -base64 48`).

Install the services, set up Garage, and deploy for the first time:

```sh
cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
install -m 0440 deploy/sudoers/hamtning /etc/sudoers.d/hamtning && visudo -cf /etc/sudoers.d/hamtning
systemctl daemon-reload

# Dependencies first: init.sh uses the app's scripts to set the bucket's CORS rule.
sudo -iu hamtning bash -c 'cd /opt/hamtning/app && pnpm install --frozen-lockfile'
deploy/garage/init.sh            # creates /etc/garage.toml, the bucket and the API's storage key
systemctl enable hamtning-api
sudo -iu hamtning /opt/hamtning/app/deploy/deploy.sh origin/main
```

The API runs the database migrations itself on start. `deploy.sh` ends with "healthy" when the
API answers; if not, it prints the API's log. Before the restart it lists the migration files the
new version will apply, and afterwards prints `Migration <file>: applied` or `FAILED` for each.

Create the first admin (the password is printed once):

```sh
sudo -iu hamtning bash -c 'cd /opt/hamtning/app/apps/api && \
  node --env-file=/etc/hamtning/api.env --import tsx scripts/employee.ts add username "Your Name" --admin'
```

## 5. HTTPS and nginx

Get the certificate first, with a temporary port-80-only site for the Let's Encrypt check:

```sh
cat >/etc/nginx/sites-enabled/hamtning-acme.conf <<'EOF'
server {
    listen 80;
    server_name hamta.example.se s3.hamta.example.se;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
}
EOF
rm -f /etc/nginx/sites-enabled/default && systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt \
  -d hamta.example.se -d s3.hamta.example.se --deploy-hook "systemctl reload nginx"
rm /etc/nginx/sites-enabled/hamtning-acme.conf
```

Then the real configuration:

```sh
cd /opt/hamtning/app
APP_DOMAIN=hamta.gladjenssecondhand.se S3_DOMAIN=s3.hamta.gladjenssecondhand.se deploy/nginx/render.sh
ln -s /etc/nginx/sites-available/hamtning.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

`render.sh` fills in the host names. The config:

- serves the web app, with a strict Content-Security-Policy and HSTS
- passes `/api/` to the API, including the client IP the API's rate limits rely on
- adds nginx rate limits on form submissions, photo uploads and login
- keeps the admin's live-update stream unbuffered
- serves photo storage on the second host name
- writes access logs with the status-link tokens replaced by `[token]`

Renewal is automatic (certbot's timer) and reloads nginx.

The same config can be tested on a Mac before going live: `pnpm build && deploy/nginx/test-local.sh`
(needs nginx and the dev Garage running). It runs about 20 checks against a local copy.

## 6. Backups

Every hour the database and the photos are copied, encrypted, to the off-site bucket with
[restic](https://restic.net). Backups are kept for at most 30 days, like the data itself: every
hourly backup for two days, then one per day. The database is copied with SQLite's online
backup and Garage's metadata from a consistent snapshot, so nothing has to stop.

```sh
cp deploy/env/backup.env.example /etc/hamtning/backup.env && chmod 0600 /etc/hamtning/backup.env
openssl rand -base64 48 >/etc/hamtning/restic-password && chmod 0600 /etc/hamtning/restic-password
```

Fill in `RESTIC_REPOSITORY` and the bucket's keys in `backup.env`. **Store the restic password
somewhere outside the server too** (the store's password manager): without it, the backups can't
be read, also not by you.

```sh
systemctl start hamtning-backup && journalctl -u hamtning-backup -n 5   # first run: "Backup done"
systemctl start hamtning-restore-test && journalctl -u hamtning-restore-test -n 5
systemctl enable --now hamtning-backup.timer hamtning-restore-test.timer
```

The restore test runs on the 1st of every month. It restores the latest backup to a temporary
folder and starts a second, private Garage on it. It then checks the database and that every
photo it refers to can be read back, without touching the live system. The whole chain was tested
end to end on a Mac (`deploy/backup/test-local.sh`): back up, delete the live system, restore,
verify.

## 7. Monitoring

Use [Uptime Kuma](https://github.com/louislam/uptime-kuma) on **another** machine (or any uptime
service), so it still works when the VPS is down:

- **HTTP monitor** on `https://hamta.example.se/api/health`, expecting status 200. The API answers
  503 if it can't reach its database or the photo storage.
- **HTTP monitor** on `https://hamta.example.se/` with certificate-expiry notification.
- **Push monitors** for the backups (heartbeat interval 2 hours) and the restore test (32 days).
  Put their URLs in `HEARTBEAT_URL` and `RESTORE_TEST_HEARTBEAT_URL` in `backup.env`; the scripts
  call them only after a successful run.

Useful commands:

```sh
systemctl status hamtning-api garage nginx
journalctl -u hamtning-api -f            # API log (no tokens, no personal data except in errors)
systemctl list-timers 'hamtning-*'        # when backups and the restore test last ran
```

## 8. Deploys

Deploys run from GitHub: **Actions → Deploy → Run workflow**. It runs the CI checks, then
`deploy/deploy.sh` on the server over SSH. Setup:

```sh
sudo -iu hamtning ssh-keygen -t ed25519 -N "" -f ~/.ssh/github-deploy   # on the server
sudo -iu hamtning bash -c 'cat ~/.ssh/github-deploy.pub >> ~/.ssh/authorized_keys'
```

In the GitHub repository, add an environment `production`. Give it the secrets
`DEPLOY_SSH_KEY` (the private key `~hamtning/.ssh/github-deploy`, then delete it from the server),
`DEPLOY_HOST`, and `DEPLOY_KNOWN_HOSTS` (the output of `ssh-keyscan <server>` from your own
machine). The server also needs to read the repository: a read-only deploy key, or a public
repository.

`deploy.sh` builds the new version while the old one keeps running. It then saves a copy of the
database (`/var/lib/hamtning/pre-deploy-*.db`, the last five) and switches the web app over in
one step. Finally it restarts the API and waits for it to be healthy.

**Rolling back:** run the workflow (or `deploy.sh`) with the previous commit. If the bad version
changed the database (a migration), also put the pre-deploy copy back. Stop the API, replace
`app.db` with the copy and remove `app.db-wal` and `app.db-shm`, then start the API.

## 9. Email

Mail goes out through [Resend](https://resend.com), over its HTTPS API (no SMTP port needed).

1. In Resend, go to **Domains → Add domain** and add the DNS records it shows (SPF and DKIM) to
   the domain. Add a DMARC record too, e.g. `_dmarc` TXT `v=DMARC1; p=none;`. Wait until Resend
   shows the domain as verified.
2. Under **API Keys**, create a key with **Sending access**, limited to that domain.
3. In `/etc/hamtning/api.env`, set `MAILER=resend`, `RESEND_API_KEY` and `MAIL_FROM` (an address
   on the verified domain, e.g. `Butiken <noreply@hamta.example.se>`).
4. `systemctl restart hamtning-api` and check the log for `Mail: resend, sending as ...`. A
   rejected mail is logged with Resend's reason (e.g. an unverified domain).
4. Submit a test request on the site and check that the confirmation email arrives and that its
   link works. Resend's **Emails** page shows each mail and whether it was delivered.

Another provider works through SMTP instead: set `MAILER=smtp` with the `SMTP_*` and `MAIL_FROM`
lines, using port 587 (STARTTLS, required) or 465 with `SMTP_SECURE=true`, and look for
`Mail: smtp ready` in the log.

## 10. Restoring after a disaster

On a fresh server, follow steps 1–5 above, but don't run `deploy/garage/init.sh` or create an
admin; both come from the backup. Then:

```sh
cd /opt/hamtning/app
cp /path/to/your/saved/restic-password /etc/hamtning/restic-password   # from the password manager
cp deploy/env/backup.env.example /etc/hamtning/backup.env               # fill in as before
cp deploy/garage/garage.toml /etc/garage.toml                           # then replace the three __SECRETS__
systemctl stop hamtning-api garage
set -a && . /etc/hamtning/backup.env && set +a
deploy/backup/restore.sh /var/tmp/restore            # or: restore.sh /var/tmp/restore <snapshot-id>
cp /var/tmp/restore/var/backups/hamtning/app.db /var/lib/hamtning/app.db
rm -rf /var/lib/garage/meta /var/lib/garage/data
cp -a /var/tmp/restore/var/lib/garage/meta /var/tmp/restore/var/lib/garage/data /var/lib/garage/
rm -f /var/lib/garage/meta/peer_list
chown -R hamtning:hamtning /var/lib/hamtning && chown -R garage:garage /var/lib/garage
systemctl start garage hamtning-api
```

The storage key in `api.env` must be the old one (it's in the restored Garage). If you no longer
have it, create a new key with `garage key create`, allow it on the bucket and put it in
`api.env`. To restore only the database on a running server (e.g. after a bad change), use the
same `restore.sh`, then copy just `app.db` back with the API stopped.

## Launch checklist

- [ ] Store details: phone number and email in `packages/shared/src/store.ts` (placeholders now).
- [ ] Privacy page text reviewed and approved by the store; then remove its "Utkast" banner.
- [ ] `MAILER=smtp` working (section 9). The API warns at start-up while it's `console`.
- [ ] First backup done, restore test passed, both timers enabled.
- [ ] Uptime monitors set up and alerting someone.
- [ ] A full test on the live site from a phone: request with an iPhone (HEIC) photo, the
      confirmation email, accept in the admin, the status page updates and the status email arrives.
