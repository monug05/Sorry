const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
// Set this in Render's environment variables (Settings -> Environment) to a
// long random string. It's the password needed to view the logs page.
const ADMIN_KEY = process.env.ADMIN_KEY || "changeme";

const html = fs.readFileSync(path.join(__dirname, "index.html"));

// In-memory log buffer. Resets whenever the service restarts/sleeps (Render
// free tier spins down after inactivity), so this is "recent activity",
// not permanent storage. Every entry is also printed to stdout, which Render
// captures permanently in its own Logs tab.
const MAX_LOGS = 1000;
const logs = [];

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress;
}

function addLog(entry) {
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  console.log(JSON.stringify(entry));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Main page — log every visit
  if (req.method === "GET" && reqUrl.pathname === "/") {
    addLog({
      type: "visit",
      time: new Date().toISOString(),
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"] || "",
      referrer: req.headers["referer"] || ""
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    });
    res.end(html);
    return;
  }

  // Button click tracking (Yes / Not Yet) — called from index.html
  if (req.method === "POST" && reqUrl.pathname === "/api/event") {
    const body = await readBody(req);
    let payload = {};
    try { payload = JSON.parse(body); } catch (e) { /* ignore bad payloads */ }

    addLog({
      type: "click",
      name: typeof payload.name === "string" ? payload.name.slice(0, 50) : "unknown",
      time: new Date().toISOString(),
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"] || ""
    });
    res.writeHead(204);
    res.end();
    return;
  }

  // Simple password-protected log viewer:
  // https://your-app.onrender.com/admin/logs?key=YOUR_ADMIN_KEY
  if (req.method === "GET" && reqUrl.pathname === "/admin/logs") {
    if (reqUrl.searchParams.get("key") !== ADMIN_KEY) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(logs.slice().reverse(), null, 2));
    return;
  }

  // Health-check endpoint — pinged every 5 min by UptimeRobot to prevent sleep.
  // Logged to console (Render Logs tab) but NOT to in-memory buffer,
  // so /admin/logs stays clean with only real human visitors.
  if (req.method === "GET" && reqUrl.pathname === "/ping") {
    console.log(JSON.stringify({ type: "ping", time: new Date().toISOString(), ip: getClientIp(req) }));
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
