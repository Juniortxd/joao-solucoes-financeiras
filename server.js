
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const BINANCE = "https://www.binance.com";

function requestJSON(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "JoaoSolucoesFinanceiras/1.0",
          "Accept": "application/json"
        },
        timeout: 15000
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error(
              "Binance HTTP:",
              res.statusCode,
              body.slice(0, 1000)
            );

            return reject(
              new Error("Binance HTTP " + res.statusCode)
            );
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            console.error(
              "Resposta inválida da Binance:",
              body.slice(0, 1000)
            );

            reject(
              new Error("A Binance não retornou um JSON válido")
            );
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(
        new Error("Tempo limite da Binance excedido")
      );
    });

    request.on("error", reject);
  });
}

function items(json) {
  if (Array.isArray(json?.data)) {
    return json.data;
  }

  if (Array.isArray(json?.data?.data)) {
    return json.data.data;
  }

  if (Array.isArray(json?.data?.items)) {
    return json.data.items;
  }

  console.error(
    "Resposta inesperada da Binance:",
    JSON.stringify(json).slice(0, 2000)
  );

  throw new Error(
    "A Binance respondeu, mas os anúncios vieram em um formato inesperado"
  );
}

function n(...values) {
  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return 0;
}

function parseAd(item) {
  const adv = item.adv || {};

  const price = n(
    item.price,
    adv.price,
    adv.advPrice
  );

  const usdt = n(
    item.surplusAmount,
    item.availableAmount,
    adv.surplusAmount,
    adv.tradableQuantity,
    adv.availableAmount,
    adv.quantity
  );

  if (!price || !usdt) {
    return null;
  }

  return {
    price,
    liquidity: price * usdt
  };
}

function consolidate(rows) {
  const levels = new Map();

  for (const row of rows) {
    const ad = parseAd(row);

    if (!ad) {
      continue;
    }

    const key = ad.price.toFixed(3);

    levels.set(
      key,
      (levels.get(key) || 0) + ad.liquidity
    );
  }

  return [...levels.entries()].map(
    ([price, liquidity]) => ({
      price: Number(price),
      liquidity
    })
  );
}

async function market(type, limit) {
  const url = new URL(
    "/bapi/c2c/v1/public/c2c/agent/ad-list",
    BINANCE
  );

  url.searchParams.set("fiat", "BRL");
  url.searchParams.set("asset", "USDT");
  url.searchParams.set("tradeType", type);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", "price");

  console.log(
    "Consultando Binance P2P:",
    type
  );

  const json = await requestJSON(url.toString());
  console.log("RESPOSTA BINANCE:", JSON.stringify(json).slice(0, 2000));
  const ads = items(json);

  console.log(
    "Anúncios recebidos:",
    type,
    ads.length
  );

  return ads;
}

function send(res, status, type, body) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    );

    if (url.pathname === "/api/p2p") {
      const requestedLimit = Number(
        url.searchParams.get("limit") || 20
      );

      const limit = Number.isFinite(requestedLimit)
        ? Math.min(20, Math.max(1, requestedLimit))
        : 20;

      const [buyRaw, sellRaw] = await Promise.all([
        market("BUY", limit),
        market("SELL", limit)
      ]);

      const buy = consolidate(buyRaw)
        .sort((a, b) => a.price - b.price)
        .slice(0, 8);

      const sell = consolidate(sellRaw)
        .sort((a, b) => a.price - b.price)
        .slice(0, 8);

      const all = [...buy, ...sell];

      const reference =
        [...all].sort(
          (a, b) => b.liquidity - a.liquidity
        )[0] || null;

      console.log(
        "Níveis consolidados:",
        "compra =", buy.length,
        "venda =", sell.length
      );

      return send(
        res,
        200,
        "application/json; charset=utf-8",
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          buy,
          sell,
          reference,
          sourceAds: buyRaw.length + sellRaw.length
        })
      );
    }

    const file = url.pathname === "/"
      ? "index.html"
      : url.pathname.slice(1);

    if (file.includes("..")) {
      return send(
        res,
        400,
        "text/plain",
        "Bad request"
      );
    }

    const filePath = path.join(PUBLIC, file);

    if (!fs.existsSync(filePath)) {
      return send(
        res,
        404,
        "text/plain",
        "Not found"
      );
    }

    const extension = path.extname(filePath);

    const contentType =
      extension === ".html"
        ? "text/html; charset=utf-8"
        : "text/plain";

    return send(
      res,
      200,
      contentType,
      fs.readFileSync(filePath)
    );

  } catch (error) {
    console.error(
      "ERRO NO SERVIDOR:",
      error.message
    );

    return send(
      res,
      502,
      "application/json; charset=utf-8",
      JSON.stringify({
        error: error.message
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(
    `João Soluções Financeiras: servidor iniciado na porta ${PORT}`
  );
});

