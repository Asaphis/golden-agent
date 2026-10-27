# Phase 5 browser and advanced tools

Phase 5 adds a real Playwright Chromium browser manager to the connector. Browser sessions are created per operation context and are closed explicitly or during connector cleanup.

The connector supports browser session open, HTTP(S) navigation, DOM/page inspection, PNG screenshots returned as base64, CSS-selector click actions, CSS-selector text input, and session close. Browser navigation rejects non-HTTP(S) schemes. Text input is bounded, and all browser operations require the `browser.use` permission.

The Playwright runtime and Chromium browser binary are part of the development environment. The browser flow integration test verifies permission denial, session lifecycle, navigation, title/text/link inspection, input, click behavior, screenshots, and cleanup against a local test page.

The browser manager currently runs headless Chromium. Production platform packaging, browser-profile persistence, proxy policy, download policy, and additional interaction primitives remain release-hardening concerns.
