// Demo data for development: 100 customer requests in every stage, with items, photos, proposed
// times, history, staff notes and messages. The same data every run (fixed random seed), with
// dates relative to today so nothing is deleted by the retention job.
//
//   pnpm seed:demo            add the demo requests (Garage must be running: pnpm dev)
//   pnpm seed:demo --remove   delete them again (only demo data: emails @exempel.test)
//
// Prints status-page links for a few requests, so the customer side can be tried too.
import { deflateSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  addDays,
  type RequestStatus,
  STATUS_LABELS_SV,
  stockholmToday,
  stockholmToUtcIso,
} from "@hamtning/shared";
import { like } from "drizzle-orm";
import { hashPassword } from "../src/auth/passwords.js";
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  cancellations,
  categories,
  employees,
  images,
  items,
  requestEvents,
  requests,
  timeWindows,
} from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { newId } from "../src/ids.js";
import { deleteRequests } from "../src/retention/purge.js";
import { hashToken, newToken } from "../src/security/tokens.js";
import { S3Storage } from "../src/storage/s3.js";

const DOMAIN = "exempel.test";
const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("Demo data is for development only");
const { sqlite, db } = openDatabase(env.DATABASE_PATH);
runMigrations(db);
const storage = new S3Storage({
  endpoint: env.S3_ENDPOINT,
  publicEndpoint: env.S3_PUBLIC_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

if (process.argv.includes("--remove")) {
  const ids = db
    .select({ id: requests.id })
    .from(requests)
    .where(like(requests.email, `%@${DOMAIN}`))
    .all()
    .map((r) => r.id);
  const removed = await deleteRequests({ db, storage }, ids);
  db.delete(cancellations).where(like(cancellations.requestId, "DEMO%")).run();
  db.delete(employees).where(like(employees.username, `%.demo`)).run();
  console.log(`Removed ${removed.requests} demo requests and ${removed.images} photos.`);
  sqlite.close();
  process.exit(0);
}

if (
  db
    .select({ id: requests.id })
    .from(requests)
    .where(like(requests.email, `%@${DOMAIN}`))
    .get()
) {
  console.error("Demo data is already there. Remove it first: pnpm seed:demo --remove");
  process.exit(1);
}
if (!(await storage.ping())) {
  console.error("Garage is not reachable; start it first (pnpm dev or pnpm storage:dev).");
  process.exit(1);
}

// --- Deterministic randomness ------------------------------------------------------------------
let seed = 20261013;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;

// --- People and places -------------------------------------------------------------------------
const FIRST = [
  "Anna",
  "Erik",
  "Maria",
  "Johan",
  "Karin",
  "Lars",
  "Sara",
  "Anders",
  "Eva",
  "Mikael",
  "Lena",
  "Per",
  "Emma",
  "Fredrik",
  "Ingrid",
  "Oskar",
  "Linnea",
  "Gustav",
  "Elin",
  "Nils",
  "Åsa",
  "Björn",
  "Sofia",
  "Henrik",
  "Maja",
  "Jonas",
  "Ulla",
  "Kristoffer",
  "Ebba",
  "Göran",
];
const LAST = [
  "Andersson",
  "Johansson",
  "Karlsson",
  "Nilsson",
  "Eriksson",
  "Larsson",
  "Olsson",
  "Persson",
  "Svensson",
  "Gustafsson",
  "Pettersson",
  "Jonsson",
  "Lindberg",
  "Lindqvist",
  "Berg",
  "Holm",
  "Ek",
  "Sjöberg",
  "Wallin",
  "Åberg",
  "Öberg",
  "Lundgren",
  "Strand",
  "Forsberg",
];
const PLACES = [
  {
    city: "Göteborg",
    postcodes: ["41250", "41319", "41463", "41664", "41705", "42137"],
    streets: [
      "Storgatan",
      "Linnégatan",
      "Vasagatan",
      "Kungsgatan",
      "Övre Husargatan",
      "Majorsgatan",
      "Kastellgatan",
      "Danska vägen",
      "Doktor Allards gata",
      "Eklandagatan",
    ],
  },
  {
    city: "Mölndal",
    postcodes: ["43130", "43136", "43145"],
    streets: ["Kvarnbygatan", "Frölundagatan", "Toltorpsgatan", "Bifrostgatan"],
  },
  {
    city: "Partille",
    postcodes: ["43330", "43337"],
    streets: ["Kyrktorget", "Ugglumsvägen", "Gamla Kronvägen"],
  },
  {
    city: "Kungsbacka",
    postcodes: ["43430", "43440"],
    streets: ["Storgatan", "Varbergsvägen", "Hammargatan"],
  },
  {
    city: "Kungälv",
    postcodes: ["44230", "44235"],
    streets: ["Västra Gatan", "Strandgatan", "Fontinvägen"],
  },
  {
    city: "Lerum",
    postcodes: ["44330", "44337"],
    streets: ["Göteborgsvägen", "Aspvägen", "Torpvägen"],
  },
];
const ACCESS = [
  "Portkod 1234. Ringer på när ni är här.",
  "Parkering finns på gården.",
  "Sakerna står i källarförrådet, nyckel hos mig.",
  "Smal trappa, soffan behöver troligen bäras av två.",
  "Infart från baksidan, skylt vid grinden.",
  "Ring när ni är 10 minuter bort, så möter jag upp.",
];
const MESSAGES = [
  "Vi har rensat inför flytt och vill gärna att sakerna kommer till användning.",
  "Dödsbo efter min mamma. Det mesta är i fint skick.",
  "Allt är rökfritt och djurfritt.",
  "Hör av er om ni bara vill ha en del av sakerna.",
  "Flexibel med tider, jobbar hemifrån.",
  "Barnen har vuxit ur det mesta.",
];

// --- Things people give away, by category (labels from the default category list) ----------------
type Item = {
  title: string;
  category: string;
  description?: string;
  condition?: "good" | "ok" | "worn";
  quantity?: number;
};
const CATALOG: Item[] = [
  {
    title: "Bäddsoffa",
    category: "Soffor och fåtöljer",
    description: "Grå tyg, 3-sits, lätt att fälla ut.",
    condition: "ok",
  },
  {
    title: "Skinnfåtölj",
    category: "Soffor och fåtöljer",
    description: "Brun, lite sliten på armstöden.",
    condition: "worn",
  },
  {
    title: "Hörnsoffa",
    category: "Soffor och fåtöljer",
    description: "Blå sammet, avtagbara klädslar.",
    condition: "good",
  },
  {
    title: "Matbord i ek",
    category: "Bord",
    description: "180 × 90 cm, går att förlänga.",
    condition: "good",
  },
  {
    title: "Soffbord",
    category: "Bord",
    description: "Glasskiva med hylla under.",
    condition: "ok",
  },
  { title: "Sängbord", category: "Bord", condition: "good", quantity: 2 },
  {
    title: "Pinnstolar",
    category: "Stolar",
    description: "Vitmålade, matchar matbordet.",
    condition: "ok",
    quantity: 4,
  },
  {
    title: "Kontorsstol",
    category: "Kontorsmöbler",
    description: "Ställbar höjd, svart nät.",
    condition: "good",
  },
  {
    title: "Skrivbord",
    category: "Kontorsmöbler",
    description: "120 cm, vit skiva, en låda.",
    condition: "ok",
  },
  {
    title: "Byrå med fem lådor",
    category: "Skåp, byråar och hyllor",
    description: "Furu, ett handtag saknas.",
    condition: "worn",
  },
  {
    title: "Bokhylla",
    category: "Skåp, byråar och hyllor",
    description: "Billy, 80 cm bred.",
    condition: "good",
    quantity: 2,
  },
  {
    title: "Vitrinskåp",
    category: "Skåp, byråar och hyllor",
    description: "Glasdörrar, belysning i taket.",
    condition: "good",
  },
  {
    title: "Säng 160 cm",
    category: "Sängar",
    description: "Ram och huvudgavel, utan madrass.",
    condition: "ok",
  },
  {
    title: "Våningssäng",
    category: "Sängar",
    description: "Massiv björk, monteras isär.",
    condition: "good",
  },
  {
    title: "Golvlampa",
    category: "Belysning",
    description: "Mässing, ny sladd.",
    condition: "good",
  },
  { title: "Taklampor", category: "Belysning", condition: "ok", quantity: 3 },
  {
    title: "Persisk matta",
    category: "Mattor och textilier",
    description: "Ca 200 × 300 cm.",
    condition: "ok",
  },
  {
    title: "Gardiner och kuddfodral",
    category: "Mattor och textilier",
    description: "En kasse.",
    condition: "good",
  },
  {
    title: "Kaffeservis",
    category: "Porslin och glas",
    description: "Rörstrand, 12 kuppar med fat.",
    condition: "good",
  },
  { title: "Vinglas", category: "Porslin och glas", condition: "good", quantity: 18 },
  {
    title: "Kastruller och stekpannor",
    category: "Kök och husgeråd",
    description: "Två kartonger.",
    condition: "ok",
  },
  {
    title: "Köksmaskin",
    category: "Kök och husgeråd",
    description: "Assistent, fungerar fint.",
    condition: "good",
  },
  {
    title: "Böcker",
    category: "Böcker",
    description: "Romaner och deckare, ca 6 kartonger.",
    condition: "good",
  },
  { title: "Barnböcker", category: "Böcker", description: "En kartong.", condition: "ok" },
  {
    title: "Vinylskivor",
    category: "Musik och film",
    description: "Ca 150 st, mest 70-tal.",
    condition: "good",
  },
  { title: "DVD-filmer", category: "Musik och film", description: "Två kassar.", condition: "ok" },
  {
    title: "Piano",
    category: "Musikinstrument",
    description: "Svart, behöver stämmas. Bottenvåning.",
    condition: "ok",
  },
  { title: "Akustisk gitarr", category: "Musikinstrument", condition: "good" },
  {
    title: "Barnvagn",
    category: "Barn och baby",
    description: "Kombivagn med liggdel.",
    condition: "good",
  },
  { title: "Spjälsäng", category: "Barn och baby", condition: "good" },
  {
    title: "Lego",
    category: "Leksaker och spel",
    description: "En stor back, blandat.",
    condition: "ok",
  },
  { title: "Sällskapsspel", category: "Leksaker och spel", condition: "good", quantity: 8 },
  { title: "Damcykel", category: "Cyklar", description: "7 växlar, nya däck.", condition: "ok" },
  { title: "Barncykel 20 tum", category: "Cyklar", condition: "worn" },
  {
    title: "Längdskidor",
    category: "Sport och fritid",
    description: "Med pjäxor storlek 42.",
    condition: "ok",
  },
  { title: "Tält för fyra", category: "Sport och fritid", condition: "good" },
  {
    title: "Vinterjackor",
    category: "Kläder, skor och accessoarer",
    description: "Två kassar, vuxenstorlekar.",
    condition: "good",
  },
  {
    title: "Oljemålning",
    category: "Konst, tavlor och speglar",
    description: "Landskap i guldram.",
    condition: "good",
  },
  {
    title: "Stor spegel",
    category: "Konst, tavlor och speglar",
    description: "Ca 150 cm hög.",
    condition: "good",
  },
  {
    title: "Krukor och vaser",
    category: "Inredning och dekoration",
    description: "En kartong.",
    condition: "ok",
  },
  {
    title: "Utemöbler",
    category: "Trädgård och utemöbler",
    description: "Bord och fyra stolar i teak.",
    condition: "worn",
  },
  {
    title: "Gräsklippare",
    category: "Trädgård och utemöbler",
    description: "Handdriven.",
    condition: "ok",
  },
  {
    title: "Verktygslåda",
    category: "Verktyg",
    description: "Handverktyg, komplett.",
    condition: "good",
  },
  { title: "Borrmaskin", category: "Verktyg", condition: "ok" },
  {
    title: "Tv 42 tum",
    category: "Elektronik",
    description: "Med fjärrkontroll.",
    condition: "ok",
  },
  {
    title: "Diskmaskin",
    category: "Vitvaror",
    description: "Fristående, 5 år gammal.",
    condition: "ok",
  },
  {
    title: "Tvättmaskin",
    category: "Vitvaror",
    description: "Fungerar, står i tvättstugan.",
    condition: "ok",
  },
  { title: "Symaskin", category: "Övrigt", description: "Husqvarna med väska.", condition: "good" },
];

const NOTES = [
  "Ringde kunden, inget svar. Försöker igen i morgon.",
  "Kunden bekräftar att hissen rymmer soffan.",
  "Kollat bilderna: fint skick, vi tar allt.",
  "Behöver två personer på plats.",
  "Kunden vill gärna ha kvitto på gåvan.",
];
const ACCEPT_MESSAGES = [
  "Vi ringer en halvtimme innan vi kommer.",
  "Ställ gärna fram sakerna i hallen.",
  null,
  "Vi kommer med en lite större bil.",
];
const DECLINE_MESSAGES = [
  "Tyvärr har vi inte plats för stora möbler just nu.",
  "Utifrån bilderna är slitaget för stort för att vi ska kunna sälja vidare.",
  "Vi tar inte emot vitvaror som är äldre än tio år.",
  "Tyvärr hämtar vi inte så långt bort för tillfället.",
];

// 100 requests: the stages a store would see over a week or two.
const PLAN: { status: RequestStatus; count: number }[] = [
  { status: "unverified", count: 8 },
  { status: "new", count: 28 },
  { status: "in_progress", count: 20 },
  { status: "accepted", count: 20 },
  { status: "on_the_way", count: 6 },
  { status: "declined", count: 18 },
];

// --- Placeholder photos: a PNG in a colour per category ------------------------------------------
function png(width: number, height: number, [r, g, b]: [number, number, number]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      // Soft vertical light and a darker "object" in the middle, so it reads as a photo slot.
      const inObject =
        Math.abs(x - width / 2) < width * 0.28 && y > height * 0.3 && y < height * 0.85;
      const shade = (inObject ? 0.62 : 1) * (0.85 + 0.15 * (1 - y / height));
      raw[row + 1 + x * 3] = Math.round(r * shade);
      raw[row + 2 + x * 3] = Math.round(g * shade);
      raw[row + 3 + x * 3] = Math.round(b * shade);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const COLORS: [number, number, number][] = [
  [214, 196, 168],
  [176, 196, 214],
  [196, 214, 176],
  [224, 186, 176],
  [200, 186, 224],
  [186, 214, 210],
  [230, 214, 160],
  [190, 190, 190],
];
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

// --- Build -----------------------------------------------------------------------------------------
const today = stockholmToday();
const now = Date.now();
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const categoryIds = new Map(
  db
    .select({ id: categories.id, label: categories.labelSv })
    .from(categories)
    .all()
    .map((c) => [c.label, c.id]),
);

const staff = [
  { name: "Sara Lindqvist", username: "sara.demo" },
  { name: "Ahmed Karimi", username: "ahmed.demo" },
].map((s) => ({ ...s, id: newId() }));
for (const s of staff)
  db.insert(employees)
    .values({
      id: s.id,
      username: s.username,
      name: s.name,
      role: "staff",
      passwordHash: await hashPassword(newToken()),
      createdAt: iso(now - 30 * 24 * HOUR),
    })
    .run();

const links: { status: RequestStatus; name: string; url: string }[] = [];
let photoCount = 0;
let n = 0;

for (const { status, count } of PLAN) {
  for (let i = 0; i < count; i++, n++) {
    const id = newId();
    const token = newToken();
    const first = pick(FIRST);
    const last = pick(LAST);
    const place = pick(PLACES);
    const apartment = chance(0.6);

    // When it came in and when staff last touched it. Open requests stay within 7 days of
    // activity, so the hourly retention job leaves them; a few are close, to show the warning.
    const ageHours =
      status === "unverified"
        ? between(2, 140)
        : status === "new"
          ? i < 3
            ? between(110, 130)
            : between(1, 90)
          : status === "in_progress"
            ? between(24, 140)
            : status === "declined"
              ? between(30, 500)
              : between(48, 300);
    const createdMs = now - ageHours * HOUR;
    const verifiedMs = createdMs + between(5, 90) * 60_000;

    // Proposed times: 1–3 windows, 3–40 days ahead.
    const windows = Array.from({ length: between(1, 3) }, () => {
      const date = addDays(today, between(3, 40));
      if (chance(0.25))
        return { date, part: "custom" as const, fromTime: "10:00", toTime: "13:00", note: null };
      return {
        date,
        part: pick(["forenoon", "afternoon", "evening"] as const),
        fromTime: null,
        toTime: null,
        note: chance(0.2) ? "Helst efter lunch om det går." : null,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    // Status-specific details
    let confirmedStart: string | null = null;
    let confirmedEnd: string | null = null;
    let staffMessage: string | null = null;
    let closedAt: string | null = null;
    let updatedMs = status === "unverified" ? createdMs : verifiedMs;
    const events: {
      type: "status_change" | "note" | "email_sent";
      from?: RequestStatus;
      to?: RequestStatus;
      note?: string | null;
      at: number;
      by?: string;
    }[] = [];
    const by = pick(staff).id;

    if (status !== "unverified")
      events.push({
        type: "status_change",
        from: "unverified",
        to: "new",
        note: "verifierad via e-post",
        at: verifiedMs,
      });
    if (["in_progress", "accepted", "on_the_way", "declined"].includes(status)) {
      const at = Math.min(now - HOUR, verifiedMs + between(2, 30) * HOUR);
      events.push({ type: "status_change", from: "new", to: "in_progress", at, by });
      updatedMs = at;
      if (chance(0.6)) {
        updatedMs = Math.min(now - 30 * 60_000, at + between(1, 20) * HOUR);
        events.push({ type: "note", note: pick(NOTES), at: updatedMs, by });
      }
    }
    if (status === "new" && i >= 3 && chance(0.3)) {
      updatedMs = Math.min(now - 30 * 60_000, verifiedMs + between(1, 10) * HOUR);
      events.push({ type: "note", note: pick(NOTES), at: updatedMs, by });
    }
    if (status === "accepted" || status === "on_the_way") {
      const w =
        status === "on_the_way"
          ? { date: today, from: "13:00", to: "15:00" }
          : {
              date: windows[0]?.date ?? addDays(today, 7),
              from: pick(["09:00", "10:00", "13:00", "15:00"]),
              to: "",
            };
      if (!w.to) w.to = `${String(Number(w.from.slice(0, 2)) + 2).padStart(2, "0")}:00`;
      confirmedStart = stockholmToUtcIso(w.date, w.from);
      confirmedEnd = stockholmToUtcIso(w.date, w.to);
      closedAt = confirmedEnd;
      staffMessage = pick(ACCEPT_MESSAGES);
      const at = Math.min(now - 2 * HOUR, updatedMs + between(2, 24) * HOUR);
      events.push({
        type: "status_change",
        from: "in_progress",
        to: "accepted",
        note: staffMessage,
        at,
        by,
      });
      events.push({ type: "email_sent", note: "Bekräftelse av hämtning", at: at + 1000, by });
      updatedMs = at;
      if (status === "on_the_way") {
        const otw = now - between(10, 50) * 60_000;
        if (chance(0.5)) staffMessage = "Vi är framme om ca 20 minuter.";
        events.push({
          type: "status_change",
          from: "accepted",
          to: "on_the_way",
          note: staffMessage,
          at: otw,
          by,
        });
        events.push({ type: "email_sent", note: "Besked om att vi är på väg", at: otw + 1000, by });
        updatedMs = otw;
      }
    }
    if (status === "declined") {
      const at = Math.min(now - HOUR, updatedMs + between(1, 30) * HOUR);
      staffMessage = pick(DECLINE_MESSAGES);
      events.push({
        type: "status_change",
        from: "in_progress",
        to: "declined",
        note: staffMessage,
        at,
        by,
      });
      events.push({ type: "email_sent", note: "Besked om avslag", at: at + 1000, by });
      closedAt = iso(at);
      updatedMs = at;
    }

    db.insert(requests)
      .values({
        id,
        status,
        name: `${first} ${last}`,
        email: `${first}.${last}${n}@${DOMAIN}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
        phone: `+4670${String(between(1000000, 9999999))}`,
        street: `${pick(place.streets)} ${between(1, 60)}${apartment && chance(0.3) ? " lgh 1102" : ""}`,
        postcode: pick(place.postcodes),
        city: place.city,
        floor: apartment ? between(0, 6) : null,
        hasElevator: apartment ? chance(0.6) : null,
        accessNotes: chance(0.5) ? pick(ACCESS) : null,
        message: chance(0.5) ? pick(MESSAGES) : null,
        consentAt: iso(createdMs),
        verifiedAt: status === "unverified" ? null : iso(verifiedMs),
        // Some new requests haven't been opened by staff yet (they show as unseen in the admin).
        seenAt:
          status === "unverified" || (status === "new" && i % 2 === 0)
            ? null
            : iso(verifiedMs + HOUR),
        tokenHash: hashToken(token),
        tokenExpires: iso(createdMs + 24 * HOUR),
        confirmedStart,
        confirmedEnd,
        staffMessage,
        closedAt,
        createdAt: iso(createdMs),
        updatedAt: iso(updatedMs),
      })
      .run();

    // Items: 1–4 different things.
    const chosen = new Set<Item>();
    const itemCount = between(1, 4);
    while (chosen.size < itemCount) chosen.add(pick(CATALOG));
    const itemRows = [...chosen].map((item) => ({
      id: newId(),
      requestId: id,
      title: item.title,
      categoryId: categoryIds.get(item.category) ?? null,
      description: item.description ?? null,
      condition: item.condition ?? null,
      quantity: item.quantity ?? 1,
    }));
    db.insert(items).values(itemRows).run();

    // Photos: 1–3, uploaded to Garage like real ones.
    const photoTotal = between(1, 3);
    for (let p = 0; p < photoTotal; p++) {
      const body = png(480, 360, COLORS[(n + p) % COLORS.length] as [number, number, number]);
      const key = `uploads/${newId()}.png`;
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: "image/png",
        }),
      );
      db.insert(images)
        .values({
          id: newId(),
          requestId: id,
          itemId: itemRows[p]?.id ?? null,
          s3Key: key,
          contentType: "image/png",
          sizeBytes: body.length,
          position: p,
        })
        .run();
      photoCount++;
    }

    db.insert(timeWindows)
      .values(windows.map((w) => ({ id: newId(), requestId: id, ...w })))
      .run();
    for (const e of events.sort((a, b) => a.at - b.at))
      db.insert(requestEvents)
        .values({
          id: newId(e.at),
          requestId: id,
          employeeId: e.by ?? null,
          type: e.type,
          fromStatus: e.from ?? null,
          toStatus: e.to ?? null,
          note: e.note ?? null,
          createdAt: iso(e.at),
        })
        .run();

    if (i < 2)
      links.push({ status, name: `${first} ${last}`, url: `${env.APP_ORIGIN}/arende/${token}` });
  }
}

// A few customers who cancelled themselves (their requests are gone; only the reason is kept).
const reasons = [
  "Har sålt soffan på Blocket istället.",
  "Flytten blev uppskjuten.",
  "Grannen ville ha byrån.",
];
reasons.forEach((reason, i) => {
  const at = now - (i + 1) * 20 * HOUR;
  db.insert(cancellations)
    .values({
      id: newId(at),
      requestId: `DEMO${i}`,
      reason,
      items: pick(CATALOG).title,
      requestCreatedAt: iso(at - 30 * HOUR),
      cancelledAt: iso(at),
    })
    .run();
});

sqlite.close();
console.log(
  `Added ${n} demo requests with ${photoCount} photos, ${reasons.length} cancellations and 2 staff members.`,
);
for (const { status, count } of PLAN)
  console.log(`  ${STATUS_LABELS_SV[status].padEnd(13)} ${count}`);
console.log("\nCustomer status pages (2 per stage):");
for (const l of links)
  console.log(`  ${STATUS_LABELS_SV[l.status].padEnd(13)} ${l.name.padEnd(22)} ${l.url}`);
console.log("\nRemove again with: pnpm seed:demo --remove");
