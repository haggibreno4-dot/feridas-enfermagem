"use strict";
// The app handles sensitive clinical records. This worker deliberately does not
// cache pages, API responses, authentication data, or PDFs offline.
self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Network-only: do not persist sensitive clinical content on shared devices.
});
