import { createStore } from "jotai";

// Single shared Jotai store used by both the React tree (via <Provider store>)
// and non-React modules (e.g. api-client auto-refresh interceptor) that need
// to read/update auth atoms without the useAtom hooks.
export const store = createStore();
