import type { IncomingMessage, ServerResponse } from "node:http";

const REST_API = (process.env.QOR_REST_API || "https://api-testnet.qore.host").replace(/\/+$/, "");

export default async function handler(req: IncomingMessage & { query?: { address?: string } }, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const address = req.query?.address || (req.url || "").split("/").pop() || "";
  if (!/^qor1[a-z0-9]{20,}$/.test(address)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Expected a valid qor1... address." }));
    return;
  }

  try {
    const upstream = await fetch(`${REST_API}/qorechain/pqc/v1/evm_window/${address}`);
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", "application/json");
    res.end(text);
  } catch {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Upstream REST unavailable." }));
  }
}
