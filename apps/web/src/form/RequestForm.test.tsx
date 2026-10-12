import { addDays, stockholmToday } from "@hamtning/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api.js";
import { RequestForm } from "./RequestForm.js";

vi.mock("../lib/api.js", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  }
  let n = 0;
  return {
    ApiError,
    getCategories: vi.fn(async () => []),
    presignUploads: vi.fn(async (files: { contentType: string; size: number }[]) => ({
      uploads: files.map((f) => ({ ...f, key: `uploads/K${++n}.jpg`, url: "https://s3.test/put" })),
    })),
    uploadFile: vi.fn(async (_url, _blob, _type, onProgress: (p: number) => void) => {
      onProgress(1);
    }),
    submitRequest: vi.fn(async () => ({ id: "r1" })),
  };
});

// Canvas/createImageBitmap don't exist in jsdom; image processing is a pass-through here.
vi.mock("../lib/images.js", () => ({
  ImageError: class extends Error {},
  prepareImage: vi.fn(async () => new Blob(["x"], { type: "image/jpeg" })),
}));

const mocked = vi.mocked(api);
const inDays = (n: number) => addDays(stockholmToday(), n);
const photo = (name = "soffa.jpg") => new File(["x"], name, { type: "image/jpeg" });

function renderForm() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<RequestForm />} />
        <Route path="/tack" element={<p>Tacksidan</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const heading = () => screen.getByRole("heading", { level: 2 });
const next = (user: UserEvent) => user.click(screen.getByRole("button", { name: "Nästa" }));

async function fillContact(user: UserEvent) {
  await user.type(screen.getByLabelText("Namn"), "Anna Andersson");
  await user.type(screen.getByLabelText("E-post"), "anna@example.se");
  await user.type(screen.getByLabelText("Telefon"), "070-123 45 67");
  await user.type(screen.getByLabelText("Gatuadress"), "Storgatan 1");
  await user.type(screen.getByLabelText("Postnummer"), "412 50");
  await user.type(screen.getByLabelText("Ort"), "Göteborg");
}

async function fillItemsWithPhoto(user: UserEvent) {
  await user.type(screen.getByLabelText("Vad är det?"), "Soffa");
  await user.upload(screen.getByLabelText("Lägg till foton"), photo());
  await screen.findByText("Uppladdad");
}

async function fillPickup(user: UserEvent, date = inDays(7)) {
  fireEvent.change(screen.getByLabelText("Datum"), { target: { value: date } });
  await user.click(screen.getByLabelText(/Förmiddag/));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequestForm", () => {
  it("shows Swedish errors and stays on step 1 when contact details are missing", async () => {
    const user = userEvent.setup();
    renderForm();
    await next(user);
    expect(heading()).toHaveTextContent("Dina uppgifter");
    expect(screen.getAllByText("Obligatoriskt fält").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Ange en giltig e-postadress")).toBeInTheDocument();
    expect(screen.getByText("Ange ett giltigt telefonnummer")).toBeInTheDocument();
    expect(screen.getByText("Ange ett giltigt postnummer (5 siffror)")).toBeInTheDocument();
    expect(screen.getByLabelText("Namn")).toHaveAttribute("aria-invalid", "true");
  });

  it("requires at least one photo before leaving the items step", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    expect(heading()).toHaveTextContent("Föremål och foton");

    await user.type(screen.getByLabelText("Vad är det?"), "Soffa");
    await next(user);
    expect(heading()).toHaveTextContent("Föremål och foton");
    expect(screen.getByText("Minst ett foto krävs")).toBeInTheDocument();

    // The error clears as soon as an upload finishes.
    await user.upload(screen.getByLabelText("Lägg till foton"), photo());
    await screen.findByText("Uppladdad");
    await waitFor(() => expect(screen.queryByText("Minst ett foto krävs")).not.toBeInTheDocument());
    await next(user);
    expect(heading()).toHaveTextContent("Hämtning");
  });

  it("lets the user retry a failed upload", async () => {
    mocked.uploadFile.mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await user.upload(screen.getByLabelText("Lägg till foton"), photo());
    expect(await screen.findByText("Uppladdningen misslyckades.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Försök igen" }));
    expect(await screen.findByText("Uppladdad")).toBeInTheDocument();
    expect(mocked.presignUploads).toHaveBeenCalledTimes(2);
  });

  it("caps the number of photos at 8", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    const files = Array.from({ length: 9 }, (_, i) => photo(`p${i}.jpg`));
    await user.upload(screen.getByLabelText("Lägg till foton"), files);
    expect(await screen.findByText("Du kan ladda upp högst 8 foton.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Uppladdad")).toHaveLength(8));
    // The add button disappears when the limit is reached.
    expect(screen.queryByLabelText(/Lägg till/)).not.toBeInTheDocument();
  });

  it("removing a photo frees a slot and drops its key", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await fillItemsWithPhoto(user);
    await user.click(screen.getByRole("button", { name: "Ta bort foto 1" }));
    await next(user);
    expect(screen.getByText("Minst ett foto krävs")).toBeInTheDocument();
  });

  it("rejects pickup dates that are too soon", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await fillItemsWithPhoto(user);
    await next(user);
    await fillPickup(user, inDays(1));
    await next(user);
    expect(heading()).toHaveTextContent("Hämtning");
    expect(screen.getByText("Välj ett datum 2–60 dagar framåt")).toBeInTheDocument();
  });

  it("shows time fields for a custom window and checks their order", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await fillItemsWithPhoto(user);
    await next(user);
    fireEvent.change(screen.getByLabelText("Datum"), { target: { value: inDays(7) } });
    expect(screen.queryByLabelText("Från")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Egen tid/));
    fireEvent.change(screen.getByLabelText("Från"), { target: { value: "15:00" } });
    fireEvent.change(screen.getByLabelText("Till"), { target: { value: "13:00" } });
    await next(user);
    expect(screen.getByText("Ange en från-tid som är före till-tiden")).toBeInTheDocument();
  });

  it("allows at most three time windows", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await fillItemsWithPhoto(user);
    await next(user);
    const add = () => user.click(screen.getByRole("button", { name: "Föreslå en till tid" }));
    await add();
    await add();
    expect(screen.getAllByLabelText("Datum")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Föreslå en till tid" })).not.toBeInTheDocument();
  });

  it("submits a normalized request and shows the thank-you page", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await fillItemsWithPhoto(user);
    await next(user);
    await fillPickup(user);
    await next(user);

    expect(heading()).toHaveTextContent("Granska och skicka");
    const summary = screen.getByText(/Anna Andersson/);
    expect(summary).toHaveTextContent("412 50 Göteborg");

    await user.click(screen.getByRole("button", { name: "Skicka förfrågan" }));
    expect(screen.getByText(/Du måste godkänna/)).toBeInTheDocument();
    expect(mocked.submitRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Skicka förfrågan" }));

    expect(await screen.findByText("Tacksidan")).toBeInTheDocument();
    expect(mocked.submitRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Anna Andersson",
        email: "anna@example.se",
        phone: "+46701234567",
        postcode: "41250",
        consent: true,
        imageKeys: [expect.stringMatching(/^uploads\//)],
        items: [expect.objectContaining({ title: "Soffa", quantity: 1 })],
        timeWindows: [expect.objectContaining({ date: inDays(7), part: "forenoon" })],
      }),
    );
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps the user on the review step with a message when sending fails", async () => {
    mocked.submitRequest.mockRejectedValueOnce(new api.ApiError(500, "internal_error"));
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await fillItemsWithPhoto(user);
    await next(user);
    await fillPickup(user);
    await next(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Skicka förfrågan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Något gick fel");
    expect(heading()).toHaveTextContent("Granska och skicka");
  });

  it("jumps back to the right step from the review", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    await fillItemsWithPhoto(user);
    await next(user);
    await fillPickup(user);
    await next(user);
    await user.click(screen.getByRole("button", { name: "Ändra föremål" }));
    expect(heading()).toHaveTextContent("Föremål och foton");
    expect(heading()).toHaveFocus();
  });

  it("shows the category dropdown only when categories exist", async () => {
    mocked.getCategories.mockResolvedValueOnce([{ id: 3, label: "Soffor" }]);
    const user = userEvent.setup();
    renderForm();
    await fillContact(user);
    await next(user);
    const select = await screen.findByLabelText(/Kategori/);
    expect(within(select).getByRole("option", { name: "Soffor" })).toBeInTheDocument();
  });

  it("restores typed details after a reload but not consent or photos", async () => {
    const user = userEvent.setup();
    const { unmount } = renderForm();
    await user.type(screen.getByLabelText("Namn"), "Anna");
    await user.type(screen.getByLabelText("Ort"), "Göteborg");
    unmount();
    // afterEach clears storage, so check it before re-rendering.
    const draft = JSON.parse(sessionStorage.getItem("hamtning:draft:v1") ?? "{}");
    expect(draft).not.toHaveProperty("imageKeys");
    expect(draft).not.toHaveProperty("consent");

    renderForm();
    expect(screen.getByLabelText("Namn")).toHaveValue("Anna");
    expect(screen.getByLabelText("Ort")).toHaveValue("Göteborg");
  });
});
