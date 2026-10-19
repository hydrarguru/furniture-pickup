import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { currentTheme, setTheme } from "./lib/theme.js";

export function ThemeToggle() {
  const [theme, setCurrent] = useState(currentTheme);
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Byt till mörkt läge" : "Byt till ljust läge";
  return (
    <button
      type="button"
      className="secondary theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => {
        setTheme(next);
        setCurrent(next);
      }}
    >
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
