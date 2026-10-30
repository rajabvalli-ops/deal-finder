// Service worker for price-alert push notifications. It only shows notifications and opens
// the site when one is clicked; it does not cache pages or intercept requests.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "Price alert";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/alerts";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      image:
        typeof data.image === "string" && data.image.startsWith("https://")
          ? data.image
          : undefined,
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url },
      requireInteraction: data.urgent === true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/alerts", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
