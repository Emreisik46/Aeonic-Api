require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json());

// Database (only has: player_snapshots, votes, launcher_news)
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "aeonic",
  waitForConnections: true,
  connectionLimit: 10,
});

// Game server internal API (all live game data comes from here)
const GAME_SERVER = "http://127.0.0.1:8086";
const SECRET = "SECRET_KEY";

// ---- Helper: fetch from game server ----
function fetchFromGame(path) {
  return new Promise((resolve) => {
    const req = http.get(`${GAME_SERVER}${path}`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}


// ================================================================
//                     LAUNCHER ENDPOINTS
// ================================================================

// GET /api/launcher/status
app.get("/api/launcher/status", async (req, res) => {
  const data = await fetchFromGame("/launcher/status");
  if (data) return res.json(data);
  res.json({ online: false, players: 0, maxPlayers: 500, uptime: "" });
});

// GET /api/launcher/hiscores (PK leaderboard — live from game server)
app.get("/api/launcher/hiscores", async (req, res) => {
  const live = await fetchFromGame("/launcher/hiscores");
  if (live && live.length > 0) return res.json(live);
  res.json([]);
});

// GET /api/launcher/community (world bosses + events — live from game server)
app.get("/api/launcher/community", async (req, res) => {
  const data = await fetchFromGame("/launcher/community");
  if (data) return res.json(data);
  res.json({ worldBosses: [], events: [] });
});

// GET /api/launcher/drops (rare drops — live from game server)
app.get("/api/launcher/drops", async (req, res) => {
  const live = await fetchFromGame("/launcher/drops");
  if (live && live.length > 0) return res.json(live);
  res.json([]);
});

// GET /api/launcher/news (always from DB — edits/deletes only update DB)
app.get("/api/launcher/news", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT title, message, DATE_FORMAT(created_at, '%Y-%m-%d') as date
      FROM launcher_news ORDER BY created_at DESC LIMIT 20
    `);
    res.json(rows);
  } catch { res.json([]); }
});

// POST /api/launcher/news (from Discord bot — add, edit, delete)
app.post("/api/launcher/news", async (req, res) => {
  if (req.headers.authorization !== SECRET) return res.status(403).json({ error: "forbidden" });

  const { action, discordId, title, message } = req.body;

  if (action === "delete" && discordId) {
    // Delete from database
    await pool.execute("DELETE FROM launcher_news WHERE discord_id = ?", [discordId]).catch(() => {});
    console.log("News deleted: " + discordId);
    return res.json({ ok: true });
  }

  if (action === "edit" && discordId && title) {
    // Update in database
    await pool.execute("UPDATE launcher_news SET title = ?, message = ? WHERE discord_id = ?",
      [title, message || "", discordId]).catch(() => {});
    console.log("News edited: " + discordId);
    return res.json({ ok: true });
  }

  // Default: add
  if (!title) return res.status(400).json({ error: "title required" });

  // Deduplicate — skip if discord_id already exists
  if (discordId) {
    try {
      const [existing] = await pool.query("SELECT id FROM launcher_news WHERE discord_id = ?", [discordId]);
      if (existing.length > 0) return res.json({ ok: true, skipped: true });
    } catch {}
  }

  // Save to database — INSERT IGNORE to prevent duplicates
  pool.execute("INSERT IGNORE INTO launcher_news (title, message, discord_id) VALUES (?, ?, ?)",
    [title, message || "", discordId || null])
    .catch((err) => console.error("DB insert failed:", err.message));

  res.json({ ok: true });
});

// GET /api/launcher/tips
app.get("/api/launcher/tips", async (req, res) => {
  const live = await fetchFromGame("/launcher/tips");
  if (live && live.length > 0) return res.json(live);

  res.json([
    "Use ::home to teleport back to the home area instantly!",
    "Vote daily at aeonicpk.io/vote for free rewards and bonus XP!",
    "Join our Discord for giveaways, events, and community updates.",
    "Type ::commands in-game to see all available commands.",
  ]);
});


// ================================================================
//                     HISCORES (live from game server)
// ================================================================

// GET /api/hiscores/pk — PK leaderboard
app.get("/api/hiscores/pk", async (req, res) => {
  const live = await fetchFromGame("/launcher/hiscores");
  if (live && live.length > 0) return res.json(live);
  res.json([]);
});


// ================================================================
//                     SERVER INFO
// ================================================================

// GET /api/server/status
app.get("/api/server/status", async (req, res) => {
  const data = await fetchFromGame("/launcher/status");
  if (data) return res.json(data);
  res.json({ online: false, players: 0, maxPlayers: 500, uptime: "" });
});

// GET /api/server/online
app.get("/api/server/online", async (req, res) => {
  const data = await fetchFromGame("/launcher/status");
  res.json({ players: data ? data.players : 0 });
});


// ================================================================
//                     VOTES (from database)
// ================================================================

// GET /api/votes/top
app.get("/api/votes/top", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT username as name, COUNT(*) as votes
      FROM votes WHERE claimed = 1
      GROUP BY username ORDER BY votes DESC LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ================================================================
//                     API DOCS
// ================================================================

app.get("/", (req, res) => {
  res.json({
    name: "Aeonic API",
    version: "1.0.0",
    endpoints: {
      launcher: {
        "GET /api/launcher/status": "Server status + player count",
        "GET /api/launcher/hiscores": "PK leaderboard",
        "GET /api/launcher/community": "World bosses + events",
        "GET /api/launcher/drops": "Recent rare drops",
        "GET /api/launcher/news": "News posts",
        "GET /api/launcher/tips": "Daily tips",
        "POST /api/launcher/news": "Add news (requires auth)",
      },
      hiscores: {
        "GET /api/hiscores/pk": "PK leaderboard",
      },
      server: {
        "GET /api/server/status": "Server status",
        "GET /api/server/online": "Player count",
      },
      votes: {
        "GET /api/votes/top": "Top voters",
      },
    },
  });
});


// ================================================================
//                     START
// ================================================================

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Aeonic API running on port ${PORT}`));
