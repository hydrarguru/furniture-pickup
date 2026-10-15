import type {
  AdminRequestDetail,
  AdminRequestListItem,
  NotificationSummary,
} from "@hamtning/shared";
import { addDays, stockholmToday } from "@hamtning/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    requestLocation: vi.fn(),
    changeStatus: vi.fn(),
    addNote: vi.fn(),
    deleteRequest: vi.fn(),
    summary: vi.fn(),
    cancellations: vi.fn(),
    categories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
  },
}));
const api = vi.mocked(adminApi);

// jsdom has no layout for Leaflet to draw into; the map itself is checked in a browser.
vi.mock("./pages/LocationMap.js", () => ({
  default: ({
    location,
    compact,
  }: {
    location: { lat: number; lon: number };
    compact?: boolean;
  }) => (
    <div data-testid={compact ? "map-preview" : "map"}>
      {location.lat},{location.lon}
    </div>
  ),
}));

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
  counts: { new: 2, in_progress: 1, accepted: 0, on_the_way: 0, declined: 0, cancelled: 0 },
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
  deleteAfter: null,
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
  api.requestLocation.mockResolvedValue({ lat: 57.7, lon: 11.97, precision: "address" });
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

  it("warns about open requests close to automatic deletion", async () => {
    const soon = new Date(Date.now() + 1.5 * 864e5).toISOString();
    const later = new Date(Date.now() + 6.5 * 864e5).toISOString();
    api.listRequests.mockResolvedValue({
      requests: [
        row({ name: "Snart Borta", deleteAfter: soon }),
        row({ id: "01K00000000000000000000002", name: "Gott Om Tid", deleteAfter: later }),
      ],
      nextCursor: null,
    });
    renderAdmin("/admin");
    expect(await screen.findByText("· raderas om 1 dag")).toBeInTheDocument();
    expect(screen.getAllByText(/raderas om/)).toHaveLength(1);
  });

  it("has a tab for pickups that are on the way", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin");
    await user.click(await screen.findByRole("tab", { name: /På väg/ }));
    await waitFor(() =>
      expect(api.listRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "on_the_way" }),
      ),
    );
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

  it("tells staff when an open request will be deleted and how to postpone it", async () => {
    api.getRequest.mockResolvedValue(
      detail({ deleteAfter: new Date(Date.now() + 2.5 * 864e5).toISOString() }),
    );
    renderAdmin(`/admin/arenden/${id}`);
    expect(await screen.findByText(/raderas om 2 dagar/)).toHaveTextContent(
      "En anteckning eller statusändring skjuter upp det 7 dagar.",
    );
  });

  it("closes the photo viewer on a click outside it, but not on the photo or inside it", async () => {
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Visa foto 1" }));
    // jsdom doesn't really open <dialog>, so query by alt text rather than accessible role.
    const photo = screen.getByAltText("Foto 1 av 1");
    const dialog = photo.closest("dialog") as HTMLDialogElement;
    // jsdom has no layout; give the dialog a box in the middle of the screen.
    dialog.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 100, y: 100, width: 600, height: 400 });

    fireEvent.click(photo, { clientX: 300, clientY: 300 });
    fireEvent.click(dialog, { clientX: 105, clientY: 105 }); // the dialog's own padding
    expect(screen.getByAltText("Foto 1 av 1")).toBeInTheDocument();

    fireEvent.click(dialog, { clientX: 20, clientY: 20 }); // the backdrop
    expect(screen.queryByAltText("Foto 1 av 1")).not.toBeInTheDocument();
  });

  it("puts the toolbar above the photo and closes with the red icon button", async () => {
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Visa foto 1" }));
    const photo = screen.getByAltText("Foto 1 av 1");
    const dialog = photo.closest("dialog") as HTMLDialogElement;
    const close = within(dialog).getByRole("button", { name: "Stäng", hidden: true });
    expect(close).toHaveClass("danger");
    expect(close).toHaveTextContent(""); // icon only, the name comes from aria-label
    expect(close.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // The toolbar comes before the photo in the dialog.
    const bar = dialog.querySelector(".lightbox-bar") as HTMLElement;
    expect(bar.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(close);
    expect(screen.queryByAltText("Foto 1 av 1")).not.toBeInTheDocument();
  });

  it("accepts using a proposed window", async () => {
    api.changeStatus.mockResolvedValue(detail({ status: "accepted" }));
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Godkänn" }));
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

  it("marks an accepted pickup as on the way with an optional message", async () => {
    const accepted = detail({
      status: "accepted",
      confirmedStart: `${pickup}T07:00:00.000Z`,
      confirmedEnd: `${pickup}T09:00:00.000Z`,
    });
    api.getRequest.mockResolvedValue(accepted);
    api.changeStatus.mockResolvedValue({ ...accepted, status: "on_the_way" });
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Markera som på väg" }));
    await user.type(screen.getByLabelText(/Meddelande till kunden/), "Framme om 20 min.");
    await user.click(screen.getByRole("button", { name: "Meddela kunden att ni är på väg" }));
    expect(api.changeStatus).toHaveBeenCalledWith(id, {
      status: "on_the_way",
      message: "Framme om 20 min.",
    });
    expect(
      await screen.findByText("Kunden har fått besked om att ni är på väg."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hämtning:/)).toBeInTheDocument();
    // Can't be sent twice, but the time can still be changed.
    expect(screen.queryByRole("button", { name: "Markera som på väg" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ändra hämtningstid" })).toBeInTheDocument();
  });

  it("only offers on the way for accepted requests", async () => {
    renderAdmin(`/admin/arenden/${id}`);
    await screen.findByRole("button", { name: "Godkänn" });
    expect(screen.queryByRole("button", { name: "Markera som på väg" })).not.toBeInTheDocument();
  });

  it("validates a custom pickup time", async () => {
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Godkänn" }));
    await user.click(screen.getByRole("radio", { name: "Annan tid" }));
    await user.click(screen.getByRole("button", { name: "Godkänn och meddela kunden" }));
    expect(screen.getByText("Ange datum, från och till.")).toBeInTheDocument();
    expect(api.changeStatus).not.toHaveBeenCalled();
  });

  it("declines with a message and shows server errors", async () => {
    api.changeStatus.mockRejectedValueOnce(new ApiError(409, "cancelled_by_requester"));
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Avslå" }));
    await user.type(screen.getByLabelText(/Meddelande till kunden/), "Inga madrasser.");
    await user.click(screen.getByRole("button", { name: "Avslå och meddela kunden" }));
    expect(api.changeStatus).toHaveBeenCalledWith(id, {
      status: "declined",
      message: "Inga madrasser.",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunden har avbokat ärendet.");
  });

  it("shows why a declined request was declined and offers no way to accept it", async () => {
    api.getRequest.mockResolvedValue(
      detail({
        status: "declined",
        staffMessage: "Vi tar inte emot madrasser.",
        events: [
          {
            id: "e2",
            type: "status_change",
            fromStatus: "in_progress",
            toStatus: "declined",
            note: "Vi tar inte emot madrasser.",
            employeeName: "Sam Staff",
            createdAt: "2026-10-13T12:30:00.000Z",
          },
        ],
      }),
    );
    renderAdmin(`/admin/arenden/${id}`);
    const banner = (await screen.findByText("Ärendet är nekat")).closest("section");
    expect(banner).toHaveClass("actions", "declined");
    expect(banner).toHaveTextContent("Avslogs");
    expect(banner).toHaveTextContent("av Sam Staff");
    expect(banner).toHaveTextContent("Anledning: Vi tar inte emot madrasser.");
    expect(screen.queryByRole("button", { name: /Godkänn/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Avslå" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Återställ/ })).not.toBeInTheDocument();
  });

  it("says when no reason was given for declining", async () => {
    api.getRequest.mockResolvedValue(detail({ status: "declined", staffMessage: null }));
    renderAdmin(`/admin/arenden/${id}`);
    const banner = (await screen.findByText("Ärendet är nekat")).closest("section");
    expect(banner).toHaveTextContent("Anledning: Ingen angavs.");
  });

  it("offers no actions on a request the customer cancelled", async () => {
    api.getRequest.mockResolvedValue(detail({ status: "cancelled" }));
    renderAdmin(`/admin/arenden/${id}`);
    expect(await screen.findByText(/Kunden har avbokat förfrågan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Godkänn" })).not.toBeInTheDocument();
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

describe("address map", () => {
  const id = "01K00000000000000000000001";
  const openMap = async () => {
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Förstora karta" }));
    // jsdom doesn't really open <dialog>, so query inside it with hidden: true.
    return screen.getByLabelText("Karta", { selector: "dialog" });
  };

  it("shows a small map in the panel and enlarges it in a dialog", async () => {
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    expect(await screen.findByTestId("map-preview")).toHaveTextContent("57.7,11.97");
    expect(api.requestLocation).toHaveBeenCalledWith(id);
    const dialog = screen.getByLabelText("Karta", { selector: "dialog" });
    expect(within(dialog).queryByTestId("map")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Förstora karta" }));
    expect(await within(dialog).findByTestId("map")).toHaveTextContent("57.7,11.97");
    // Opening the dialog reuses the lookup.
    expect(api.requestLocation).toHaveBeenCalledTimes(1);
  });

  it("shows the address on the map with directions", async () => {
    api.requestLocation.mockResolvedValue({ lat: 57.7, lon: 11.97, precision: "address" });
    const dialog = await openMap();
    expect(await within(dialog).findByTestId("map")).toHaveTextContent("57.7,11.97");
    expect(api.requestLocation).toHaveBeenCalledWith(id);
    expect(within(dialog).getByText("Storgatan 1, 412 50 Göteborg")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Vägbeskrivning (Google Maps)", hidden: true }),
    ).toHaveAttribute(
      "href",
      "https://www.google.com/maps/dir/?api=1&destination=Storgatan%201%2C%20412%2050%20G%C3%B6teborg",
    );
    expect(
      within(dialog).getByRole("link", { name: "Öppna i OpenStreetMap", hidden: true }),
    ).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/?mlat=57.7&mlon=11.97#map=17/57.7/11.97",
    );
    expect(within(dialog).queryByText(/Gatan hittades inte/)).not.toBeInTheDocument();
  });

  it("says when only the postcode area was found", async () => {
    api.requestLocation.mockResolvedValue({ lat: 57.7, lon: 11.97, precision: "area" });
    const dialog = await openMap();
    expect(await within(dialog).findByText(/Gatan hittades inte/)).toBeInTheDocument();
    expect(await within(dialog).findByTestId("map")).toBeInTheDocument();
  });

  it("offers directions in the panel when the address isn't found", async () => {
    api.requestLocation.mockResolvedValue(null);
    renderAdmin(`/admin/arenden/${id}`);
    expect(await screen.findByText("Adressen hittades inte på kartan.")).toBeInTheDocument();
    expect(screen.queryByTestId("map-preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Förstora karta" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vägbeskrivning (Google Maps)" })).toBeInTheDocument();
  });

  it("explains in the panel when the lookup fails", async () => {
    api.requestLocation.mockRejectedValue(new ApiError(502, "geocoder_unavailable"));
    renderAdmin(`/admin/arenden/${id}`);
    // Server errors are retried once before the message shows.
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      /Kartan kunde inte laddas/,
    );
    expect(screen.queryByRole("button", { name: "Förstora karta" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vägbeskrivning (Google Maps)" })).toBeInTheDocument();
  });

  it("closes the enlarged map", async () => {
    const dialog = await openMap();
    expect(await within(dialog).findByTestId("map")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Stäng", hidden: true }));
    expect(within(dialog).queryByTestId("map")).not.toBeInTheDocument();
  });

  it("has an icon-only enlarge button", async () => {
    renderAdmin(`/admin/arenden/${id}`);
    const enlarge = await screen.findByRole("button", { name: "Förstora karta" });
    expect(enlarge).toHaveTextContent("");
    expect(enlarge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("manual delete", () => {
  const id = "01K00000000000000000000001";

  it("asks for confirmation, deletes and returns to the list", async () => {
    api.deleteRequest.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Radera ärende" }));
    expect(screen.getByText(/raderas permanent/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(api.deleteRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Radera ärende" }));
    await user.click(screen.getByRole("button", { name: "Radera permanent" }));
    expect(api.deleteRequest).toHaveBeenCalledWith(id);
    expect(await screen.findByText("Ärendet för Anna Andersson har raderats.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ärenden" })).toBeInTheDocument();
  });

  it("stays on the request and explains when deletion fails", async () => {
    api.deleteRequest.mockRejectedValue(new ApiError(500, "internal_error"));
    const user = userEvent.setup();
    renderAdmin(`/admin/arenden/${id}`);
    await user.click(await screen.findByRole("button", { name: "Radera ärende" }));
    await user.click(screen.getByRole("button", { name: "Radera permanent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("kunde inte raderas");
    expect(screen.getByRole("heading", { name: "Anna Andersson" })).toBeInTheDocument();
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

  it("toasts customer cancellations and refreshes an open request, which is now gone", async () => {
    const id = "01K00000000000000000000009";
    api.getRequest.mockResolvedValue(detail({ id }));
    api.cancellations.mockResolvedValue([]);
    renderAdmin(`/admin/arenden/${id}`);
    await screen.findByRole("heading", { name: "Anna Andersson" });

    api.getRequest.mockRejectedValue(new ApiError(404, "not_found"));
    FakeEventSource.last?.emit("cancelled", { id });
    const toast = await screen.findByText(/En kund avbokade/);
    expect(within(toast.parentElement as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/admin?status=cancellations",
    );
    expect(await screen.findByText(/har raderats/)).toBeInTheDocument();
  });

  it("tells staff when live updates are down", async () => {
    renderAdmin("/admin");
    await screen.findByRole("heading", { name: "Ärenden" });
    expect(screen.queryByText(/Live-uppdateringar/)).not.toBeInTheDocument();
    act(() => FakeEventSource.last?.onerror?.());
    expect(screen.getByText(/Live-uppdateringar är tillfälligt nere/)).toBeInTheDocument();
  });
});

describe("cancellations", () => {
  it("shows why customers cancelled under the Avbokade tab, searchable", async () => {
    api.cancellations.mockResolvedValue([
      {
        id: "c1",
        reason: "Har sålt soffan själv.",
        items: "Soffa, 4 × Stolar",
        requestCreatedAt: "2026-10-10T08:00:00.000Z",
        cancelledAt: "2026-10-12T14:30:00.000Z",
      },
      {
        id: "c2",
        reason: "Flyttar inte ändå.",
        items: "Bokhylla",
        requestCreatedAt: "2026-10-09T08:00:00.000Z",
        cancelledAt: "2026-10-11T10:00:00.000Z",
      },
    ]);
    const user = userEvent.setup();
    renderAdmin("/admin");
    expect(screen.queryByRole("link", { name: "Avbokningar" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("tab", { name: "Avbokade" }));
    expect(screen.getByRole("tab", { name: "Avbokade" })).toHaveAttribute("aria-selected", "true");
    const [, first] = await screen.findAllByRole("row");
    expect(first).toHaveTextContent("Har sålt soffan själv.");
    expect(first).toHaveTextContent("Soffa, 4 × Stolar");
    expect(screen.getAllByRole("row")).toHaveLength(3);

    await user.type(screen.getByRole("searchbox", { name: "Sök avbokningar" }), "bokhylla");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(screen.getByText("Flyttar inte ändå.")).toBeInTheDocument();
  });

  it("says when there are none", async () => {
    api.cancellations.mockResolvedValue([]);
    renderAdmin("/admin?status=cancellations");
    expect(await screen.findByText("Inga avbokningar de senaste 30 dagarna.")).toBeInTheDocument();
    expect(api.listRequests).not.toHaveBeenCalled();
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
        categories: [{ id: 1, labelSv: "Soffor", active: true }],
      })
      .mockResolvedValue({
        categories: [{ id: 1, labelSv: "Soffor", active: false }],
      });
    api.createCategory.mockRejectedValueOnce(new ApiError(409, "duplicate_label"));
    api.updateCategory.mockResolvedValue({ id: 1, labelSv: "Soffor", active: false });
    const user = userEvent.setup();
    renderAdmin("/admin/kategorier");

    await user.click(await screen.findByRole("checkbox", { name: "Soffor aktiv" }));
    expect(api.updateCategory).toHaveBeenCalledWith(1, { active: false });

    await user.type(screen.getByLabelText("Namn"), "Soffor");
    await user.click(screen.getByRole("button", { name: "Lägg till" }));
    expect(api.createCategory).toHaveBeenCalledWith("Soffor");
    expect(screen.queryByLabelText("Sortering")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Det finns redan en kategori med det namnet.",
    );
  });
});
