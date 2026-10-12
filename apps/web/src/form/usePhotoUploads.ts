import { MAX_IMAGE_BYTES, MAX_IMAGES } from "@hamtning/shared";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { presignUploads, uploadFile } from "../lib/api.js";
import { ImageError, prepareImage } from "../lib/images.js";

export type PhotoStatus = "processing" | "uploading" | "done" | "error";

export interface Photo {
  id: string;
  name: string;
  status: PhotoStatus;
  /** 0..1 while uploading */
  progress: number;
  previewUrl?: string;
  /** S3 key once uploaded */
  key?: string;
  error?: string;
  /** The processed image, kept so a failed upload can be retried without re-processing. */
  blob?: Blob;
}

type Action =
  | { type: "add"; photos: Photo[] }
  | { type: "patch"; id: string; patch: Partial<Photo> }
  | { type: "remove"; id: string };

function reducer(state: Photo[], action: Action): Photo[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.photos];
    case "patch":
      return state.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p));
    case "remove":
      return state.filter((p) => p.id !== action.id);
  }
}

const UPLOAD_FAILED = "Uppladdningen misslyckades.";

function messageFor(err: unknown) {
  if (err instanceof ImageError && err.reason === "too_large") return "Bilden är för stor.";
  if (err instanceof ImageError) return "Bildformatet stöds inte. Använd JPG, PNG eller HEIC.";
  return "Bilden kunde inte läsas.";
}

let nextId = 0;

export function usePhotoUploads() {
  const [items, dispatch] = useReducer(reducer, []);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const controllers = useRef(new Map<string, AbortController>());
  const removed = useRef(new Set<string>());
  const objectUrls = useRef(new Set<string>());
  // Photos are decoded one at a time: several 12 MP images at once can exhaust phone memory.
  const processing = useRef<Promise<void>>(Promise.resolve());

  const patch = useCallback(
    (id: string, p: Partial<Photo>) => dispatch({ type: "patch", id, patch: p }),
    [],
  );

  const upload = useCallback(
    async (id: string, blob: Blob) => {
      const ctrl = new AbortController();
      controllers.current.set(id, ctrl);
      patch(id, { status: "uploading", progress: 0, error: undefined });
      try {
        const { uploads } = await presignUploads(
          [{ contentType: blob.type, size: blob.size }],
          ctrl.signal,
        );
        const slot = uploads[0];
        if (!slot) throw new Error("No upload slot returned");
        await uploadFile(
          slot.url,
          blob,
          slot.contentType,
          (progress) => patch(id, { progress }),
          ctrl.signal,
        );
        patch(id, { status: "done", progress: 1, key: slot.key });
      } catch {
        if (!ctrl.signal.aborted) patch(id, { status: "error", error: UPLOAD_FAILED });
      } finally {
        controllers.current.delete(id);
      }
    },
    [patch],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const room = MAX_IMAGES - itemsRef.current.length;
      setNotice(files.length > room ? `Du kan ladda upp högst ${MAX_IMAGES} foton.` : null);
      const accepted = files.slice(0, Math.max(0, room));
      const added: Photo[] = accepted.map((f) => ({
        id: `photo-${++nextId}`,
        name: f.name,
        status: "processing",
        progress: 0,
      }));
      // Keep the count correct if addFiles is called again before React re-renders.
      itemsRef.current = [...itemsRef.current, ...added];
      dispatch({ type: "add", photos: added });

      added.forEach((photo, i) => {
        const file = accepted[i] as File;
        processing.current = processing.current.then(async () => {
          if (removed.current.has(photo.id)) return;
          try {
            const blob = await prepareImage(file);
            if (blob.size > MAX_IMAGE_BYTES) throw new ImageError("too_large");
            if (removed.current.has(photo.id)) return;
            const previewUrl = URL.createObjectURL(blob);
            objectUrls.current.add(previewUrl);
            patch(photo.id, { blob, previewUrl });
            void upload(photo.id, blob);
          } catch (err) {
            patch(photo.id, { status: "error", error: messageFor(err) });
          }
        });
      });
    },
    [patch, upload],
  );

  const remove = useCallback((id: string) => {
    removed.current.add(id);
    controllers.current.get(id)?.abort();
    const url = itemsRef.current.find((p) => p.id === id)?.previewUrl;
    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.current.delete(url);
    }
    itemsRef.current = itemsRef.current.filter((p) => p.id !== id);
    dispatch({ type: "remove", id });
    setNotice(null);
  }, []);

  const retry = useCallback(
    (id: string) => {
      const photo = itemsRef.current.find((p) => p.id === id);
      // Without a processed blob the file itself was unreadable; retrying cannot help.
      if (photo?.blob) void upload(id, photo.blob);
      else remove(id);
    },
    [upload, remove],
  );

  useEffect(() => {
    const ctrls = controllers.current;
    const urls = objectUrls.current;
    return () => {
      for (const c of ctrls.values()) c.abort();
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  // Stable identity while the set of finished uploads is unchanged (progress ticks don't count).
  const keySignature = items
    .filter((p) => p.status === "done" && p.key)
    .map((p) => p.key)
    .join("|");
  const keys = useMemo(() => (keySignature ? keySignature.split("|") : []), [keySignature]);

  return {
    items,
    keys,
    notice,
    busy: items.some((p) => p.status === "processing" || p.status === "uploading"),
    canAdd: items.length < MAX_IMAGES,
    addFiles,
    remove,
    retry,
  };
}

export type PhotoUploads = ReturnType<typeof usePhotoUploads>;
