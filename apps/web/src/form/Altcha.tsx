import { useEffect, useRef, useState } from "react";

const CHALLENGE_URL = "/api/altcha/challenge";

/** The widget (about 34 kB) and its Swedish strings load when the last step opens. */
const loadWidget = () => Promise.all([import("altcha"), import("altcha/i18n/sv")]);

interface Props {
  /** Called with a fresh payload, or null when it expired or the check failed. */
  onToken: (token: string | null) => void;
  /** Increment to get a new payload (they are single-use, e.g. after a failed submit). */
  resetSignal: number;
}

export function Altcha({ onToken, resetSignal }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<HTMLElementTagNameMap["altcha-widget"] | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWidget()
      .then(() => {
        if (cancelled || !container.current) return;
        const el = document.createElement("altcha-widget");
        el.setAttribute("challenge", CHALLENGE_URL);
        el.setAttribute("language", "sv");
        el.setAttribute("auto", "onload");
        el.addEventListener("statechange", (e) => {
          const { state, payload } = (e as CustomEvent<{ state: string; payload?: string }>).detail;
          onTokenRef.current(state === "verified" && payload ? payload : null);
        });
        container.current.append(el);
        widget.current = el;
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
      onTokenRef.current(null);
      widget.current?.remove();
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetSignal === 0 || !widget.current) return;
    onTokenRef.current(null);
    widget.current.reset();
    void widget.current.verify();
  }, [resetSignal]);

  return loadFailed ? (
    <p className="error">
      Säkerhetskontrollen kunde inte laddas. Kontrollera anslutningen och ladda om sidan.
    </p>
  ) : (
    <div className="altcha" ref={container} />
  );
}
