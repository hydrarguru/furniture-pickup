import type { RequestFormInput } from "@hamtning/shared";

// sessionStorage, not localStorage: the draft holds personal data and should die with the tab.
// It mainly protects against mobile browsers reloading the page after the camera app was open.
const KEY = "hamtning:draft:v1";

export function loadDraft(): Partial<RequestFormInput> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Partial<RequestFormInput>) : {};
  } catch {
    return {};
  }
}

export function saveDraft(values: Partial<RequestFormInput>) {
  try {
    // Photos cannot be restored after a reload, and consent must be given again.
    const { imageKeys: _imageKeys, consent: _consent, ...rest } = values;
    sessionStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    // Storage full or disabled (private mode); the form still works without a draft.
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Ignore, see saveDraft.
  }
}
