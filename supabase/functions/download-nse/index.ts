// ============================================================
// Supabase Edge Function: download-nse (Production)
// ============================================================
// Replaces the entire .NET scraper. Handles:
//   1. F&O Bhavcopy   -> price_data
//   2. SEC Bhavcopy   -> sec_data (filtered to F&O stocks)
//   3. MWPL/combineoi -> io_data  (filtered to F&O stocks)
//
// Runs entirely on Supabase. No backend server. No Docker.
//
// Deploy:  supabase functions deploy download-nse --no-verify-jwt
// Invoke:  POST .../functions/v1/download-nse
//          body (all optional):
//            {"date":"2026-05-30"}   single date
//            {"days":3}              last N trading days
//            {"types":["FO","SEC","IO"]}  which datasets (default all)
// ============================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";
import { corsHeaders } from "../_shared/cors.ts";

// ---------------- Types ----------------
interface PriceRow {
  symbol: string;
  trade_date: string;
  instrument_type: string | null;
  expiry_date: string | null;
  strike_price: number;
  option_type: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number | null;
  settlement_price: number | null;
  volume: number | null;
  open_interest: number | null;
  change_in_oi: number | null;
  turnover: number | null;
  table_source: string;
}

interface SecRow {
  symbol: string;
  series: string | null;
  trade_date: string;
  prev_close: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  last_price: number | null;
  close_price: number | null;
  avg_price: number | null;
  total_traded_qty: number | null;
  turnover_lacs: number | null;
  no_of_trades: number | null;
  deliv_qty: number | null;
  deliv_per: number | null;
}

interface IoRow {
  trade_date: string;
  isin: string | null;
  scrip_name: string | null;
  nse_symbol: string;
  mwpl: number | null;
  open_interest: number | null;
  future_equiv_oi: number | null;
  limit_next_day: string | null;
}

