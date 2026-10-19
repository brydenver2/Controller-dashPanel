/* AquaButler auth stub for Layer 1.
 *
 * The real Supabase auth flow lands in t_ea19acd3 (Vision's lane).
 * Until then, the dev/test path is "?xaqb=1" in the URL, which sets
 * the X-AquaButler-Bypass: 1 header on every request so the server's
 * auth middleware lets the request through (per the middleware stub
 * in server/aquabutler/authMiddleware.ts).
 *
 * Production deployments should NOT use this stub. The middleware
 * returns 401 without it; the stub's job is to keep the dev/QA
 * workflow unblocked while Vision owns the integration.
 */
(function () {
  "use strict";
  function flagQuery() {
    return new URL(window.location.href).searchParams.get("xaqb");
  }
  if (flagQuery() === "1") {
    document.documentElement.setAttribute("data-aquabutler-bypass", "1");
    console.warn(
      "AquaButler auth stub is active (?xaqb=1); production deployments must wire Supabase auth per t_ea19acd3.",
    );
  }
})();
