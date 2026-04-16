import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { Provider as JotaiProvider } from "jotai";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { store } from "./lib/jotai-store.js";
import { installApiAuthInterceptor } from "./lib/configure-api.js";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@xyflow/react/dist/style.css";

installApiAuthInterceptor();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <JotaiProvider store={store}>
      <MantineProvider defaultColorScheme="dark">
        <Notifications />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </MantineProvider>
    </JotaiProvider>
  </React.StrictMode>,
);
