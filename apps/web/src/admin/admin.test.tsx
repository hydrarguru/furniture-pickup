import type {
  AdminRequestDetail,
  AdminRequestListItem,
  NotificationSummary,
} from "@hamtning/shared";
import { addDays, stockholmToday } from "@hamtning/shared";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api.js";
import { AdminLayout } from "./AdminLayout.js";
import AdminRoot from "./AdminRoot.js";
import { adminApi } from "./api.js";
import { CategoriesPage } from "./pages/CategoriesPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RequestDetailPage } from "./pages/RequestDetailPage.js";
import { RequestListPage } from "./pages/RequestListPage.js";

vi.mock("./api.js", () => ({
  NOTIFICATION_STREAM_URL: "/stream",
  adminApi: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(async () => ({ ok: true })),
    listRequests: vi.fn(),
    getRequest: vi.fn(),
    changeStatus: vi.fn(),
    addNote: vi.fn(),
    summary: vi.fn(),
    categories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
  },
}));
const api = vi.mocked(adminApi);

/** Minimal EventSource stand-in the tests can push events through. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    act(() => {
      for (const fn of this.listeners.get(type) ?? [])
        fn(new MessageEvent(type, { data: JSON.stringify(data) }));
    });
  }
}

const summary = (o: Partial<NotificationSummary> = {}): NotificationSummary => ({
  unseenCount: 1,
  counts: { new: 2, in_progress: 1, accepted: 0, declined: 0, cancelled: 0 },
  latestUnseen: [],
  ...o,
});

const row = (o: Partial<AdminRequestListItem> = {}): AdminRequestListItem => ({
  id: "01K00000000000000000000001",
  status: "new",
  name: "Anna Andersson",
  city: "Göteborg",
  postcode: "41250",
  createdAt: "2026-10-13T08:00:00.000Z",
  verifiedAt: "2026-10-13T08:05:00.000Z",
  seen: false,
  itemSummary: "Soffa, 4 × Stolar",
  itemCount: 2,
  imageCount: 3,
  thumbnailUrl: null,
  ...o,
});

const pickup = addDays(stockholmToday(), 7);
const detail = (o: Partial<AdminRequestDetail> = {}): AdminRequestDetail => ({
  id: "01K00000000000000000000001",
  status: "new",
  name: "Anna Andersson",
  email: "anna@example.se",
  phone: "+46701234567",
  street: "Storgatan 1",
  postcode: "41250",
  city: "Göteborg",
  floor: 3,
  hasElevator: false,
  accessNotes: "Portkod 1234",
  message: null,
  createdAt: "2026-10-13T08:00:00.000Z",
  verifiedAt: "2026-10-13T08:05:00.000Z",
  confirmedStart: null,
  confirmedEnd: null,
  staffMessage: null,
  deleteAfter: null,
  items: [
    { id: "i1", title: "Soffa", category: null, condition: "good", quantity: 1, description: null },
  ],
  images: [{ id: "img1", url: "https://s3.test/a.jpg" }],
  timeWindows: [
    { id: "w1", date: pickup, part: "forenoon", fromTime: null, toTime: null, note: null },
  ],
  events: [],
  ...o,
});

function renderAdmin(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="admin" element={<AdminRoot />}>
          <Route path="logga-in" element={<LoginPage />} />
          <Route element={<AdminLayout />}>
            <Route index element={<RequestListPage />} />
            <Route path="arenden/:id" element={<RequestDetailPage />} />
            <Route path="kategorier" element={<CategoriesPage />} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const staff = { id: "e1", email: "sam@butik.se", name: "Sam Staff", role: "staff" as const };
const admin = { ...staff, name: "Ada Admin", role: "admin" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("EventSource", FakeEventSource);
  FakeEventSource.last = null;
  api.me.mockResolvedValue(staff);
  api.summary.mockResolvedValue(summary());
  api.listRequests.mockResolvedValue({ requests: [row()], nextCursor: null });
  api.getRequest.mockResolvedValue(detail());
});
afterEach(() => vi.unstubAllGlobals());

describe("auth", () => {
  it("sends unauthenticated staff to the login page and back after signing in", async () => {
    // Like the real server: 401 until a successful login (which seeds the cached "me").
    api.me.mockRejectedValue(new ApiError(401, "unauthenticated"));
    api.login
      .mockRejectedValueOnce(new ApiError(401, "invalid_credentials"))
      .mockResolvedValueOnce(staff);
    const user = userEvent.setup();
    renderAdmin("/admin?status=all");

    expect(await screen.findByRole("heading", { name: "Logga in" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("E-post"), "sam@butik.se");
    await user.type(screen.getByLabelText("Lösenord"), "fel");
    await user.click(screen.getByRole("button", { name: "Logga in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fel e-post eller lösenord.");

    await user.click(screen.getByRole("button", { name: "Logga in" }));
    expect(await screen.findByRole("heading", { name: "Ärenden" })).toBeInTheDocument();
    // Returned to the page originally asked for, filter included.
    await waitFor(() =>
      expect(api.listRequests).toHaveBeenCalledWith(expect.objectContaining({ status: "all" })),
    );
  });

  it("logs out", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin");
    const logout = await screen.findByRole("button", { name: "Logga ut" });
    api.me.mockRejectedValue(new ApiError(401, "unauthenticated")); // session is gone afterwards
    await user.click(logout);
    expect(api.logout).toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Logga in" })).toBeInTheDocument();
  });
});

describe("request list", () => {
  it("shows requests with status counts, defaulting to new ones", async () => {
    renderAdmin("/admin");
    expect(await screen.findByText("Soffa, 4 × Stolar")).toBeInTheDocument();
    expect(screen.getByTitle("Inte öppnad")).toBeInTheDocument();
    expect(api.listRequests).toHaveBeenCalledWith({ status: "new", q: "", cursor: undefined });
    const tab = await screen.findByRole("tab", { name: /Pågående/ });
    await waitFor(() => expect(tab).toHaveTextContent("Pågående1"));
  });

  it("switches tab and searches", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin");
    await screen.findByText("Anna Andersson");
    await user.click(screen.getByRole("tab", { name: /Godkända/ }));
    await waitFor(() =>
      expect(api.listRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "accepted" }),
      ),
    );
    await user.type(screen.getByRole("searchbox", { name: "Sök ärenden" }), "ekbord");
    await waitFor(() =>
      expect(api.listRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "accepted", q: "ekbord" }),
      ),
    );
  });

  it("loads more pages", async () => {
    api.listRequests
      .mockResolvedValueOnce({ requests: [row()], nextCursor: "c1" })
      .mockResolvedValueOnce({
        requests: [row({ id: "01K00000000000000000000002", name: "Bo Berg" })],
        nextCursor: null,
      });
    const user = userEvent.setup();
    renderAdmin("/admin");
    await user.click(await screen.findByRole("button", { name: "Visa fler" }));
    expect(await screen.findByText("Bo Berg")).toBeInTheDocument();
    expect(api.listRequests).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c1" }));
    expect(screen.queryByRole("button", { name: "Visa fler" })).not.toBeInTheDocument();
  });
});

describe("request detail", () => {
  const id = "01K00000000000000000000001";

  it("shows contact details, items and photos", async () => {
    renderAdmin(`/admin/arenden/${id}`);
    expect(await screen.findByRole("heading", { name: "Anna Andersson" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+46701234567" })).toHaveAttribute(
      "href",
      "tel:+46701234567",
    );
    expect(screen.getByText(/Våning 3 · ingen hiss/)).toBeInTheDocument();
    expect(screen.getByText("Portkod 1234")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa foto 1" })).toBeInTheDocument();
  });

  it("accepts using a proposed window", async () => {
    api.changeStatus.mockResolvedValue(detail({ status: "accepted" }));
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Godkänn…" }));
    // The first proposal is preselected.
    expect(screen.getByRole("radio", { name: /förmiddag 08:00–12:00/ })).toBeChecked();
    await user.type(screen.getByLabelText(/Meddelande till kunden/), "Vi ringer innan.");
    await user.click(screen.getByRole("button", { name: "Godkänn och meddela kunden" }));
    expect(api.changeStatus).toHaveBeenCalledWith(id, {
      status: "accepted",
      confirmed: { date: pickup, fromTime: "08:00", toTime: "12:00" },
      message: "Vi ringer innan.",
    });
    expect(await screen.findByText("Godkänd", { selector: ".status-badge" })).toBeInTheDocument();
  });

  it("validates a custom pickup time", async () => {
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Godkänn…" }));
    await user.click(screen.getByRole("radio", { name: "Annan tid" }));
    await user.click(screen.getByRole("button", { name: "Godkänn och meddela kunden" }));
    expect(screen.getByText("Ange datum, från och till.")).toBeInTheDocument();
    expect(api.changeStatus).not.toHaveBeenCalled();
  });

  it("declines with a message and shows server errors", async () => {
    api.changeStatus.mockRejectedValueOnce(new ApiError(409, "cancelled_by_requester"));
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Avslå…" }));
    await user.type(screen.getByLabelText(/Meddelande till kunden/), "Inga madrasser.");
    await user.click(screen.getByRole("button", { name: "Avslå och meddela kunden" }));
    expect(api.changeStatus).toHaveBeenCalledWith(id, {
      status: "declined",
      message: "Inga madrasser.",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunden har avbokat ärendet.");
  });

  it("offers no actions on a request the customer cancelled", async () => {
    api.getRequest.mockResolvedValue(detail({ status: "cancelled" }));
    renderAdmin(`/admin/arenden/${id}`);
    expect(await screen.findByText(/Kunden har avbokat förfrågan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Godkänn…" })).not.toBeInTheDocument();
  });

  it("adds an internal note and shows the history", async () => {
    api.addNote.mockResolvedValue(
      detail({
        events: [
          {
            id: "ev1",
            type: "note",
            fromStatus: null,
            toStatus: null,
            note: "Ringde, inget svar.",
            employeeName: "Sam Staff",
            createdAt: "2026-10-13T09:00:00.000Z",
          },
          {
            id: "ev0",
            type: "status_change",
            fromStatus: "unverified",
            toStatus: "new",
            note: "Bekräftad via e-post",
            employeeName: null,
            createdAt: "2026-10-13T08:05:00.000Z",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.type(await screen.findByLabelText("Ny anteckning"), "Ringde, inget svar.");
    await user.click(screen.getByRole("button", { name: "Spara anteckning" }));
    expect(api.addNote).toHaveBeenCalledWith(id, "Ringde, inget svar.");
    expect(
      await screen.findByText("Ringde, inget svar.", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Kunden/)).toBeInTheDocument();
    expect(screen.getByLabelText("Ny anteckning")).toHaveValue("");
  });
});

describe("live notifications", () => {
  it("updates the badge and title from the stream and toasts new requests", async () => {
    api.summary.mockResolvedValue(summary({ unseenCount: 0 }));
    renderAdmin("/admin");
    await screen.findByRole("heading", { name: "Ärenden" });
    const source = FakeEventSource.last as FakeEventSource;
    act(() => source.onopen?.());

    source.emit("summary", summary({ unseenCount: 2 }));
    expect(await screen.findByText("nya oöppnade")).toBeInTheDocument();
    expect(document.title).toBe("(2) Ärenden – Admin");

    api.listRequests.mockClear();
    source.emit("verified", { id: "01K00000000000000000000009", name: "Cia Ek", city: "Mölndal" });
    const toast = await screen.findByText(/från Cia Ek, Mölndal/);
    expect(within(toast).getByRole("link", { name: "Öppna" })).toHaveAttribute(
      "href",
      "/admin/arenden/01K00000000000000000000009",
    );
    await waitFor(() => expect(api.listRequests).toHaveBeenCalled());
  });

  it("tells staff when live updates are down", async () => {
    renderAdmin("/admin");
    await screen.findByRole("heading", { name: "Ärenden" });
    expect(screen.queryByText(/Live-uppdateringar/)).not.toBeInTheDocument();
    act(() => FakeEventSource.last?.onerror?.());
    expect(screen.getByText(/Live-uppdateringar är tillfälligt nere/)).toBeInTheDocument();
  });
});

describe("categories", () => {
  it("is hidden from staff", async () => {
    renderAdmin("/admin/kategorier");
    expect(await screen.findByRole("heading", { name: "Ärenden" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Kategorier" })).not.toBeInTheDocument();
  });

  it("lets admins add and deactivate categories", async () => {
    api.me.mockResolvedValue(admin);
    api.categories
      .mockResolvedValueOnce({
        categories: [{ id: 1, labelSv: "Soffor", sortOrder: 0, active: true }],
      })
      .mockResolvedValue({
        categories: [{ id: 1, labelSv: "Soffor", sortOrder: 0, active: false }],
      });
    api.createCategory.mockRejectedValueOnce(new ApiError(409, "duplicate_label"));
    api.updateCategory.mockResolvedValue({ id: 1, labelSv: "Soffor", sortOrder: 0, active: false });
    const user = userEvent.setup();
    renderAdmin("/admin/kategorier");

    await user.click(await screen.findByRole("checkbox", { name: "Soffor aktiv" }));
    expect(api.updateCategory).toHaveBeenCalledWith(1, { active: false });

    await user.type(screen.getByLabelText("Namn"), "Soffor");
    await user.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(api.createCategory).toHaveBeenCalledWith("Soffor", 0);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Det finns redan en kategori med det namnet.",
    );
  });
});
