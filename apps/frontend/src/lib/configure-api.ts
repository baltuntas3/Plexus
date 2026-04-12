import type { AuthTokens } from "@plexus/shared-types";
import { logoutAtom, tokensAtom } from "../atoms/auth.atoms.js";
import { configureApiAuth } from "./api-client.js";
import { store } from "./jotai-store.js";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// Installs the 401-retry interceptor into api-client. Called once at bootstrap.
export const installApiAuthInterceptor = (): void => {
  configureApiAuth({
    refresh: async (): Promise<string | null> => {
      const current = store.get(tokensAtom);
      if (!current?.refreshToken) {
        return null;
      }
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!response.ok) {
          return null;
        }
        const data = (await response.json()) as { tokens: AuthTokens };
        store.set(tokensAtom, data.tokens);
        return data.tokens.accessToken;
      } catch {
        return null;
      }
    },
    logout: (): void => {
      store.set(logoutAtom);
    },
  });
};
