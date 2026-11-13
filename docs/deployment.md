# Server installation

This document tells you how to install the system on a new server with Debian 13 or Ubuntu 24.04.
For deploys, backups, monitoring and restore, refer to [operations.md](operations.md).

Run the commands as `root`, unless the text tells you a different user. In the examples,
`hamta.example.se` is the host name of the site. `s3.hamta.example.se` is the host name of
storage. Replace them with your host names.

## Server layout

| Item | Location |
| --- | --- |
| Application (git checkout, built on the server) | `/opt/hamtning/app` |
| Web app releases. `current` is the live release. | `/var/www/hamtning/releases/`, `/var/www/hamtning/current` |
| Database | `/var/lib/hamtning/app.db` |
| Photos (Garage) | `/var/lib/garage/{meta,data}`. Configuration: `/etc/garage.toml`. |
| Settings | `/etc/hamtning/{api,backup}.env` |
| Services | `hamtning-api`, `garage`, `nginx` |
| Timers | `hamtning-backup` (each hour), `hamtning-restore-test` (each month) |
| Logs | `journalctl -u hamtning-api`, `/var/log/nginx/hamtning*.access.log` |

## Before you start

Make sure that you have these items:

- A VPS with a minimum of 2 GB RAM, and disk space for the photos. Some GB is sufficient at the
  start.
- A domain with two DNS names for the VPS: the site and storage. Each name must have an A record,
  and an AAAA record if the VPS has IPv6.
- An S3-compatible bucket at a different provider for the backups, for example Backblaze B2 or
  Hetzner Object Storage. You must have a key that can read and write the bucket.
- An email provider, for example Resend. You can add it later.

WARNING: Do not open the site to the public before email works. Without email, customers cannot
verify their requests.

## 1. Install the base system

1. Update the system and install the packages:

   ```bash
   apt update && apt full-upgrade -y
   ```

   ```bash
   apt install -y nginx certbot sqlite3 git curl restic ufw unattended-upgrades
   ```

