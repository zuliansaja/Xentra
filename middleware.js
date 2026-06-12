import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ============================================================
// LAYER 2 — Page-level Rate Limiting per IP (Vercel Edge Middleware)
// ============================================================
// Tujuan: cegah bot/scraper spam load halaman Xentra.
// Desain: FAIL-OPEN — kalau Upstash error/down/belum diset,
//         request tetap diizinkan (return undefined = lanjut normal).
// Catatan: ini TIDAK pakai next/server, supaya aman untuk static site
//          (tidak memicu Vercel build sebagai project Next.js).

export const config = {
  matcher: ["/((?!_vercel|favicon.ico).*)"],
};

let ratelimit = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    // 60 request per 60 detik per IP — longgar, jauh di atas penggunaan normal
    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "xentra_pageview",
    });
  }
} catch (e) {
  ratelimit = null;
}

export default async function middleware(req) {
  // Jika ratelimit tidak terkonfigurasi, lanjutkan request seperti biasa
  if (!ratelimit) {
    return; // undefined = lanjut ke halaman normal
  }

  try {
    const ip =
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    const { success, limit, remaining, reset } = await ratelimit.limit(ip);

    if (!success) {
      return new Response("Terlalu banyak request. Coba lagi sebentar.", {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(remaining),
        },
      });
    }

    // success -> lanjut request normal
    return;
  } catch (e) {
    // ✅ FAIL-OPEN: error apapun, jangan blokir request
    return;
  }
}

