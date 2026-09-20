// ONE FILE, does everything: Play Store + App Store review tools, served
// over HTTP so Claude's REMOTE connector can reach it once this is deployed
// (e.g. on Render). Kept as a single flat file on purpose — easier to
// upload from a phone with no folder-structure issues.

import express from "express";
import { z } from "zod";
import gplay from "google-play-scraper";
import store from "app-store-scraper";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Case-insensitive "does this review mention any of these words/phrases" check.
// Empty/missing keywords list = no filtering (matches everything).
function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const lower = (text || "").toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

// ---------------- Play Store: bulk, filtered review collection ----------------
async function collectPlaystoreReviews({ appId, sort, country, lang, minRating, maxRating, keywords, targetCount, startToken }) {
  const sortMap = { NEWEST: gplay.sort.NEWEST, RATING: gplay.sort.RATING, HELPFULNESS: gplay.sort.HELPFULNESS };
  const collected = [];
  let nextToken = startToken || null;
  let rawFetched = 0;
  const hardCeiling = Math.max(targetCount * 6, 900);

  while (collected.length < targetCount && rawFetched < hardCeiling) {
    let result;
    try {
      result = await gplay.reviews({
        appId, sort: sortMap[sort], num: 150, country, lang,
        paginate: true, nextPaginationToken: nextToken
      });
    } catch (err) {
      return { collected, rawFetched, exhausted: true, nextToken: null, error: String(err?.message || err) };
    }
    const batch = result.data || [];
    rawFetched += batch.length;
    for (const r of batch) {
      if (minRating != null && r.score < minRating) continue;
      if (maxRating != null && r.score > maxRating) continue;
      if (!matchesKeywords(r.text, keywords)) continue;
      collected.push(r);
      if (collected.length >= targetCount) break;
    }
    nextToken = result.nextPaginationToken || null;
    if (!nextToken || batch.length === 0) return { collected, rawFetched, exhausted: true, nextToken: null };
    await sleep(300);
  }
  return { collected, rawFetched, exhausted: false, nextToken };
}

// ---------------- App Store: bulk, filtered, multi-country ----------------
async function collectAppstoreReviews({ id, sort, countries, minRating, maxRating, keywords, targetCount }) {
  const sortMap = { RECENT: store.sort.RECENT, HELPFUL: store.sort.HELPFUL };
  const collected = [];
  let rawFetched = 0;
  const countriesSearched = [];

  outer: for (const country of countries) {
    countriesSearched.push(country);
    for (let page = 1; page <= 10; page++) {
      let results;
      try {
        results = await store.reviews({ id, page, sort: sortMap[sort], country });
      } catch (err) {
        break;
      }
      if (!results || results.length === 0) break;
      rawFetched += results.length;
      for (const r of results) {
        if (minRating != null && r.score < minRating) continue;
        if (maxRating != null && r.score > maxRating) continue;
        if (!matchesKeywords(r.text, keywords)) continue;
        collected.push({ ...r, country });
        if (collected.length >= targetCount) break outer;
      }
      await sleep(250);
    }
  }
  return { collected, rawFetched, countriesSearched };
}

// ---------------- Play Store: keyword MINING (counts + a few short examples, not full dumps) ----------------
// Built specifically to be cheap in Claude tokens: scans up to scanLimit raw
// reviews server-side (free, on Render) and returns only counts + a handful
// of short snippets per keyword — not hundreds of full review texts.
async function scanPlaystoreKeywords({ appId, sort, country, lang, minRating, maxRating, keywords, scanLimit }) {
  const sortMap = { NEWEST: gplay.sort.NEWEST, RATING: gplay.sort.RATING, HELPFULNESS: gplay.sort.HELPFULNESS };
  const tally = new Map(keywords.map((k) => [k, { count: 0, examples: [] }]));
  let nextToken = null;
  let rawFetched = 0;
  let firstCall = true;

  while (rawFetched < scanLimit) {
    let result;
    try {
      result = await gplay.reviews({
        appId, sort: sortMap[sort], num: 150, country, lang,
        paginate: true, nextPaginationToken: firstCall ? null : nextToken
      });
    } catch (err) {
      return { tally, rawFetched, exhausted: true, error: String(err?.message || err) };
    }
    firstCall = false;
    const batch = result.data || [];
    rawFetched += batch.length;
    for (const r of batch) {
      if (minRating != null && r.score < minRating) continue;
      if (maxRating != null && r.score > maxRating) continue;
      const lower = (r.text || "").toLowerCase();
      for (const k of keywords) {
        if (!lower.includes(k.toLowerCase())) continue;
        const entry = tally.get(k);
        entry.count += 1;
        if (entry.examples.length < 3) {
          entry.examples.push({
            reviewId: r.id, score: r.score, date: r.date,
            snippet: (r.text || "").length > 180 ? r.text.slice(0, 180) + "…" : r.text
          });
        }
      }
    }
    nextToken = result.nextPaginationToken || null;
    if (!nextToken || batch.length === 0) return { tally, rawFetched, exhausted: true };
    await sleep(300);
  }
  return { tally, rawFetched, exhausted: false };
}

