import type { RequestStatusView } from "@hamtning/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api.js";
import { StatusPage } from "./StatusPage.js";
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

  it("cancels after confirmation and shows the deletion date", async () => {
    mocked.getRequestStatus.mockResolvedValue(view());
    mocked.cancelRequest.mockResolvedValue(
      view({ status: "cancelled", canCancel: false, deleteAfter: "2026-11-12T10:00:00.000Z" }),
    );
    const user = userEvent.setup();
    renderAt(`/arende/${TOKEN}`);
    await user.click(await screen.findByRole("button", { name: "Avboka förfrågan" }));
    await user.click(screen.getByRole("button", { name: "Behåll förfrågan" }));
    expect(mocked.cancelRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Avboka förfrågan" }));
    await user.click(screen.getByRole("button", { name: "Ja, avboka" }));
    expect(await screen.findByText("Avbokad")).toBeInTheDocument();
    expect(mocked.cancelRequest).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText(/raderas automatiskt den 12 november/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Avboka/ })).not.toBeInTheDocument();
  });

  it("shows a not-found message for unknown links", async () => {
    mocked.getRequestStatus.mockRejectedValue(new api.ApiError(404, "not_found"));
    renderAt(`/arende/${TOKEN}`);
    expect(
      await screen.findByRole("heading", { name: "Ärendet hittades inte" }),
    ).toBeInTheDocument();
  });
});
