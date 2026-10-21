import { type RequestStatusView, STORE_PHONE } from "@hamtning/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api.js";
import { STATUS_REFRESH_MS, StatusPage } from "./StatusPage.js";
import { VerifyPage } from "./VerifyPage.js";

vi.mock("../lib/api.js", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  }
  return {
    ApiError,
    verifyRequest: vi.fn(),
    getRequestStatus: vi.fn(),
    cancelRequest: vi.fn(),
    resendVerification: vi.fn(),
  };
});
const mocked = vi.mocked(api);

const TOKEN = "t".repeat(43);

function renderAt(path: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<p>Formuläret</p>} />
          <Route path="/bekrafta/:token" element={<VerifyPage />} />
          <Route path="/arende/:token" element={<StatusPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

const view = (overrides: Partial<RequestStatusView> = {}): RequestStatusView => ({
  status: "new",
  createdAt: "2026-10-13T08:00:00.000Z",
  items: [
    { title: "Soffa", quantity: 1 },
    { title: "Stolar", quantity: 4 },
  ],
  timeWindows: [{ date: "2026-10-20", part: "forenoon", fromTime: null, toTime: null }],
  imageCount: 2,
  confirmedStart: null,
  confirmedEnd: null,
  staffMessage: null,
  deleteAfter: null,
  canCancel: true,
  timeline: [],
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("VerifyPage", () => {
  it("verifies once (even in StrictMode) and shows the status page", async () => {
    mocked.verifyRequest.mockResolvedValue({ status: "new" });
    mocked.getRequestStatus.mockResolvedValue(view());
    renderAt(`/bekrafta/${TOKEN}`);
    expect(
      await screen.findByText("Tack! Din förfrågan är bekräftad och skickad till oss."),
    ).toBeInTheDocument();
    expect(mocked.verifyRequest).toHaveBeenCalledTimes(1);
    expect(mocked.verifyRequest).toHaveBeenCalledWith(TOKEN);
  });

  it.each(["in_progress", "accepted", "declined", "cancelled"] as const)(
    "hides the thank-you banner once the request is %s",
    async (status) => {
      // E.g. the customer clicks the email link again after staff have started on it.
      mocked.verifyRequest.mockResolvedValue({ status });
      mocked.getRequestStatus.mockResolvedValue(view({ status, canCancel: false }));
      renderAt(`/bekrafta/${TOKEN}`);
      expect(await screen.findByRole("heading", { name: "Din förfrågan" })).toBeInTheDocument();
      expect(screen.queryByText(/Din förfrågan är bekräftad/)).not.toBeInTheDocument();
    },
  );

  it("explains an expired link", async () => {
    mocked.verifyRequest.mockRejectedValue(new api.ApiError(410, "expired"));
    renderAt(`/bekrafta/${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Länken har gått ut" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Till formuläret" })).toBeInTheDocument();
  });

  it("explains an invalid link", async () => {
    mocked.verifyRequest.mockRejectedValue(new api.ApiError(404, "not_found"));
    renderAt(`/bekrafta/${TOKEN}`);
    expect(await screen.findByText(/Länken är ogiltig/)).toBeInTheDocument();
  });
});

describe("StatusPage", () => {
  it("shows status, items and proposed times", async () => {
    mocked.getRequestStatus.mockResolvedValue(view());
    renderAt(`/arende/${TOKEN}`);
    expect(await screen.findByText("Mottagen")).toBeInTheDocument();
    expect(screen.getByText("4 × Stolar")).toBeInTheDocument();
    expect(screen.getByText("2 foton")).toBeInTheDocument();
    expect(screen.getByText(/tisdag 20 oktober, förmiddag 08–12/)).toBeInTheDocument();
    // Not shown unless arriving from the verification link.
    expect(screen.queryByText(/är bekräftad/)).not.toBeInTheDocument();
  });

  it("shows when the request reached each step", async () => {
    mocked.getRequestStatus.mockResolvedValue(
      view({
        status: "accepted",
        timeline: [
          { status: "new", at: "2026-10-13T08:05:00.000Z" },
          { status: "in_progress", at: "2026-10-14T07:30:00.000Z" },
          { status: "accepted", at: "2026-10-15T12:10:00.000Z" },
        ],
      }),
    );
    renderAt(`/arende/${TOKEN}`);
    const list = await screen.findByRole("list", { name: "Förlopp" });
    const steps = within(list).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual([
      "Mottagentisdag 13 oktober kl. 10:05",
      "Under behandlingonsdag 14 oktober kl. 09:30",
      "Godkändtorsdag 15 oktober kl. 14:10",
    ]);
    expect(steps[2]).toHaveClass("current");
  });

  it("leaves out the timeline before the request is confirmed", async () => {
    mocked.getRequestStatus.mockResolvedValue(view({ status: "unverified", timeline: [] }));
    renderAt(`/arende/${TOKEN}`);
    expect(await screen.findByText("Inte bekräftad")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Förlopp" })).not.toBeInTheDocument();
  });

  it("mails a new verification link when the customer asks", async () => {
    mocked.getRequestStatus.mockResolvedValue(view({ status: "unverified", timeline: [] }));
    mocked.resendVerification.mockResolvedValue({ ok: true });
    renderAt(`/arende/${TOKEN}`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Skicka bekräftelsemejlet igen" }),
    );
    expect(mocked.resendVerification).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByText(/Vi har skickat en ny länk/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Skicka bekräftelsemejlet igen" }),
    ).not.toBeInTheDocument();
  });

  it("asks the customer to wait when a link was just sent", async () => {
    mocked.getRequestStatus.mockResolvedValue(view({ status: "unverified", timeline: [] }));
    mocked.resendVerification.mockRejectedValue(new api.ApiError(429, "too_soon"));
    renderAt(`/arende/${TOKEN}`);
    await userEvent.click(
      await screen.findByRole("button", { name: "Skicka bekräftelsemejlet igen" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Vänta en minut");
    expect(screen.getByRole("button", { name: "Skicka bekräftelsemejlet igen" })).toBeEnabled();
  });

  it("offers no resend once the request is confirmed", async () => {
    mocked.getRequestStatus.mockResolvedValue(view());
    renderAt(`/arende/${TOKEN}`);
    expect(await screen.findByText("Mottagen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bekräftelsemejlet/ })).not.toBeInTheDocument();
  });

  it("tells the customer the pickup is on the way", async () => {
    mocked.getRequestStatus.mockResolvedValue(
      view({
        status: "on_the_way",
        confirmedStart: "2026-10-20T07:00:00.000Z",
        confirmedEnd: "2026-10-20T09:00:00.000Z",
        staffMessage: "Framme om ca 20 minuter.",
        timeline: [
          { status: "new", at: "2026-10-13T08:05:00.000Z" },
          { status: "accepted", at: "2026-10-15T12:10:00.000Z" },
          { status: "on_the_way", at: "2026-10-20T06:40:00.000Z" },
        ],
      }),
    );
    renderAt(`/arende/${TOKEN}`);
    expect(
      await screen.findByText("Vi är på väg till dig för att hämta sakerna."),
    ).toBeInTheDocument();
    expect(screen.getByText("Hämtning: tisdag 20 oktober kl. 09:00–11:00")).toBeInTheDocument();
    expect(screen.getByText("Framme om ca 20 minuter.")).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Förlopp" })).getAllByRole("listitem");
    expect(steps.at(-1)).toHaveTextContent("På vägtisdag 20 oktober kl. 08:40");
  });

  describe("while open", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it("picks up status changes from the store and announces them", async () => {
      mocked.getRequestStatus.mockResolvedValue(view({ status: "accepted", canCancel: true }));
      renderAt(`/arende/${TOKEN}`);
      expect(await screen.findByText("Vi hämtar gärna sakerna.")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("");

      mocked.getRequestStatus.mockResolvedValue(view({ status: "on_the_way" }));
      await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);
      expect(
        await screen.findByText("Vi är på väg till dig för att hämta sakerna."),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Ärendet har uppdaterats: På väg");
    });

    it("keeps the page when a check fails and stops checking in a hidden tab", async () => {
      mocked.getRequestStatus.mockResolvedValue(view());
      renderAt(`/arende/${TOKEN}`);
      expect(await screen.findByText("Mottagen")).toBeInTheDocument();

      mocked.getRequestStatus.mockRejectedValue(new Error("offline"));
      await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);
      expect(screen.getByText("Mottagen")).toBeInTheDocument();

      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      mocked.getRequestStatus.mockResolvedValue(view({ status: "in_progress" }));
      await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);
      const calls = mocked.getRequestStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS * 3);
      expect(mocked.getRequestStatus.mock.calls.length).toBe(calls);

      // Coming back to the tab checks straight away.
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(await screen.findByText("Under behandling")).toBeInTheDocument();
    });

    it("shows the not-found message once the request has been deleted", async () => {
      mocked.getRequestStatus.mockResolvedValue(view());
      renderAt(`/arende/${TOKEN}`);
      expect(await screen.findByText("Mottagen")).toBeInTheDocument();
      mocked.getRequestStatus.mockRejectedValue(new api.ApiError(404, "not_found"));
      await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);
      expect(await screen.findByText("Ärendet hittades inte")).toBeInTheDocument();
    });
  });

  it("shows the confirmed time and staff message for an accepted request", async () => {
    mocked.getRequestStatus.mockResolvedValue(
      view({
        status: "accepted",
        confirmedStart: "2026-10-20T07:00:00.000Z",
        confirmedEnd: "2026-10-20T09:00:00.000Z",
        staffMessage: "Vi ringer när vi är på väg.",
      }),
    );
    renderAt(`/arende/${TOKEN}`);
    // 07:00Z is 09:00 in Stockholm (summer time).
    expect(
      await screen.findByText("Hämtning: tisdag 20 oktober kl. 09:00–11:00"),
    ).toBeInTheDocument();
    expect(screen.getByText("Vi ringer när vi är på väg.")).toBeInTheDocument();
  });

  it("cancels with a reason, which deletes the request", async () => {
    mocked.getRequestStatus.mockResolvedValue(view());
    mocked.cancelRequest.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderAt(`/arende/${TOKEN}`);
    await user.click(await screen.findByRole("button", { name: "Avboka förfrågan" }));
    await user.click(screen.getByRole("button", { name: "Behåll förfrågan" }));
    expect(mocked.cancelRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Avboka förfrågan" }));
    await user.click(screen.getByRole("button", { name: "Avboka och radera" }));
    const reason = screen.getByLabelText("Varför vill du avboka?");
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Berätta kort varför du avbokar")).toBeInTheDocument();
    expect(mocked.cancelRequest).not.toHaveBeenCalled();

    await user.type(reason, "  Har sålt soffan själv. ");
    await user.click(screen.getByRole("button", { name: "Avboka och radera" }));
    expect(
      await screen.findByRole("heading", { name: "Förfrågan är avbokad" }),
    ).toBeInTheDocument();
    expect(mocked.cancelRequest).toHaveBeenCalledWith(TOKEN, "Har sålt soffan själv.");
    expect(screen.getByText("Vi har raderat din förfrågan och dina foton.")).toBeInTheDocument();
  });

  it.each(["in_progress", "accepted", "on_the_way"] as const)(
    "asks the customer to call the store once the request is %s",
    async (status) => {
      mocked.getRequestStatus.mockResolvedValue(view({ status, canCancel: false }));
      const user = userEvent.setup();
      renderAt(`/arende/${TOKEN}`);
      await user.click(await screen.findByRole("button", { name: "Avboka eller ändra" }));
      expect(screen.getByText(/Vill du avboka eller ändra något/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: STORE_PHONE.display })).toHaveAttribute(
        "href",
        `tel:${STORE_PHONE.e164}`,
      );
      expect(screen.queryByLabelText("Varför vill du avboka?")).not.toBeInTheDocument();
    },
  );

  it.each(["declined", "cancelled"] as const)("offers no cancelling when %s", async (status) => {
    mocked.getRequestStatus.mockResolvedValue(view({ status, canCancel: false }));
    renderAt(`/arende/${TOKEN}`);
    await screen.findByText(/Din förfrågan/);
    expect(screen.queryByRole("button", { name: /Avboka/ })).not.toBeInTheDocument();
  });

  it("switches to the phone number when staff started on it before the cancel went through", async () => {
    mocked.getRequestStatus.mockResolvedValue(view());
    mocked.cancelRequest.mockRejectedValue(new api.ApiError(409, "not_cancellable"));
    const user = userEvent.setup();
    renderAt(`/arende/${TOKEN}`);
    await user.click(await screen.findByRole("button", { name: "Avboka förfrågan" }));
    await user.type(screen.getByLabelText("Varför vill du avboka?"), "Ångrat mig.");
    mocked.getRequestStatus.mockResolvedValue(view({ status: "in_progress", canCancel: false }));
    await user.click(screen.getByRole("button", { name: "Avboka och radera" }));
    expect(await screen.findByRole("button", { name: "Avboka eller ändra" })).toBeInTheDocument();
    expect(screen.getByText("Under behandling", { selector: ".status-label" })).toBeInTheDocument();
  });

  it("shows a not-found message for unknown links", async () => {
    mocked.getRequestStatus.mockRejectedValue(new api.ApiError(404, "not_found"));
    renderAt(`/arende/${TOKEN}`);
    expect(
      await screen.findByRole("heading", { name: "Ärendet hittades inte" }),
    ).toBeInTheDocument();
  });
});
