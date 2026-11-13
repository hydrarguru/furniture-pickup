# Load testing

This document tells you how to measure the capacity of the system. [k6](https://k6.io) simulates
many visitors at the same time. The test uses the full system: nginx with the production
configuration, the web app, the API, SQLite and Garage.

## Run a test on your computer

1. Install the tools one time:

   ```bash
   brew install k6 nginx garage
   ```

2. Build the project:

   ```bash
   pnpm build
   ```

3. Run one of the three profiles:

   | Command | Profile |
   | --- | --- |
   | `loadtest/run-local.sh smoke` | 1 minute of light traffic. It makes sure that all parts work. |
   | `loadtest/run-local.sh load` | 5 minutes at 50 visitor actions each second |
   | `loadtest/run-local.sh breakpoint` | The traffic increases until the system breaks |

`run-local.sh` starts a separate copy of the system in a temporary folder, on different ports:

- nginx with HTTPS and the real configuration
- the built API
- a new Garage
- a database with 500 requests and one employee with the role `admin`

The script runs k6 against this copy. Then it removes the copy. Your development database and
development Garage do not change.

## Simulated traffic

Each visitor action is one of these types:

| Type | Part of the traffic | What it does |
| --- | --- | --- |
| visitor | 55% | Opens the site: the page, its script, its style, and the category list |
| status | 30% | A status page asks for new data. A real status page does this each 30 seconds. |
| admin | 10% | An employee opens the list, a request, and the notification counts |
| customer | 5% | Sends the form: a presigned URL, the upload of a photo of 200 kB, and the request |

One action is 1 to 4 API calls or file downloads. The test passes when the system stays in these
limits (k6 thresholds):

- Fewer than 1% of the HTTP requests are not successful.
- 95% of the responses arrive within 500 ms (visitor, status), 1 s (admin), or 2 s (customer).

The breakpoint test stops when the system goes past a limit. Then it shows the traffic at that
time.

## Load-test mode

The real limits stop the test immediately. From one computer, nginx and the API accept only some
form submissions each hour. Also, each submission must have a solved Altcha challenge.

Thus, `run-local.sh` makes the nginx configuration without rate limits (`RATE_LIMITS=off`). It
starts the API with `LOAD_TEST=true`, which stops the rate limits and the Altcha check of the API.

The API does not start with `LOAD_TEST=true` and `NODE_ENV=production`.

## Results on a MacBook with 8 cores, 13 October 2026

| Profile | Traffic | Result |
| --- | --- | --- |
| smoke | 5 actions each second | All limits passed. 95% of the responses within 9 ms. |
| load | 50 actions each second for 5 minutes (approximately 150 HTTP requests each second, 707 forms) | All limits passed. 0% errors. 95% of the responses within 5 ms. |
| breakpoint | Increasing | The system broke at approximately 1,290 actions each second (approximately 1,900 HTTP requests each second). The errors went above 1%. The response times were still in their limits. |

The API runs as one Node process. Thus, it uses one CPU core. At the breakpoint, that core is
fully busy. New connections wait in a queue, and the system refuses some of them. The database,
Garage and nginx are not the limit.

A busy day for one store has some hundred visitors, some dozen forms, and employees in the admin
panel. This is much less than 1 action each second on average.

The test found one problem. nginx opened a new connection to the API for each HTTP request. At
approximately 500 actions each second, the computer had no more free local ports. nginx now keeps
a pool of open connections to the API and Garage (`upstream … keepalive` in
[hamtning.conf](../deploy/nginx/hamtning.conf)). This increased the breakpoint from approximately
500 to approximately 1,290 actions each second.

The local numbers have these limits:

- k6, nginx, the API and Garage all use the same computer. Thus, k6 takes CPU time from the
  system.
- macOS has a shorter queue for connections than Linux (128 against 4096).
- A small VPS has fewer and slower cores than a MacBook.

The local result shows that the code has no hidden bottleneck. To find the real capacity, do a
test on the VPS.

## Run a test on the VPS

Do this test before real customers use the site. The test stops the safety limits for some time.

1. On the server, make the nginx configuration without rate limits and reload nginx:

   ```bash
   APP_DOMAIN=hamta.example.se S3_DOMAIN=s3.hamta.example.se RATE_LIMITS=off deploy/nginx/render.sh && systemctl reload nginx
   ```

2. In `/etc/hamtning/api.env`, set these values for the test:
   - `NODE_ENV=development`
   - `LOAD_TEST=true`
   - `DATABASE_PATH=/var/lib/hamtning/loadtest.db`
3. Restart the API: `systemctl restart hamtning-api`.
4. Add the test data and copy the file `/tmp/seed.json` to your computer:

   ```bash
   cd /opt/hamtning/app/apps/api && sudo -u hamtning node --env-file=/etc/hamtning/api.env --import tsx scripts/loadtest-seed.ts /tmp/seed.json
   ```

5. On your computer, run k6. While it runs, watch `htop` on the server:

   ```bash
   k6 run -e PROFILE=breakpoint -e BASE_URL=https://hamta.example.se -e DATA=/path/to/seed.json loadtest/k6/app.js
   ```

6. Undo all the changes:
   1. Make the nginx configuration again without `RATE_LIMITS=off` and reload nginx.
   2. Restore the old `api.env` and restart the API.
   3. Delete `/var/lib/hamtning/loadtest.db`.

WARNING: Do not open the site to the public while `LOAD_TEST=true`. The rate limits and the bot
check do not operate.

The test photos in Garage belong to no request in the real database. The orphan sweep deletes them
within 1 day.

To do a test of read operations only, add `-e SUBMIT=false`. The test then sends no forms.

## More capacity

If the system must have more capacity, do these steps in this sequence:

1. Use a VPS with a faster CPU. The speed of one core is the limit, not the number of cores.
2. Run more API processes behind the nginx `upstream`. SQLite in WAL mode accepts many readers.
   Before you do this, move the live updates and the rate limit counters out of the process
   memory. Refer to [architecture.md](architecture.md#design-decisions).
3. Keep the category list in the nginx cache. It is the most frequent API call, and it does not
   change frequently.

These steps are not necessary for one store.

## Files

| File | Contents |
| --- | --- |
| [loadtest/k6/app.js](../loadtest/k6/app.js) | The visitor types, profiles, limits, and the summary |
| [loadtest/run-local.sh](../loadtest/run-local.sh) | Starts the system, runs k6, and shows the peak CPU and memory of the API |
| [apps/api/scripts/loadtest-seed.ts](../apps/api/scripts/loadtest-seed.ts) | The test data. It refuses a database that contains requests. |
| `loadtest/results/` | Not committed. The full k6 data as JSON, and the nginx and API logs of each test. |