// ---------------- App Store: keyword MINING (counts + a few short examples) ----------------
async function scanAppstoreKeywords({ id, sort, countries, minRating, maxRating, keywords, scanLimit }) {
  const sortMap = { RECENT: store.sort.RECENT, HELPFUL: store.sort.HELPFUL };
  const tally = new Map(keywords.map((k) => [k, { count: 0, examples: [] }]));
  let rawFetched = 0;
  const countriesSearched = [];

  for (const country of countries) {
    if (rawFetched >= scanLimit) break;
    countriesSearched.push(country);
    for (let page = 1; page <= 10 && rawFetched < scanLimit; page++) {
      let results;
      try {
        results = await store.reviews({ id, page, sort: sortMap[sort], country });
      } catch (err) {
        break;
      }
      if (!results || results.length === 0) break;
      rawFetched += results.length;
      for (const r of results) {
        if (minRating != null && r.score < minRating) continue;
        if (maxRating != null && r.score > maxRating) continue;
        const lower = (r.text || "").toLowerCase();
        for (const k of keywords) {
          if (!lower.includes(k.toLowerCase())) continue;
          const entry = tally.get(k);
          entry.count += 1;
          if (entry.examples.length < 3) {
            entry.examples.push({
              reviewId: r.id, score: r.score, date: r.date, country,
              snippet: (r.text || "").length > 180 ? r.text.slice(0, 180) + "…" : r.text
            });
          }
        }
      }
      await sleep(250);
    }
  }
  return { tally, rawFetched, countriesSearched };
}

function tallyToResult(tally) {
  return [...tally.entries()].map(([keyword, v]) => ({ keyword, matchCount: v.count, exampleSnippets: v.examples }));
}

