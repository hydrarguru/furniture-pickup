import { z } from "zod";

// Swedish fallback messages for any rule without a hand-written message in @hamtning/shared.
z.config(z.locales.sv());
