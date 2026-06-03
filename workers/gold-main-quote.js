const DEFAULT_SYMBOL = "au0";
const DEFAULT_REGION = "CN";
const DEFAULT_NAME = "上期所黄金主连";
const DEFAULT_SOURCE = "iTick";
const ITICK_QUOTES_URL = "https://api.itick.org/future/quotes";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "GET" || url.pathname !== "/quote/gold-main") {
      return jsonResponse({ error: "Not found" }, 404);
    }

    const token = env.ITICK_TOKEN;
    if (!token) {
      return jsonResponse({ error: "Missing ITICK_TOKEN" }, 500);
    }

    const symbol = env.ITICK_SYMBOL || DEFAULT_SYMBOL;
    const region = env.ITICK_REGION || DEFAULT_REGION;
    const name = env.QUOTE_NAME || DEFAULT_NAME;

    const upstreamUrl = new URL(ITICK_QUOTES_URL);
    upstreamUrl.searchParams.set("region", region);
    upstreamUrl.searchParams.set("codes", symbol);

    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        token,
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });

    if (!upstreamResponse.ok) {
      return jsonResponse({ error: `Upstream returned ${upstreamResponse.status}` }, 502);
    }

    const payload = await upstreamResponse.json();
    const quote = findQuote(payload.data, symbol);
    const price = Number(quote?.ld);
    if (!Number.isFinite(price) || price <= 0) {
      return jsonResponse({ error: "Upstream quote price is invalid" }, 502);
    }

    const quoteTime = Number.isFinite(Number(quote.t)) ? new Date(Number(quote.t)).toISOString() : null;

    return jsonResponse({
      symbol: quote.s || symbol,
      name,
      price,
      quoteTime,
      source: env.QUOTE_SOURCE || DEFAULT_SOURCE,
      stale: false,
    });
  },
};

function findQuote(data, symbol) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return data[symbol] || data[symbol.toUpperCase()] || data[symbol.toLowerCase()] || Object.values(data)[0] || null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