// ---------------- Register all 6 tools on an McpServer instance ----------------
function registerTools(server) {
  server.registerTool(
    "playstore_search_app",
    {
      title: "Search Play Store for an app",
      description: "Search Google Play by name/keyword. Returns matching app package IDs, titles, developers.",
      inputSchema: { term: z.string(), num: z.number().int().min(1).max(20).default(5) }
    },
    async ({ term, num }) => {
      try {
        const results = await gplay.search({ term, num });
        const data = results.map((r) => ({ appId: r.appId, title: r.title, developer: r.developer, score: r.score ?? null, url: r.url }));
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, results: data }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "SEARCH_FAILED", message: String(err?.message || err) }) }] };
      }
    }
  );

  server.registerTool(
    "playstore_get_reviews",
    {
      title: "Get Google Play reviews for an app (bulk, filterable, keyword search)",
      description:
        "Fetch real Google Play reviews by exact packageName. Pages internally until targetCount matching reviews are collected. Use minRating/maxRating to pre-filter (e.g. minRating:1,maxRating:3 for negative reviews only). Use keywords to only keep reviews whose text mentions at least one of the given words/phrases (case-insensitive substring match, e.g. keywords:['crash','login','sync'] for bug-hunting). This is client-side text filtering — Play Store has no true server-side review search API — so it scans more raw reviews than it returns; rare keywords may return fewer than targetCount even when exhausted is true. Returns ONLY reviews actually returned — never invent beyond this data.",
      inputSchema: {
        appId: z.string(), sort: z.enum(["NEWEST", "RATING", "HELPFULNESS"]).default("NEWEST"),
        country: z.string().length(2).default("us"), lang: z.string().length(2).default("en"),
        minRating: z.number().int().min(1).max(5).optional(), maxRating: z.number().int().min(1).max(5).optional(),
        keywords: z.array(z.string()).max(10).optional().describe("Only keep reviews mentioning at least one of these words/phrases"),
        targetCount: z.number().int().min(1).max(1000).default(50),
        continueToken: z.string().optional()
      }
    },
    async ({ appId, sort, country, lang, minRating, maxRating, keywords, targetCount, continueToken }) => {
      const { collected, rawFetched, exhausted, nextToken, error } = await collectPlaystoreReviews({
        appId, sort, country, lang, minRating, maxRating, keywords, targetCount, startToken: continueToken || null
      });
      if (error) {
        const code = /not found|404/i.test(error) ? "APP_NOT_FOUND" : "FETCH_FAILED";
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: code, message: error }) }] };
      }
      const reviews = collected.map((r) => ({
        reviewId: r.id, author: r.userName, score: r.score, date: r.date, text: r.text,
        thumbsUp: r.thumbsUp ?? null, appVersion: r.version ?? null, replyText: r.replyText ?? null
      }));
      return { content: [{ type: "text", text: JSON.stringify({
        ok: true, appId, requestedTargetCount: targetCount, count: reviews.length,
        rawReviewsScanned: rawFetched, targetReached: reviews.length >= targetCount,
        exhausted, nextToken: nextToken || null, reviews
      }) }] };
    }
  );

  server.registerTool(
    "playstore_keyword_insights",
    {
      title: "Mine Google Play reviews for keywords — counts + short examples, not full dumps",
      description:
        "Use this instead of playstore_get_reviews when you're hunting for patterns across MANY reviews (e.g. 'how often do people mention crashes, pricing, sync issues') rather than needing full review text. Scans up to scanLimit reviews server-side and returns, per keyword, a match count plus up to 3 short (~180 char) example snippets — NOT the full set of matching reviews. This is dramatically cheaper in tokens than pulling hundreds of full reviews, because the counting/scanning happens on the server, not in the conversation. Use playstore_get_reviews afterward only if you need the complete text of specific reviews you've already identified as interesting.",
      inputSchema: {
        appId: z.string(), sort: z.enum(["NEWEST", "RATING", "HELPFULNESS"]).default("NEWEST"),
        country: z.string().length(2).default("us"), lang: z.string().length(2).default("en"),
        minRating: z.number().int().min(1).max(5).optional(), maxRating: z.number().int().min(1).max(5).optional(),
        keywords: z.array(z.string()).min(1).max(15).describe("Words/phrases to count and find examples of, e.g. ['crash','sync','pricing']"),
        scanLimit: z.number().int().min(50).max(3000).default(500).describe("How many raw reviews to scan through server-side. Higher = more thorough, slower, still costs zero Claude tokens.")
      }
    },
    async ({ appId, sort, country, lang, minRating, maxRating, keywords, scanLimit }) => {
      const { tally, rawFetched, exhausted, error } = await scanPlaystoreKeywords({
        appId, sort, country, lang, minRating, maxRating, keywords, scanLimit
      });
      if (error) {
        const code = /not found|404/i.test(error) ? "APP_NOT_FOUND" : "FETCH_FAILED";
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: code, message: error }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({
        ok: true, appId, rawReviewsScanned: rawFetched, exhausted,
        keywordResults: tallyToResult(tally)
      }) }] };
    }
  );

  server.registerTool(
    "appstore_search_app",
    {
      title: "Search Apple App Store for an app",
      description: "Search the iOS App Store by name/keyword. Returns numeric app IDs to use with appstore_get_reviews.",
      inputSchema: { term: z.string(), num: z.number().int().min(1).max(20).default(5), country: z.string().length(2).default("us") }
    },
    async ({ term, num, country }) => {
      try {
        const results = await store.search({ term, num, country });
        const data = results.map((r) => ({ id: r.id, appId: r.appId, title: r.title, developer: r.developer, score: r.score ?? null, url: r.url }));
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, results: data }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "SEARCH_FAILED", message: String(err?.message || err) }) }] };
      }
    }
  );

  server.registerTool(
    "appstore_get_reviews",
    {
      title: "Get Apple App Store reviews for an app (bulk, filterable, multi-country, keyword search)",
      description:
        "Fetch real iOS reviews by numeric App Store id. HARD LIMIT: Apple exposes only 500 reviews per app PER COUNTRY. Pass multiple country codes to gather more. Use minRating/maxRating to pre-filter. Use keywords to only keep reviews whose text mentions at least one of the given words/phrases (case-insensitive substring match). This is client-side text filtering, not a native App Store search — it scans more raw reviews than it returns. Returns ONLY reviews actually returned.",
      inputSchema: {
        id: z.union([z.string(), z.number()]), sort: z.enum(["RECENT", "HELPFUL"]).default("RECENT"),
        countries: z.array(z.string().length(2)).min(1).max(10).default(["us"]),
        minRating: z.number().int().min(1).max(5).optional(), maxRating: z.number().int().min(1).max(5).optional(),
        keywords: z.array(z.string()).max(10).optional().describe("Only keep reviews mentioning at least one of these words/phrases"),
        targetCount: z.number().int().min(1).max(5000).default(50)
      }
    },
    async ({ id, sort, countries, minRating, maxRating, keywords, targetCount }) => {
      const { collected, rawFetched, countriesSearched } = await collectAppstoreReviews({ id, sort, countries, minRating, maxRating, keywords, targetCount });
      const reviews = collected.map((r) => ({
        reviewId: r.id, author: r.userName, score: r.score, title: r.title ?? null,
        text: r.text, date: r.date ?? null, appVersion: r.version ?? null, country: r.country
      }));
      return { content: [{ type: "text", text: JSON.stringify({
        ok: true, id, requestedTargetCount: targetCount, count: reviews.length,
        rawReviewsScanned: rawFetched, targetReached: reviews.length >= targetCount,
        countriesSearched, maxPossibleGivenCountries: countriesSearched.length * 500, reviews
      }) }] };
    }
  );

  server.registerTool(
    "appstore_keyword_insights",
    {
      title: "Mine App Store reviews for keywords — counts + short examples, not full dumps",
      description:
        "Use this instead of appstore_get_reviews when hunting for patterns across MANY reviews rather than needing full text. Scans up to scanLimit reviews across the given countries and returns, per keyword, a match count plus up to 3 short (~180 char) example snippets — not the full matching set. Far cheaper in tokens than pulling hundreds of full reviews. Use appstore_get_reviews afterward only for the full text of specific reviews already identified as interesting.",
      inputSchema: {
        id: z.union([z.string(), z.number()]), sort: z.enum(["RECENT", "HELPFUL"]).default("RECENT"),
        countries: z.array(z.string().length(2)).min(1).max(10).default(["us"]),
        minRating: z.number().int().min(1).max(5).optional(), maxRating: z.number().int().min(1).max(5).optional(),
        keywords: z.array(z.string()).min(1).max(15).describe("Words/phrases to count and find examples of"),
        scanLimit: z.number().int().min(50).max(5000).default(500)
      }
    },
    async ({ id, sort, countries, minRating, maxRating, keywords, scanLimit }) => {
      const { tally, rawFetched, countriesSearched } = await scanAppstoreKeywords({
        id, sort, countries, minRating, maxRating, keywords, scanLimit
      });
      return { content: [{ type: "text", text: JSON.stringify({
        ok: true, id, rawReviewsScanned: rawFetched, countriesSearched,
        keywordResults: tallyToResult(tally)
      }) }] };
    }
  );
}

