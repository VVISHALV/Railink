const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const routes = require("./routes");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const REDIRECT_HTTP_TO_HTTPS = String(process.env.REDIRECT_HTTP_TO_HTTPS || "false") === "true";
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

// If running behind a reverse proxy, allow protocol detection via X-Forwarded-Proto.
app.set("trust proxy", true);

if (REDIRECT_HTTP_TO_HTTPS) {
  app.use((req, res, next) => {
    if (req.secure) return next();
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  });
}

app.use(routes);

function createHttpsOptions() {
  if (!SSL_KEY_PATH || !SSL_CERT_PATH) return null;
  return {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH)
  };
}

function startServer() {
  const httpsOptions = createHttpsOptions();

  if (!httpsOptions) {
    app.listen(PORT, HOST, () => {
      console.log(`Rail vacancy app running on http://${HOST}:${PORT}`);
      console.log("HTTPS disabled: set SSL_KEY_PATH and SSL_CERT_PATH to enable TLS");
    });
    return;
  }

  https.createServer(httpsOptions, app).listen(HTTPS_PORT, HOST, () => {
    console.log(`Rail vacancy app running on https://${HOST}:${HTTPS_PORT}`);
  });

  if (!REDIRECT_HTTP_TO_HTTPS) {
    http.createServer(app).listen(PORT, HOST, () => {
      console.log(`HTTP also available on http://${HOST}:${PORT}`);
    });
  } else {
    http
      .createServer((req, res) => {
        const location = `https://${req.headers.host ? req.headers.host.split(":")[0] : HOST}:${HTTPS_PORT}${req.url}`;
        res.writeHead(301, { Location: location });
        res.end();
      })
      .listen(PORT, HOST, () => {
        console.log(`HTTP redirect enabled on http://${HOST}:${PORT} -> https://${HOST}:${HTTPS_PORT}`);
      });
  }
}

startServer();