2. Install Node.js 26:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
   ```

   ```bash
   apt install -y nodejs
   ```

3. Install the pnpm version from the `packageManager` field of `package.json`:

   ```bash
   npm install -g pnpm@12.6.0
   ```

4. Start the firewall:

   ```bash
   ufw allow OpenSSH && ufw allow "Nginx Full" && ufw enable
   ```

5. Use SSH keys. Set `PasswordAuthentication no` in `/etc/ssh/sshd_config`.

After this step, only SSH, HTTP and HTTPS are open from outside. The API (port 3000) and Garage
(ports 3900 to 3903) listen on `127.0.0.1` only.

## 2. Make the users and folders

```bash
adduser --system --group --home /opt/hamtning --shell /bin/bash hamtning
adduser --system --group --no-create-home garage
install -d -o root -g hamtning -m 0750 /etc/hamtning
install -d -o hamtning -g hamtning /var/www/hamtning /var/www/hamtning/releases /var/lib/hamtning
install -d -o garage -g garage -m 0750 /var/lib/garage /var/lib/garage/meta /var/lib/garage/data
install -d /var/www/letsencrypt
usermod -aG systemd-journal hamtning
```

The `hamtning` user must be in the group `systemd-journal`. Then `deploy.sh` can show the API log
when a deploy is not successful.

## 3. Install Garage

1. Find the latest 2.x release on <https://garagehq.deuxfleurs.fr/download/>. Use the
   `x86_64-unknown-linux-musl` build for a usual VPS.
2. Download the binary. The project was developed with version 2.4.1:

   ```bash
   curl -fLo /usr/local/bin/garage https://garagehq.deuxfleurs.fr/_releases/v2.4.1/x86_64-unknown-linux-musl/garage
   ```

3. Make the binary executable and examine the version:

   ```bash
   chmod +x /usr/local/bin/garage && garage --version
   ```

## 4. Install the application

1. Clone the repository as the `hamtning` user:

   ```bash
   sudo -iu hamtning git clone https://github.com/hydrarguru/furniture-pickup.git /opt/hamtning/app
   ```

2. Copy the settings template:

   ```bash
   cd /opt/hamtning/app && cp deploy/env/api.env.example /etc/hamtning/api.env
   ```

   ```bash
   chown root:hamtning /etc/hamtning/*.env && chmod 0640 /etc/hamtning/*.env
   ```

3. Edit `/etc/hamtning/api.env`. Give a value to each line with the text "FILL IN": the two host
   names and `SESSION_SECRET`. To make the secret, use `openssl rand -base64 48`.
4. Install the systemd units and the sudoers file:

   ```bash
   cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
   ```

   ```bash
   install -m 0440 deploy/sudoers/hamtning /etc/sudoers.d/hamtning && visudo -cf /etc/sudoers.d/hamtning
   ```

   ```bash
   systemctl daemon-reload
   ```

5. Install the dependencies. `init.sh` in the next step uses scripts of the application:

   ```bash
   sudo -iu hamtning bash -c 'cd /opt/hamtning/app && pnpm install --frozen-lockfile'
   ```

6. Prepare Garage. The script makes `/etc/garage.toml`, the bucket, and the storage key of the API:

   ```bash
   deploy/garage/init.sh
   ```

7. Enable the API service and do the first deploy:

   ```bash
   systemctl enable hamtning-api
   ```

   ```bash
   sudo -iu hamtning /opt/hamtning/app/deploy/deploy.sh origin/main
   ```

8. Make sure that `deploy.sh` shows "healthy" at the end. If it does not, it shows the API log.
9. Make the first employee with the role `admin`. The tool shows the password one time only:

   ```bash
   sudo -iu hamtning bash -c 'cd /opt/hamtning/app/apps/api && node --env-file=/etc/hamtning/api.env --import tsx scripts/employee.ts add username "Your Name" --admin'
   ```

## 5. Install HTTPS and nginx

1. Make a temporary site on port 80 for the Let's Encrypt challenge:

   ```bash
   cat >/etc/nginx/sites-enabled/hamtning-acme.conf <<'EOF'
   server {
       listen 80;
       server_name hamta.example.se s3.hamta.example.se;
       location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
   }
   EOF
   ```

2. Remove the default site and reload nginx:

   ```bash
   rm -f /etc/nginx/sites-enabled/default && systemctl reload nginx
   ```

3. Make the certificate with certbot:

   ```bash
   certbot certonly --webroot -w /var/www/letsencrypt -d hamta.example.se -d s3.hamta.example.se --deploy-hook "systemctl reload nginx"
   ```

4. Remove the temporary site:

   ```bash
   rm /etc/nginx/sites-enabled/hamtning-acme.conf
   ```

5. Make the real configuration with your host names:

   ```bash
   cd /opt/hamtning/app && APP_DOMAIN=hamta.example.se S3_DOMAIN=s3.hamta.example.se deploy/nginx/render.sh
   ```

6. Enable the site, examine the configuration, and reload nginx:

   ```bash
   ln -s /etc/nginx/sites-available/hamtning.conf /etc/nginx/sites-enabled/
   ```

   ```bash
   nginx -t && systemctl reload nginx
   ```

The nginx configuration does these tasks:

- It serves the web app with a strict Content-Security-Policy and HSTS.
- It sends `/api/` to the API with the header `X-Real-IP`. The rate limits of the API use this
  header.
- It adds rate limits for form submissions, photo uploads and login.
- It does not buffer the live-update stream of the admin panel.
- It serves storage on the second host name.
- It replaces the tokens in the access log with `[token]`.

The certbot timer renews the certificate automatically and reloads nginx.

## 6. Configure email

The API sends email through the HTTPS API of [Resend](https://resend.com). No SMTP port is
necessary.

1. In Resend, go to **Domains → Add domain**.
2. Add the SPF and DKIM records that Resend shows to the DNS of the domain.
3. Add a DMARC record, for example `_dmarc` TXT `v=DMARC1; p=none;`.
4. Wait until Resend shows the domain as verified.
5. Under **API Keys**, make a key with **Sending access** for that domain only.
6. In `/etc/hamtning/api.env`, set `MAILER=resend`, `RESEND_API_KEY` and `MAIL_FROM`. `MAIL_FROM`
   must use the verified domain.
7. Restart the API:

   ```bash
   systemctl restart hamtning-api
   ```

8. Make sure that the log shows `Mail: resend, sending as ...`.
9. Send a test request on the site. Make sure that the email arrives and that its link works.
   The **Emails** page in Resend shows each email and its delivery status.

If Resend refuses an email, the API log shows the reason from Resend.

To use a different provider, set `MAILER=smtp` with the `SMTP_*` variables and `MAIL_FROM`. Use
port 587 with STARTTLS, or port 465 with `SMTP_SECURE=true`. Make sure that the log shows
`Mail: smtp ready`. Refer to [configuration.md](configuration.md#email).

## 7. Configure backups and monitoring

Refer to [operations.md](operations.md#backups) and [operations.md](operations.md#monitoring).
Then do the [launch checklist](operations.md#launch-checklist).
