const express = require("express");
const path = require("path");
const irctcRoutes = require("./irctcRoutes");

const router = express.Router();

router.use(irctcRoutes);

router.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

router.post("/api/feedback", (req, res) => {
  const feedback = String(req.body?.feedback || "").trim();

  if (!feedback) {
    return res.status(400).json({ error: "feedback is required" });
  }

  const timestamp = new Date().toISOString();
  const userAgent = req.get("user-agent") || "unknown";
  const ip = req.ip || req.socket?.remoteAddress || "unknown";

  console.log("[feedback]", JSON.stringify({ timestamp, ip, userAgent, feedback }));

  return res.json({ ok: true });
});

router.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

module.exports = router;
