// Load test for the whole app (web app through nginx + API + photo storage). See loadtest/README.md.
//
//   k6 run -e PROFILE=smoke|load|breakpoint -e BASE_URL=https://... -e DATA=seed.json loadtest/k6/app.js
//
// Four kinds of visitors, mixed like real traffic:
//   visitor   opens the site: the page, its script and style, the category list
//   status    a customer's open status page checking for news (it does this every 30 s)
//   admin     staff going through the list and opening requests
//   customer  fills in the form: presigns a photo, uploads it to storage, submits the request
//             (only when the API runs with LOAD_TEST=true; rate limits and Turnstile stop it otherwise)

import { check, fail } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "https://hamta.localhost:8443";
const PROFILE = __ENV.PROFILE || "smoke";
const SUBMIT = (__ENV.SUBMIT || "true") === "true";
const seed = JSON.parse(open(__ENV.DATA || "../.run/seed.json"));
const tokens = new SharedArray("tokens", () => seed.tokens);
const requestIds = new SharedArray("ids", () => seed.requestIds);

const submitted = new Counter("requests_submitted");

// Share of each kind of visitor in the mixed traffic. Customers are rare: most traffic is people
// looking at the site and status pages refreshing themselves.
const MIX = SUBMIT
  ? [
      ["visitor", 0.55],
      ["status", 0.3],
      ["admin", 0.1],
      ["customer", 0.05],
    ]
  : [
      ["visitor", 0.6],
      ["status", 0.3],
      ["admin", 0.1],
    ];

// Iterations (= one visitor action) per second.
const PROFILES = {
  // A minute of light traffic: does everything work at all?
  smoke: { executor: "constant-arrival-rate", rate: 5, duration: "1m", preAllocatedVUs: 10 },
  // A busy period held for 5 minutes, far above what a single store normally sees.
  load: { executor: "constant-arrival-rate", rate: 50, duration: "5m", preAllocatedVUs: 100 },
  // Keeps adding traffic until responses get slow or fail; the test stops there.
  breakpoint: {
    executor: "ramping-arrival-rate",
    startRate: 10,
    stages: [{ target: Number(__ENV.MAX_RATE || 2000), duration: __ENV.RAMP || "10m" }],
    preAllocatedVUs: 200,
    maxVUs: 3000,
  },
};

// "Good enough": what a person would still call fast. The breakpoint profile stops when broken.
const abort = PROFILE === "breakpoint";
export const options = {
  hosts: hostsFromBaseUrl(),
  insecureSkipTLSVerify: BASE_URL.includes(".localhost"),
  discardResponseBodies: false,
  scenarios: { mixed: { ...PROFILES[PROFILE], timeUnit: "1s", exec: "mixed" } },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: abort, delayAbortEval: "20s" }],
    "http_req_duration{kind:visitor}": [
      { threshold: "p(95)<500", abortOnFail: abort, delayAbortEval: "20s" },
    ],
    "http_req_duration{kind:status}": [
      { threshold: "p(95)<500", abortOnFail: abort, delayAbortEval: "20s" },
    ],
    "http_req_duration{kind:admin}": [
      { threshold: "p(95)<1000", abortOnFail: abort, delayAbortEval: "20s" },
    ],
    "http_req_duration{kind:customer}": ["p(95)<2000"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

/** Logs in once; every admin iteration reuses the session cookie. */
export function setup() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: seed.admin.email, password: seed.admin.password }),
    { headers: { "content-type": "application/json", "x-requested-with": "fetch" } },
  );
  if (res.status !== 200) fail(`admin login failed: ${res.status} ${res.body}`);
  const sid = res.cookies.sid?.[0]?.value;
  // The web app's script and style, so visitors load what a browser would.
  const html = http.get(`${BASE_URL}/`).body;
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  return { sid, assets };
}

export function mixed(data) {
  const kind = pick();
  if (kind === "visitor") visitor(data);
  else if (kind === "status") statusPage();
  else if (kind === "admin") admin(data);
  else customer();
}

function visitor({ assets }) {
  const tags = { kind: "visitor" };
  const responses = http.batch([
    ["GET", `${BASE_URL}/`, null, { tags }],
    ...assets.map((a) => ["GET", `${BASE_URL}${a}`, null, { tags }]),
    ["GET", `${BASE_URL}/api/categories`, null, { tags }],
  ]);
  check(responses, { "visitor: all 200": (rs) => rs.every((r) => r.status === 200) });
}

function statusPage() {
  const token = tokens[Math.floor(Math.random() * tokens.length)];
  const res = http.get(`${BASE_URL}/api/requests/by-token/${token}`, {
    tags: { kind: "status", name: "GET /api/requests/by-token/[token]" },
  });
  check(res, { "status: 200": (r) => r.status === 200 });
}

