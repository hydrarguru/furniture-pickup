import "@testing-library/jest-dom/vitest";
import "../lib/zod-locale.js";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom has no object URLs.
URL.createObjectURL = vi.fn(() => "blob:mock");
URL.revokeObjectURL = vi.fn();

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
