export type Header = { key: string; value: string };

/**
 * Response headers applied to every route. The CSP allows inline scripts because Next.js
 * inlines its bootstrap scripts; a nonce-based policy (which forces dynamic rendering) can
 * replace it later. Development additionally needs eval and websockets for fast refresh.
 */
export function securityHeaders(options: { production: boolean }): Header[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self'${options.production ? "" : " ws: wss:"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(options.production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    ...(options.production
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : []),
  ];
}
