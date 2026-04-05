import type { AuthPrincipal } from "./auth.js";

export type ApiVariables = {
  auth: AuthPrincipal | null;
};
