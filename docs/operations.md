# Operations

This document tells you how to deploy, roll back, back up, monitor and restore the system on the
server. For the first installation, refer to [deployment.md](deployment.md).

## Deploys

The workflow [deploy.yml](../.github/workflows/deploy.yml) deploys each push to `main`
automatically. It first runs the CI checks. Then it connects to the server with SSH and runs
`deploy/deploy.sh` with the commit.

WARNING: Each push to `main` goes to production. Do not push to `main` to do a test of a change.
Use a branch and a pull request.

You can also start a deploy manually: **Actions → Deploy → Run workflow**. Only one deploy runs at
a time.

### What deploy.sh does

[deploy.sh](../deploy/deploy.sh) runs as the `hamtning` user:

1. It checks out the commit and builds it. The live site continues to run.
2. It shows the migration files that the new version will apply.
3. It makes a copy of the database: `/var/lib/hamtning/pre-deploy-*.db`. It keeps the last 5
   copies.
4. It copies the assets of the previous web release into the new release. Visitors with an old
   page can then load the parts that they did not load yet.
5. It changes the `current` link to the new web release in one step.
6. It restarts the API. The API applies the migrations when it starts.
7. It shows `Migration <file>: applied` or `Migration <file>: FAILED` for each migration.
8. It waits until `/api/health` answers. Then it shows `Deployed <commit>: healthy`. If the API
   does not become healthy, the script shows the API log.

### Configure the deploy workflow

1. On the server, make an SSH key for GitHub:

   ```bash
   sudo -iu hamtning ssh-keygen -t ed25519 -N "" -f ~/.ssh/github-deploy
   ```

   ```bash
   sudo -iu hamtning bash -c 'cat ~/.ssh/github-deploy.pub >> ~/.ssh/authorized_keys'
   ```

2. In the GitHub repository, add the environment `production`.
3. Add these secrets to the environment:
   - `DEPLOY_SSH_KEY`: the private key `~hamtning/.ssh/github-deploy`
   - `DEPLOY_HOST`: the address of the server
   - `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan <server>`. Run it on your own computer.
4. Delete the private key from the server.
5. Make sure that the server can read the repository. Use a read-only deploy key, or a public
   repository.

### Roll back

1. Run the deploy workflow, or `deploy.sh`, with the previous commit.
2. If the bad version applied a migration, also restore the database copy:
   1. Stop the API: `systemctl stop hamtning-api`.
   2. Replace `/var/lib/hamtning/app.db` with the applicable `pre-deploy-*.db` copy.
   3. Delete `app.db-wal` and `app.db-shm`.
   4. Start the API: `systemctl start hamtning-api`.

CAUTION: A database copy does not contain the requests that customers sent after the deploy. Only
restore it if the migration damaged the data.

## Employee accounts on the server

Run the employee tool with the settings file of the server. Do not use `pnpm` on the server for
this tool:

```bash
sudo -iu hamtning bash -c 'cd /opt/hamtning/app/apps/api && node --env-file=/etc/hamtning/api.env --import tsx scripts/employee.ts list'
```

