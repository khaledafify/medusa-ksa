import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotificationsSettingsPage, { config } from "./page";

describe("NotificationsSettingsPage", () => {
  it("registers a native Settings route label", () => {
    expect(config.label).toBe("Notifications");
  });

  it("renders the admin shell without a browser runtime", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(NotificationsSettingsPage),
      ),
    );

    expect(html).toContain("Notifications");
    expect(html).toContain("Sample preview");
  });
});
