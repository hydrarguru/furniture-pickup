import type { RequestForm, RequestStatus, RequestStatusView } from "@hamtning/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API ${status}: ${code}`);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let code = "http_error";
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // Non-JSON error body (e.g. from nginx); keep the generic code.
    }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export interface Category {
  id: number;
  label: string;
}

export const getCategories = () =>
  request<{ categories: Category[] }>("/api/categories").then((r) => r.categories);

export interface PresignedUpload {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

export const presignUploads = (
  files: { contentType: string; size: number }[],
  signal?: AbortSignal,
) =>
  request<{ uploads: PresignedUpload[] }>("/api/uploads/presign", {
    method: "POST",
    body: JSON.stringify({ files }),
    signal,
  });

/** PUTs a file to a presigned URL. Uses XHR because fetch has no upload progress. */
export function uploadFile(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Must match the signed Content-Type; the browser sets Content-Length from the blob.
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, "upload_failed"));
    xhr.onerror = () => reject(new ApiError(0, "network_error"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

export const submitRequest = (values: RequestForm, altchaPayload: string) =>
  request<{ ok: true; statusToken: string }>("/api/requests", {
    method: "POST",
    body: JSON.stringify({ ...values, altchaPayload }),
  });

export const verifyRequest = (token: string) =>
  request<{ status: RequestStatus }>("/api/requests/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

export const getRequestStatus = (token: string) =>
  request<RequestStatusView>(`/api/requests/by-token/${encodeURIComponent(token)}`);

/** Deletes the request. Only possible before staff have started on it. */
export const cancelRequest = (token: string, reason: string) =>
  request<{ ok: true }>(`/api/requests/by-token/${encodeURIComponent(token)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

/** Mails a fresh verification link to the address on the request. Only while unverified. */
export const resendVerification = (token: string) =>
  request<{ ok: true }>(`/api/requests/by-token/${encodeURIComponent(token)}/resend-verification`, {
    method: "POST",
  });
