export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  let tenant = url.searchParams.get("tenant");

  if (tenant) {
    tenant = String(tenant).trim().toLowerCase().replace(/[^a-z0-9\-]/g, "");
  }

  const tenantSlug = tenant || "asistia";

  const manifest = {
    name: "Staff",
    short_name: "Staff",
    description: "Módulo Staff de asistencia asistIA.",
    id: `/pwa/${tenantSlug}/staff`,
    start_url: tenant ? `/staff-asistencia/?tenant=${tenant}` : `/staff-asistencia/`,
    scope: "/staff-asistencia/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f9fc",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
