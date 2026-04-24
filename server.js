const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8000);
const HOST = "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const PINS_FILE = process.env.PINS_FILE || path.join(DATA_DIR, "pins.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1635";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-session-secret";
const COOKIE_NAME = "devins_food_reviews_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

ensurePinsFile();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/session") {
      return handleSession(req, res);
    }

    if (url.pathname === "/api/pins") {
      return handlePins(req, res);
    }

    if (url.pathname.startsWith("/api/pins/")) {
      return handlePinDeletion(req, res, url.pathname.split("/").pop());
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Devin's Food Reviews listening on http://${HOST}:${PORT}`);
});

function ensurePinsFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PINS_FILE)) {
    fs.writeFileSync(PINS_FILE, "[]\n");
  }
}

function readPins() {
  try {
    const raw = fs.readFileSync(PINS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writePins(pins) {
  fs.writeFileSync(PINS_FILE, `${JSON.stringify(pins, null, 2)}\n`);
}

function handleSession(req, res) {
  if (req.method === "GET") {
    return json(res, 200, { isAdmin: isAuthenticated(req) });
  }

  if (req.method === "POST") {
    return readJsonBody(req, (body) => {
      if (body.password !== ADMIN_PASSWORD) {
        return json(res, 401, { error: "Unauthorized" });
      }

      const cookieValue = createSessionCookieValue();
      res.setHeader("Set-Cookie", buildSessionCookie(cookieValue));
      return json(res, 200, { ok: true, isAdmin: true });
    });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "Method not allowed" });
}

function handlePins(req, res) {
  if (req.method === "GET") {
    return json(res, 200, { pins: readPins() });
  }

  if (req.method === "POST") {
    if (!isAuthenticated(req)) {
      return json(res, 401, { error: "Unauthorized" });
    }

    return readJsonBody(req, (body) => {
      const pin = normalizePin(body);
      if (!pin) {
        return json(res, 400, { error: "Invalid pin payload" });
      }

      const pins = readPins();
      pins.unshift(pin);
      writePins(pins);
      return json(res, 201, { pin, pins });
    });
  }

  return json(res, 405, { error: "Method not allowed" });
}

function handlePinDeletion(req, res, pinId) {
  if (req.method !== "DELETE") {
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!isAuthenticated(req)) {
    return json(res, 401, { error: "Unauthorized" });
  }

  const pins = readPins().filter((pin) => pin.id !== pinId);
  writePins(pins);
  return json(res, 200, { ok: true, pins });
}

function serveStatic(req, res, requestPath) {
  const normalizedPath = requestPath.startsWith("/world_pin_map/")
    ? requestPath.slice("/world_pin_map".length)
    : requestPath;
  const safePath = normalizedPath === "/" ? "/index.html" : normalizedPath;
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    return json(res, 403, { error: "Forbidden" });
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      return json(res, 404, { error: "Not found" });
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    });
    res.end(buffer);
  });
}

function normalizePin(body) {
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const rating = Number(body.rating);
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!name || !description) return null;
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: crypto.randomUUID(),
    name,
    description,
    rating,
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    createdAt: new Date().toISOString(),
  };
}

function readJsonBody(req, callback) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    try {
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      callback(JSON.parse(raw));
    } catch (error) {
      json(req, 400, { error: "Invalid JSON" });
    }
  });
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf("=");
        return [part.slice(0, eq), decodeURIComponent(part.slice(eq + 1))];
      }),
  );
}

function createSessionCookieValue() {
  const payload = {
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const value = cookies[COOKIE_NAME];
  if (!value) return false;

  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return false;
  if (sign(encoded) !== signature) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return Number.isFinite(payload.exp) && payload.exp > Date.now();
  } catch (error) {
    return false;
  }
}

function sign(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}

function buildSessionCookie(value) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}
