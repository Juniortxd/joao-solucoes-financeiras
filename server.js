const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const BINANCE = "https://www.binance.com";

function requestJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers: {"User-Agent":"JoaoSolucoesFinanceiras/1.0"}}, res => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("Binance HTTP " + res.statusCode));
        try { resolve(JSON.parse(body)); } catch { reject(new Error("Resposta inválida da Binance")); }
      });
    }).on("error", reject);
  });
}

function items(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.data?.items)) return json.data.items;

  console.error("Resposta inesperada da Binance:",
    JSON.stringify(json).slice(0, 2000));

  throw new Error(
    "A Binance respondeu, mas os anúncios vieram em um formato inesperado"
  );
}
}
function n(...xs) {
  for (const x of xs) { const v = Number(x); if (Number.isFinite(v) && v > 0) return v; }
  return 0;
}
function parseAd(x) {
  const adv = x.adv || {};
  const price = n(x.price, adv.price, adv.advPrice);
  const usdt = n(x.surplusAmount, x.availableAmount, adv.surplusAmount, adv.tradableQuantity, adv.availableAmount, adv.quantity);
  if (!price || !usdt) return null;
  return {price, liquidity: price * usdt};
}
function consolidate(rows) {
  const m = new Map();
  for (const x of rows) {
    const a = parseAd(x); if (!a) continue;
    const key = a.price.toFixed(3);
    m.set(key, (m.get(key) || 0) + a.liquidity);
  }
  return [...m.entries()].map(([price, liquidity]) => ({price:Number(price), liquidity}));
}

async function market(type, limit) {
  const u = new URL("/bapi/c2c/v1/public/c2c/agent/ad-list", BINANCE);
  u.searchParams.set("fiat","BRL");
  u.searchParams.set("asset","USDT");
  u.searchParams.set("tradeType",type);
  u.searchParams.set("limit",String(Math.min(20, Math.max(1, limit))));
  u.searchParams.set("order","price");
  const json = await requestJSON(u.toString());
  return items(json);
}

function send(res, status, type, body) {
  res.writeHead(status, {"Content-Type":type, "Cache-Control":"no-store", "Access-Control-Allow-Origin":"*"});
  res.end(body);
}

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/p2p") {
      const limit = Number(url.searchParams.get("limit") || 20);
      const [buyRaw, sellRaw] = await Promise.all([market("BUY",limit), market("SELL",limit)]);
      const buy = consolidate(buyRaw).sort((a,b)=>a.price-b.price).slice(0,8);
      const sell = consolidate(sellRaw).sort((a,b)=>a.price-b.price).slice(0,8);
      const all = [...buy,...sell];
      const reference = all.sort((a,b)=>b.liquidity-a.liquidity)[0] || null;
      return send(res,200,"application/json",JSON.stringify({
        updatedAt:new Date().toISOString(), buy, sell, reference,
        sourceAds:buyRaw.length+sellRaw.length
      }));
    }
    let file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (file.includes("..")) return send(res,400,"text/plain","Bad request");
    const p = path.join(PUBLIC,file);
    if (!fs.existsSync(p)) return send(res,404,"text/plain","Not found");
    const ext = path.extname(p);
    const type = ext === ".html" ? "text/html; charset=utf-8" : "text/plain";
    send(res,200,type,fs.readFileSync(p));
  } catch (e) {
    console.error(e);
    send(res,502,"application/json",JSON.stringify({error:e.message}));
  }
});
server.listen(PORT,()=>console.log(`João Soluções Financeiras: http://localhost:${PORT}`));
