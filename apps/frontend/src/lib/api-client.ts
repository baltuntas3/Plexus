const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Auth interceptor callbacks installed by the app bootstrap. Keeps api-client
// free of jotai imports (no circular dependency) and testable in isolation.
export interface ApiAuthCallbacks {
  /** Returns a fresh access token or null if refresh failed. */
  refresh: () => Promise<string | null>;
  /** Called when refresh itself failed — clears auth state. */
  logout: () => void;
}

let authCallbacks: ApiAuthCallbacks | null = null;
let refreshPromise: Promise<string | null> | null = null;

export const configureApiAuth = (callbacks: ApiAuthCallbacks): void => {
  authCallbacks = callbacks;
};

// Single-flight: concurrent 401s share one refresh call.
const acquireFreshToken = async (): Promise<string | null> => {
  if (!authCallbacks) return null;
  if (!refreshPromise) {
    refreshPromise = authCallbacks.refresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

const sendRequest = async (path: string, options: ApiRequestOptions): Promise<Response> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  return fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
};

const parseResponse = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let code = "UNKNOWN";
    let message = res.statusText;
    let details: unknown;
    try {
      const data = (await res.json()) as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (data.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
        details = data.error.details;
      }
    } catch {
      // ignore parse failure
    }
    throw new ApiError(res.status, code, message, details);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
};

export const apiRequest = async <T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> => {
  let response = await sendRequest(path, options);

  if (response.status === 401 && options.token && authCallbacks) {
    const newToken = await acquireFreshToken();
    if (newToken) {
      response = await sendRequest(path, { ...options, token: newToken });
    } else {
      authCallbacks.logout();
    }
  }

  return parseResponse<T>(response);
};