function admin({ sid }) {
  const params = {
    headers: { cookie: `sid=${sid}`, "x-requested-with": "fetch" },
    tags: { kind: "admin" },
  };
  const list = http.get(`${BASE_URL}/api/admin/requests?status=new`, {
    ...params,
    tags: { ...params.tags, name: "GET /api/admin/requests" },
  });
  const id = requestIds[Math.floor(Math.random() * requestIds.length)];
  const detail = http.get(`${BASE_URL}/api/admin/requests/${id}`, {
    ...params,
    tags: { ...params.tags, name: "GET /api/admin/requests/[id]" },
  });
  const summary = http.get(`${BASE_URL}/api/admin/notifications/summary`, params);
  check([list, detail, summary], { "admin: all 200": (rs) => rs.every((r) => r.status === 200) });
}

// A small stand-in photo. The API checks type and size, not the picture itself.
const PHOTO = new Uint8Array(200_000).map((_, i) => i % 251).buffer;

function customer() {
  const tags = { kind: "customer" };
  const json = { "content-type": "application/json" };
  const presign = http.post(
    `${BASE_URL}/api/uploads/presign`,
    JSON.stringify({ files: [{ contentType: "image/jpeg", size: PHOTO.byteLength }] }),
    { headers: json, tags },
  );
  if (!check(presign, { "customer: presigned": (r) => r.status === 200 })) return;
  const slot = presign.json("uploads.0");

  const upload = http.put(slot.url, PHOTO, {
    headers: { "content-type": "image/jpeg" },
    tags: { ...tags, name: "PUT photo to storage" },
  });
  if (!check(upload, { "customer: photo uploaded": (r) => r.status === 200 })) return;

  const n = exec.scenario.iterationInTest;
  const submit = http.post(
    `${BASE_URL}/api/requests`,
    JSON.stringify({
      name: "Lasttest Kund",
      email: `kund${n}@example.se`,
      phone: "070-123 45 67",
      street: "Storgatan 1",
      postcode: "412 50",
      city: "Göteborg",
      items: [{ title: "Soffa", quantity: 1 }],
      imageKeys: [slot.key],
      timeWindows: [{ date: daysFromNow(10), part: "forenoon" }],
      consent: true,
      turnstileToken: "load-test",
    }),
    { headers: json, tags },
  );
  if (check(submit, { "customer: submitted": (r) => r.status === 201 })) submitted.add(1);
}

function pick() {
  let r = Math.random();
  for (const [kind, share] of MIX) {
    if (r < share) return kind;
    r -= share;
  }
  return MIX[0][0];
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
}

/** *.localhost names don't resolve everywhere; point them (and the storage host) at this machine. */
function hostsFromBaseUrl() {
  const host = BASE_URL.replace(/^https?:\/\//, "").replace(/[:/].*$/, "");
  if (!host.endsWith(".localhost")) return {};
  return { [host]: "127.0.0.1", [`s3.${host}`]: "127.0.0.1" };
}

/** Plain-language summary on top of k6's own. */
export function handleSummary(data) {
  const m = data.metrics;
  const seconds = data.state.testRunDurationMs / 1000;
  const p95 = (kind) => m[`http_req_duration{kind:${kind}}`]?.values["p(95)"];
  const fmt = (v) => (v === undefined ? "-" : `${Math.round(v)} ms`);
  const lines = [
    "",
    `Profile: ${PROFILE}, ran ${Math.round(seconds)} s against ${BASE_URL}`,
    `Visitor actions: ${m.iterations.values.count} (${m.iterations.values.rate.toFixed(1)}/s)`,
    `HTTP requests:   ${m.http_reqs.values.count} (${m.http_reqs.values.rate.toFixed(1)}/s), failed ${(m.http_req_failed.values.rate * 100).toFixed(2)}%`,
    `Submitted forms: ${m.requests_submitted ? m.requests_submitted.values.count : 0}`,
    `95% of responses within: visitor ${fmt(p95("visitor"))}, status page ${fmt(p95("status"))}, admin ${fmt(p95("admin"))}, customer ${fmt(p95("customer"))}`,
  ];
  if (PROFILE === "breakpoint") {
    const stage = PROFILES.breakpoint.stages[0];
    const rampSeconds = parseDuration(stage.duration);
    const reached =
      PROFILES.breakpoint.startRate +
      (stage.target - PROFILES.breakpoint.startRate) * Math.min(1, seconds / rampSeconds);
    const failed = Object.entries(data.metrics).some(
      ([, v]) => v.thresholds && Object.values(v.thresholds).some((t) => !t.ok),
    );
    lines.push(
      failed
        ? `Breaking point: about ${Math.round(reached)} visitor actions/s (the target rate when a limit was crossed)`
        : `No breaking point up to ${stage.target} visitor actions/s; raise MAX_RATE`,
    );
  }
  lines.push("Limits:");
  for (const [name, metric] of Object.entries(m)) {
    for (const [rule, result] of Object.entries(metric.thresholds || {}))
      lines.push(`  ${result.ok ? "ok  " : "FAIL"} ${name} ${rule}`);
  }
  const text = `${lines.join("\n")}\n`;
  const out = { stdout: text };
  if (__ENV.SUMMARY_JSON) out[__ENV.SUMMARY_JSON] = JSON.stringify(data, null, 2);
  return out;
}

function parseDuration(d) {
  const n = Number.parseFloat(d);
  return d.endsWith("m") ? n * 60 : d.endsWith("h") ? n * 3600 : n;
}