// ---------------- Helpers ----------------
function num(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const cleaned = String(v).replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function toISODate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  let m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mm = months[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1]}`;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

function instrumentType(code: string): string {
  switch ((code || "").toUpperCase()) {
    case "STF": return "FUT";
    case "IDF": return "FUT";
    case "STO": return "OPT";
    case "IDO": return "OPT";
    default: return code || "EQ";
  }
}

async function fetchNse(url: string): Promise<Response> {
  return await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.nseindia.com/",
    },
  });
}

// Get CSV text from a URL that may be .zip or plain .csv
async function fetchCsv(url: string): Promise<string | null> {
  const resp = await fetchNse(url);
  if (!resp.ok) return null;

  if (url.toLowerCase().endsWith(".zip")) {
    const buf = new Uint8Array(await resp.arrayBuffer());
    const files = unzipSync(buf);
    const csvName = Object.keys(files).find((f) => f.toLowerCase().endsWith(".csv"));
    if (!csvName) return null;
    return new TextDecoder().decode(files[csvName]);
  }
  return await resp.text();
}

async function logDownload(
  supabase: SupabaseClient,
  fileType: string,
  fileName: string,
  fileDate: string,
  status: string,
  records: number,
  error?: string,
) {
  try {
    await supabase.from("download_logs").insert({
      file_type: fileType,
      file_name: fileName,
      file_date: fileDate,
      status,
      records_processed: records,
      error_message: error ?? null,
      completed_at: new Date().toISOString(),
    });
  } catch (_) { /* ignore */ }
}

async function insertBatched(
  supabase: SupabaseClient,
  table: string,
  rows: unknown[],
  conflictKey: string,
): Promise<number> {
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    // upsert => re-running for the same date won't create duplicates
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictKey, ignoreDuplicates: false });
    if (error) {
      console.error(`Upsert error (${table}):`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// ---------------- F&O Processing ----------------
async function processFO(
  supabase: SupabaseClient,
  yyyymmdd: string,
  isoDate: string,
): Promise<{ rows: number; stfTickers: Set<string> }> {
  const url =
    `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${yyyymmdd}_F_0000.csv.zip`;

  const stfTickers = new Set<string>();
  const csvText = await fetchCsv(url);
  if (!csvText) {
    await logDownload(supabase, "FO", url, isoDate, "failed", 0, "Not available");
    return { rows: 0, stfTickers };
  }

  const records = parseCSV(csvText);
  if (records.length === 0) {
    await logDownload(supabase, "FO", url, isoDate, "failed", 0, "Empty CSV");
    return { rows: 0, stfTickers };
  }

  const priceRows: PriceRow[] = [];
  const tickerMap = new Map<string, string>();
  const seen = new Set<string>();

  // First pass: collect tickers + the set of expiries per instrument group
  const futExpiries = new Set<string>();  // STF + IDF
  const optExpiries = new Set<string>();  // STO + IDO

  for (const r of records) {
    const symbol = r["TckrSymb"] || "";
    if (!symbol) continue;
    const finTp = (r["FinInstrmTp"] || "").toUpperCase();

    if (finTp === "STF") stfTickers.add(symbol);
    if (!tickerMap.has(symbol)) tickerMap.set(symbol, r["ISIN"] || "");

    const exp = toISODate(r["XpryDt"]);
    if (!exp) continue;
    if (finTp === "STF" || finTp === "IDF") futExpiries.add(exp);
    if (finTp === "STO" || finTp === "IDO") optExpiries.add(exp);
  }

  // Keep only the 3 nearest expiries for futures and for options
  const nearest3 = (set: Set<string>): Set<string> =>
    new Set(Array.from(set).sort().slice(0, 3));
  const keepFut = nearest3(futExpiries);
  const keepOpt = nearest3(optExpiries);

  // Second pass: build rows, keeping only the 3 nearest expiries per group
  for (const r of records) {
    const symbol = r["TckrSymb"] || "";
    if (!symbol) continue;
    const finTp = (r["FinInstrmTp"] || "").toUpperCase();

    const isFut = finTp === "STF" || finTp === "IDF";
    const isOpt = finTp === "STO" || finTp === "IDO";
    if (!isFut && !isOpt) continue;

    const tradeDate = toISODate(r["TradDt"]) ?? isoDate;
    const expiry = toISODate(r["XpryDt"]) ?? "1900-01-01";
    const instType = instrumentType(finTp); // FUT or OPT

    // Filter by the 3 nearest expiries for the relevant group
    if (isFut && !keepFut.has(expiry)) continue;
    if (isOpt && !keepOpt.has(expiry)) continue;

    // For futures: one row per (symbol, expiry).
    // For options: one row per (symbol, expiry, strike, call/put).
    const strike = r["StrkPric"] || r["StrkPrice"] || "";
    const optType = r["OptnTp"] || r["OptTp"] || ""; // CE / PE
    const key = isOpt
      ? `${symbol}|${tradeDate}|${instType}|${expiry}|${strike}|${optType}`
      : `${symbol}|${tradeDate}|${instType}|${expiry}`;

    if (seen.has(key)) continue;
    seen.add(key);

    priceRows.push({
      symbol,
      trade_date: tradeDate,
      instrument_type: instType,
      expiry_date: expiry,
      strike_price: isOpt ? (num(strike) ?? 0) : 0,
      option_type: isOpt ? (optType || "") : "",
      open_price: num(r["OpnPric"]),
      high_price: num(r["HghPric"]),
      low_price: num(r["LwPric"]),
      close_price: num(r["ClsPric"]),
      settlement_price: num(r["SttlmPric"]),
      volume: num(r["TtlTradgVol"]),
      open_interest: num(r["OpnIntrst"]),
      change_in_oi: num(r["ChngInOpnIntrst"]),
      turnover: num(r["TtlTrfVal"]),
      table_source: `FO_${yyyymmdd}`,
    });
  }

  // Upsert tickers
  const tickers = Array.from(tickerMap.entries()).map(([symbol, isin]) => ({
    symbol, isin: isin || null, is_active: true,
  }));
  if (tickers.length > 0) {
    await supabase.from("tickers").upsert(tickers, {
      onConflict: "symbol", ignoreDuplicates: true,
    });
  }

  // Register futures table
  await supabase.from("futures_tables").upsert({
    name: `FO_FUT_${yyyymmdd}`,
    table_date: isoDate,
    instrument_type: "FUT",
    is_active: true,
    record_count: priceRows.length,
  }, { onConflict: "name" });

  const inserted = await insertBatched(
    supabase, "price_data", priceRows,
    "symbol,trade_date,instrument_type,expiry_date,strike_price,option_type",
  );
  await logDownload(supabase, "FO", url, isoDate, "success", inserted);

  return { rows: inserted, stfTickers };
}

// ---------------- SEC Processing ----------------
async function processSEC(
  supabase: SupabaseClient,
  ddmmyyyy: string,
  isoDate: string,
  stfTickers: Set<string>,
): Promise<number> {
  const url =
    `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`;

  const csvText = await fetchCsv(url);
  if (!csvText) {
    await logDownload(supabase, "SEC", url, isoDate, "failed", 0, "Not available");
    return 0;
  }

  const records = parseCSV(csvText);
  if (records.length === 0) return 0;

  // Filter to F&O (STF) stocks only — matches old SecFoFilterService logic
  const filtered = stfTickers.size > 0
    ? records.filter((r) => {
        const sym = r["SYMBOL"] || r["NSE Symbol"] || "";
        return stfTickers.has(sym.trim());
      })
    : records;

  const secRows: SecRow[] = filtered.map((r) => ({
    symbol: (r["SYMBOL"] || "").trim(),
    series: (r["SERIES"] || "").trim() || null,
    trade_date: toISODate(r["DATE1"]) ?? isoDate,
    prev_close: num(r["PREV_CLOSE"]),
    open_price: num(r["OPEN_PRICE"]),
    high_price: num(r["HIGH_PRICE"]),
    low_price: num(r["LOW_PRICE"]),
    last_price: num(r["LAST_PRICE"]),
    close_price: num(r["CLOSE_PRICE"]),
    avg_price: num(r["AVG_PRICE"]),
    total_traded_qty: num(r["TTL_TRD_QNTY"]),
    turnover_lacs: num(r["TURNOVER_LACS"]),
    no_of_trades: num(r["NO_OF_TRADES"]),
    deliv_qty: num(r["DELIV_QTY"]),
    deliv_per: num(r["DELIV_PER"]),
  })).filter((r) => r.symbol);

  const inserted = await insertBatched(
    supabase, "sec_data", secRows, "symbol,series,trade_date",
  );
  await logDownload(supabase, "SEC", url, isoDate, "success", inserted);
  return inserted;
}

// ---------------- IO (MWPL) Processing ----------------
async function processIO(
  supabase: SupabaseClient,
  ddmmyyyy: string,
  isoDate: string,
  stfTickers: Set<string>,
): Promise<number> {
  const url =
    `https://nsearchives.nseindia.com/archives/nsccl/mwpl/combineoi_${ddmmyyyy}.zip`;

  const csvText = await fetchCsv(url);
  if (!csvText) {
    await logDownload(supabase, "IO", url, isoDate, "failed", 0, "Not available");
    return 0;
  }

  const records = parseCSV(csvText);
  if (records.length === 0) return 0;

  const filtered = stfTickers.size > 0
    ? records.filter((r) => {
        const sym = r["NSE Symbol"] || r["SYMBOL"] || "";
        return stfTickers.has(sym.trim());
      })
    : records;

  const ioRows: IoRow[] = filtered.map((r) => ({
    trade_date: toISODate(r["Date"]) ?? isoDate,
    isin: (r["ISIN"] || "").trim() || null,
    scrip_name: (r["Scrip Name"] || "").trim() || null,
    nse_symbol: (r["NSE Symbol"] || "").trim(),
    mwpl: num(r["MWPL"]),
    open_interest: num(r["Open Interest"]),
    future_equiv_oi: num(r["Future Equivalent Open Interest"]),
    limit_next_day: (r["Limit for Next Day"] || "").trim() || null,
  })).filter((r) => r.nse_symbol);

  const inserted = await insertBatched(
    supabase, "io_data", ioRows, "nse_symbol,trade_date",
  );
  await logDownload(supabase, "IO", url, isoDate, "success", inserted);
  return inserted;
}

