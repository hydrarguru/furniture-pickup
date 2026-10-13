import { useEffect, useRef, useState } from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Cloudflare's documented test key that always passes. */
const TEST_SITE_KEY = "1x00000000000000000000AA";
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || TEST_SITE_KEY;

interface TurnstileApi {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      theme?: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile missing"));
    script.onerror = () => {
      scriptPromise = null; // allow a later retry
      reject(new Error("Turnstile failed to load"));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

interface Props {
  /** Called with a fresh token, or null when the token expired or the check failed. */
  onToken: (token: string | null) => void;
  /** Increment to get a new token (tokens are single-use, e.g. after a failed submit). */
  resetSignal: number;
}

export function Turnstile({ onToken, resetSignal }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: SITE_KEY,
          language: "sv",
          theme: "auto",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
      onTokenRef.current(null); // an unmounted widget's token may expire unnoticed
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetSignal === 0 || !widgetId.current) return;
    onTokenRef.current(null);
    window.turnstile?.reset(widgetId.current);
  }, [resetSignal]);

  return loadFailed ? (
    <p className="error">
      Säkerhetskontrollen kunde inte laddas. Kontrollera anslutningen och ladda om sidan.
    </p>
  ) : (
    <div className="turnstile" ref={container} />
  );
}
