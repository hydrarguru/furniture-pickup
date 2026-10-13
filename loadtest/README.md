# Load testing

How much traffic can the app handle? [k6](https://k6.io) plays many visitors at once against the
whole stack: nginx with the production config, the web app, the API, SQLite and Garage.

```sh
brew install k6 nginx garage   # once
pnpm build
loadtest/run-local.sh smoke        # 1 minute, light: does everything work?
loadtest/run-local.sh load         # 5 minutes at 50 visitor actions/s
loadtest/run-local.sh breakpoint   # more and more traffic until it breaks
```

`run-local.sh` starts its own copy of everything in a temporary folder, on its own ports:

- nginx with HTTPS and the real config
- the built API
- a fresh Garage
- a database seeded with 500 requests and an admin

It runs k6 against that copy, then removes it all. Your dev database and dev Garage are not touched.

## What is simulated

Each "visitor action" is one of these, mixed in roughly real-life proportions:

| Kind | Share | What it does |
|---|---|---|
| visitor | 55% | opens the site: the page, its script and style, the category list |
| status | 30% | a customer's open status page checking for news (it does this every 30 s) |
| admin | 10% | staff open the list, a request and the notification counts |
| customer | 5% | submits the form: gets an upload URL, uploads a 200 kB photo to storage, sends the request |

So one action is 1–4 HTTP requests. **Limits** (k6 thresholds), which define "still working fine":

- fewer than 1% failed requests
- for 95% of requests, a response within 500 ms (visitor, status page), 1 s (admin) or 2 s (customer)

The breakpoint test stops as soon as a limit is crossed, and reports the traffic level at that
moment.

**Load-test mode.** The real limits would stop the test immediately: from one machine, nginx and
the API allow a handful of form submissions per hour, and every submission asks Cloudflare to
check its Turnstile token. `run-local.sh` therefore renders nginx without its rate limits
(`RATE_LIMITS=off`). It also starts the API with `LOAD_TEST=true`, which turns off the API's rate
limits and the Turnstile check. The API refuses to start with `LOAD_TEST` in production.

## Results on a MacBook (8 cores), 13 Oct 2026

| Profile | Traffic | Result |
|---|---|---|
| smoke | 5 actions/s | all limits met, 95% of responses within 9 ms |
| load | 50 actions/s for 5 min (≈ 150 HTTP requests/s, 707 forms submitted) | all limits met, 0% failed, 95% of responses within 5 ms |
| breakpoint | ramping up | **broke at about 1,290 actions/s ≈ 1,900 HTTP requests/s**: failures went over 1%, while response times were still well within their limits (95% under 50–275 ms) |

**What breaks first:** the API runs as one Node process, so it uses one CPU core. At the breaking
point that core is fully busy, new connections queue up, and some are refused. The database,
Garage and nginx are not the limit.

**For scale:** a busy day for a single store might be a few hundred visitors, a few dozen forms
and staff working in the admin. That is well under 1 action per second on average. The local
machine handled over a thousand per second.

**Found by this test and fixed:** nginx opened a new connection to the API for every request.
At about 500 actions/s the machine ran out of free local ports ("Can't assign requested address"),
and a VPS would hit the same limit at a similar rate. nginx now keeps a pool of open connections
to the API and Garage (`upstream … keepalive` in `deploy/nginx/hamtning.conf`), which raised the
breaking point from about 500 to about 1,290 actions/s.

Keep in mind:

- k6, nginx, the API and Garage all share the same laptop here, so k6 itself takes CPU away from
  the app.
- macOS allows a shorter queue of waiting connections than Linux (128 against 4096).
- A small VPS has fewer and slower cores than a MacBook.

So treat the local numbers as "the code has no hidden bottleneck". The real capacity comes from
testing the VPS.

## On the VPS, before launch

Run k6 from your own machine against the server, so the network is part of the test. Do it
before real customers use the site, because the test needs the safety limits off for a while:

1. On the server, render nginx without rate limits and reload it:
   `APP_DOMAIN=… S3_DOMAIN=… RATE_LIMITS=off deploy/nginx/render.sh && systemctl reload nginx`.
2. In `/etc/hamtning/api.env`, temporarily set `NODE_ENV=development` and `LOAD_TEST=true`.
   Also point `DATABASE_PATH` at a separate file (`/var/lib/hamtning/loadtest.db`), then restart
   the API.
3. Seed it, and copy the seed file to your machine:
   `cd /opt/hamtning/app/apps/api && sudo -u hamtning node --env-file=/etc/hamtning/api.env --import tsx scripts/loadtest-seed.ts /tmp/seed.json`
4. From your machine:
   `k6 run -e PROFILE=breakpoint -e BASE_URL=https://hamta.example.se -e DATA=/path/to/seed.json loadtest/k6/app.js`.
   Watch `htop` on the server meanwhile.
5. **Undo all of it:**
   - render nginx again without `RATE_LIMITS=off` and reload it
   - restore `api.env` and restart the API
   - delete `loadtest.db`

   The test photos in Garage belong to no request in the real database, so the orphan sweep
   deletes them within a day.

`SUBMIT=false` (`-e SUBMIT=false`) leaves out the form submissions. Use it to test reading only.

## If more capacity is ever needed

In order of effort:

1. **A VPS with a faster CPU.** The API is bound by a single core's speed, not the number of cores.
2. **Several API processes.** Node's cluster mode or a few systemd instances behind nginx's
   `upstream`. SQLite in WAL mode handles several readers; writes stay serialised, which is fine at
   this volume.
3. **Cache the category list in nginx.** It's the most requested API call and rarely changes.

None of these are needed for one store.

## Files

- `k6/app.js`: the visitor mix, profiles, limits and the plain-language summary.
- `run-local.sh`: starts the stack, runs k6, and reports the API process's peak CPU and memory.
- `../apps/api/scripts/loadtest-seed.ts`: the seed data (refuses a database that already has
  requests).
- `results/` (not committed): k6's full data as JSON, plus the nginx and API logs of each run.