Replace `list` with a different command. Refer to
[development.md](development.md#employee-accounts) for all commands. Give a new password to the
employee personally or through a different safe channel.

## Backups

Each hour, the timer `hamtning-backup` copies the database and the photos to the backup bucket.
restic encrypts the data before it leaves the server. The database copy uses the SQLite online
backup. The Garage copy uses a consistent snapshot of the metadata. Thus, no service stops.

restic keeps each hourly backup for 2 days, and then one backup for each day. It keeps no backup
for more than 30 days. This agrees with the retention of the data. Thus, a deletion is also
permanent in the backups after 30 days.

### Configure backups

1. Copy the template and make the password:

   ```bash
   cp deploy/env/backup.env.example /etc/hamtning/backup.env && chmod 0600 /etc/hamtning/backup.env
   ```

   ```bash
   openssl rand -base64 48 >/etc/hamtning/restic-password && chmod 0600 /etc/hamtning/restic-password
   ```

2. In `backup.env`, set `RESTIC_REPOSITORY` and the keys of the bucket.

   WARNING: Keep a copy of the restic password outside the server, for example in the password
   manager of the store. Without the password, nobody can read the backups.

3. Do the first backup and examine the log. The log must show "Backup done":

   ```bash
   systemctl start hamtning-backup && journalctl -u hamtning-backup -n 5
   ```

4. Do the first restore test and examine the log:

   ```bash
   systemctl start hamtning-restore-test && journalctl -u hamtning-restore-test -n 5
   ```

5. Enable the two timers:

   ```bash
   systemctl enable --now hamtning-backup.timer hamtning-restore-test.timer
   ```

### Monthly restore test

The timer `hamtning-restore-test` runs on the first day of each month
([restore-test.sh](../deploy/backup/restore-test.sh)). The test restores the latest backup to a
temporary folder. It starts a second, private Garage on that folder. Then it examines the database
and makes sure that it can read each photo that the database refers to. The test does not touch
the live system.

## Monitoring

Use [Uptime Kuma](https://github.com/louislam/uptime-kuma), or a different uptime service, on a
different machine. Then the monitoring works when the server is down.

| Monitor | Configuration |
| --- | --- |
| HTTP | `https://hamta.example.se/api/health` must return status 200. The API returns 503 if it cannot connect to the database or storage. |
| HTTP | `https://hamta.example.se/`, with a notice before the certificate expires |
| Push, for the backups | Heartbeat interval: 2 hours. Put the URL in `HEARTBEAT_URL` in `backup.env`. |
| Push, for the restore test | Heartbeat interval: 32 days. Put the URL in `RESTORE_TEST_HEARTBEAT_URL` in `backup.env`. |

The scripts call the push URLs only after a successful run.

Commands to examine the server:

| Command | Result |
| --- | --- |
| `systemctl status hamtning-api garage nginx` | The status of the services |
| `journalctl -u hamtning-api -f` | The API log. It contains no tokens and no personal data, except in errors. |
| `systemctl list-timers 'hamtning-*'` | The time of the last and the next backup and restore test |

## Restore after a disaster

Use this procedure on a new server after the loss of the old server.

1. Do steps 1 to 5 of [deployment.md](deployment.md). Do not run `deploy/garage/init.sh` and do
   not make an employee. The backup contains the Garage data and the employees.
2. Put the restic password from the password manager on the server:

   ```bash
   cd /opt/hamtning/app && cp /path/to/your/saved/restic-password /etc/hamtning/restic-password
   ```

3. Copy the backup template and give it the same values as before:

   ```bash
   cp deploy/env/backup.env.example /etc/hamtning/backup.env
   ```

4. Copy the Garage template. Then replace the three `__SECRETS__` values:

   ```bash
   cp deploy/garage/garage.toml /etc/garage.toml
   ```

5. Stop the services and load the backup settings:

   ```bash
   systemctl stop hamtning-api garage
   ```

   ```bash
   set -a && . /etc/hamtning/backup.env && set +a
   ```

6. Restore the latest backup to a temporary folder. To use a different backup, add its snapshot
   ID after the folder:

   ```bash
   deploy/backup/restore.sh /var/tmp/restore
   ```

7. Put the database and the Garage data in their locations:

   ```bash
   cp /var/tmp/restore/var/backups/hamtning/app.db /var/lib/hamtning/app.db
   ```

   ```bash
   rm -rf /var/lib/garage/meta /var/lib/garage/data
   ```

   ```bash
   cp -a /var/tmp/restore/var/lib/garage/meta /var/tmp/restore/var/lib/garage/data /var/lib/garage/
   ```

   ```bash
   rm -f /var/lib/garage/meta/peer_list
   ```

8. Set the owners and start the services:

   ```bash
   chown -R hamtning:hamtning /var/lib/hamtning && chown -R garage:garage /var/lib/garage
   ```

   ```bash
   systemctl start garage hamtning-api
   ```

The storage key in `api.env` must be the old key, because the restored Garage contains it. If you
do not have the old key, make a new key with `garage key create`. Give it access to the bucket and
put it in `api.env`.

To restore only the database on a live server, use the same `restore.sh`. Stop the API. Then copy
only `app.db` back.

## Launch checklist

Do these tasks before the site opens to the public:

1. Make sure that the store phone number and email address in
   [store.ts](../packages/shared/src/store.ts) are correct.
2. Ask the store to approve the privacy page text. Then remove the "Utkast" banner from
   [PrivacyPage.tsx](../apps/web/src/pages/PrivacyPage.tsx).
3. Make sure that email works with `MAILER=resend` or `MAILER=smtp`. Refer to
   [deployment.md](deployment.md#6-configure-email).
4. Make sure that the first backup is done, the restore test passed, and the two timers are
   enabled.
5. Make sure that the uptime monitors are active and send alerts to a person.
6. Do a full test on the live site with a phone:
   1. Send a request with a photo from an iPhone (HEIC).
   2. Open the link in the verification email.
   3. Accept the request in the admin panel.
   4. Make sure that the status page changes and that the status email arrives.