// ---------------- HTTP server ----------------
const API_KEY = process.env.MCP_API_KEY;
if (!API_KEY) {
  console.error("FATAL: set MCP_API_KEY as an environment variable before starting this server.");
  process.exit(1);
}

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.status(200).send("app-review-scraper is running. See /healthz or POST /mcp."));

// Proves exactly which tools THIS running file actually registers, independent
// of what Claude's connector may have cached from an earlier connection.
app.get("/debug-tools", (_req, res) => {
  const names = [];
  registerTools({ registerTool: (name) => names.push(name) });
  res.json({ toolCount: names.length, tools: names });
});

// TEMPORARY — delete this route once the key mismatch is fixed.
// Shows the length and first/last 3 characters of the key Render actually
// has stored, without exposing the whole thing, so we can spot a stray
// space or wrong value without guessing.
app.get("/debug-key", (_req, res) => {
  const k = API_KEY || "";
  res.json({ length: k.length, preview: k.length > 6 ? `${k.slice(0, 3)}...${k.slice(-3)}` : k });
});

// The secret lives IN THE PATH, not a header or query param. Wrong or
// missing secret returns a plain 404 — never 401 — so Claude's connector
// never sees an "auth required" style status and won't override your
// "No sign-in" choice. Your Server URL in Claude must be the full path
// including the real key: https://your-app.onrender.com/mcp/<MCP_API_KEY>
app.use("/mcp/:secret", (req, res, next) => {
  if (req.params.secret !== API_KEY) return res.status(404).send("Not found");
  next();
});

app.post("/mcp/:secret", async (req, res) => {
  try {
    const server = new McpServer({ name: "app-review-scraper", version: "2.0.0" });
    registerTools(server);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

app.get("/mcp/:secret", (_req, res) => res.status(405).json({ error: "Method not allowed (stateless server)" }));
app.delete("/mcp/:secret", (_req, res) => res.status(405).json({ error: "Method not allowed (stateless server)" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`app-review-scraper listening on port ${PORT}`));