// ---------------- Process one date ----------------
async function processDate(
  supabase: SupabaseClient,
  date: Date,
  types: string[],
) {
  const yyyymmdd =
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0");

  const ddmmyyyy =
    String(date.getDate()).padStart(2, "0") +
    String(date.getMonth() + 1).padStart(2, "0") +
    date.getFullYear().toString();

  const isoDate = date.toISOString().split("T")[0];

  const result: Record<string, unknown> = { date: isoDate };
  let stfTickers = new Set<string>();

  try {
    // FO must run first to get STF tickers for filtering SEC/IO
    if (types.includes("FO")) {
      const fo = await processFO(supabase, yyyymmdd, isoDate);
      result.fo_rows = fo.rows;
      stfTickers = fo.stfTickers;
    }

    if (types.includes("SEC")) {
      result.sec_rows = await processSEC(supabase, ddmmyyyy, isoDate, stfTickers);
    }

    if (types.includes("IO")) {
      result.io_rows = await processIO(supabase, ddmmyyyy, isoDate, stfTickers);
    }

    result.status = "success";
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ---------------- HTTP Handler ----------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: { date?: string; days?: number; types?: string[] } = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch (_) { body = {}; }
    }

    const types = body.types && body.types.length > 0
      ? body.types.map((t) => t.toUpperCase())
      : ["FO", "SEC", "IO"];

    const datesToProcess: Date[] = [];
    if (body.date) {
      datesToProcess.push(new Date(body.date));
    } else if (body.days && body.days > 0) {
      const n = Math.min(body.days, 7); // cap to avoid timeout
      for (let i = 0; i < n; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const day = d.getDay();
        if (day !== 0 && day !== 6) datesToProcess.push(d);
      }
    } else {
      datesToProcess.push(new Date());
    }

    const results = [];
    for (const date of datesToProcess) {
      results.push(await processDate(supabase, date, types));
    }

    return new Response(JSON.stringify({
      success: true,
      types,
      results,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Function error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});