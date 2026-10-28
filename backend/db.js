
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const { isIP } = require("net");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

const ALLOWED_CATEGORIES = [
  "POS Master",
  "POS Client",
  "CCTV",
  "Fingerprint",
];

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Log useful error details without exposing credentials.
function logError(label, error) {
  console.error(label, {
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    sqlState: error?.sqlState,
    sqlMessage: error?.sqlMessage,
  });
}

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.json({
      success: true,
      message: "Network monitoring backend is running",
      database: "Connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logError("Health check error:", error);

    res.status(500).json({
      success: false,
      message: "Backend is running, but database connection failed.",
    });
  }
});

// Validate device information
function validateDevice(body) {
  const name =
    typeof body.name === "string" ? body.name.trim() : "";

  const ip =
    typeof body.ip === "string" ? body.ip.trim() : "";

  const type =
    typeof body.type === "string" ? body.type.trim() : "";

  const category =
    typeof body.category === "string"
      ? body.category.trim()
      : "";

  if (!name || !ip || !category) {
    return {
      error: "Name, IP address, and category are required.",
    };
  }

  if (isIP(ip) !== 4) {
    return {
      error: "Please enter a valid IPv4 address.",
    };
  }

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return {
      error: "Invalid device category.",
    };
  }

  return {
    value: { name, ip, type, category },
  };
}

// Ping a device
function pingDevice(device) {
  return new Promise((resolve) => {
    if (isIP(device.ip) !== 4) {
      return resolve({
        ...device,
        status: "Offline",
        lastChecked: new Date(),
      });
    }

    const isWindows = process.platform === "win32";

    const args = isWindows
      ? ["-n", "1", "-w", "1500", device.ip]
      : ["-n", "-c", "1", "-W", "2", device.ip];

    execFile(
      "ping",
      args,
      { timeout: 4000, windowsHide: true },
      (error) => {
        resolve({
          ...device,
          status: error ? "Offline" : "Online",
          lastChecked: new Date(),
        });
      }
    );
  });
}

// Check all devices. Prevent overlapping checks.
let checkPromise = null;

async function checkAllDevices() {
  if (checkPromise) return checkPromise;

  checkPromise = (async () => {
    const [devices] = await db.query(
      "SELECT * FROM devices ORDER BY id"
    );

    const results = await Promise.all(devices.map(pingDevice));

    for (const device of results) {
      await db.execute(
        `UPDATE devices
         SET status = ?, lastChecked = ?
         WHERE id = ?`,
        [device.status, device.lastChecked, device.id]
      );
    }

    const online = results.filter(
      (device) => device.status === "Online"
    ).length;

    const offline = results.filter(
      (device) => device.status === "Offline"
    ).length;

    console.log(
      `Network check: ${results.length} devices, ` +
      `${online} online, ${offline} offline`
    );

    return results;
  })().finally(() => {
    checkPromise = null;
  });

  return checkPromise;
}

// GET all devices
app.get("/api/devices", async (req, res) => {
  try {
    const [devices] = await db.query(
      "SELECT * FROM devices ORDER BY id"
    );

    res.json({ devices });
  } catch (error) {
    logError("Load devices error:", error);

    res.status(500).json({
      message: "Failed to load devices from MySQL.",
    });
  }
});

// POST add a device
app.post("/api/devices", async (req, res) => {
  try {
    const validation = validateDevice(req.body);

    if (validation.error) {
      return res.status(400).json({
        message: validation.error,
      });
    }

    const { name, ip, type, category } = validation.value;

    const [result] = await db.execute(
      `INSERT INTO devices
       (name, ip, type, category, status, lastChecked)
       VALUES (?, ?, ?, ?, 'Pending', NULL)`,
      [name, ip, type, category]
    );

    const [rows] = await db.execute(
      "SELECT * FROM devices WHERE id = ?",
      [result.insertId]
    );

    res.status(201).json({
      message: "Device added successfully.",
      device: rows[0],
    });
  } catch (error) {
    logError("Add device error:", error);

    res.status(500).json({
      message: "Failed to add device to MySQL.",
    });
  }
});

// PUT update a device
app.put("/api/devices/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: "Invalid device ID.",
      });
    }

    const validation = validateDevice(req.body);

    if (validation.error) {
      return res.status(400).json({
        message: validation.error,
      });
    }

    const [existing] = await db.execute(
      "SELECT id FROM devices WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        message: "Device not found.",
      });
    }

    const { name, ip, type, category } = validation.value;

    await db.execute(
      `UPDATE devices
       SET name = ?, ip = ?, type = ?, category = ?
       WHERE id = ?`,
      [name, ip, type, category, id]
    );

    const [rows] = await db.execute(
      "SELECT * FROM devices WHERE id = ?",
      [id]
    );

    res.json({
      message: "Device updated successfully.",
      device: rows[0],
    });
  } catch (error) {
    logError("Update device error:", error);

    res.status(500).json({
      message: "Failed to update device.",
    });
  }
});

// DELETE a device
app.delete("/api/devices/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: "Invalid device ID.",
      });
    }

    const [result] = await db.execute(
      "DELETE FROM devices WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Device not found.",
      });
    }

    res.json({
      message: "Device deleted successfully.",
    });
  } catch (error) {
    logError("Delete device error:", error);

    res.status(500).json({
      message: "Failed to delete device.",
    });
  }
});

// POST check all devices now
app.post("/api/check", async (req, res) => {
  try {
    const devices = await checkAllDevices();

    res.json({
      message: "Network check completed.",
      devices,
    });
  } catch (error) {
    logError("Network check error:", error);

    res.status(500).json({
      message: "Failed to check devices.",
    });
  }
});

// POST check one device
app.post("/api/devices/:id/check", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: "Invalid device ID.",
      });
    }

    const [rows] = await db.execute(
      "SELECT * FROM devices WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "Device not found.",
      });
    }

    const result = await pingDevice(rows[0]);

    await db.execute(
      `UPDATE devices
       SET status = ?, lastChecked = ?
       WHERE id = ?`,
      [result.status, result.lastChecked, id]
    );

    res.json({
      message: "Device check completed.",
      device: result,
    });
  } catch (error) {
    logError("Single device check error:", error);

    res.status(500).json({
      message: "Failed to check device.",
    });
  }
});

// Unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    message: "API route not found.",
  });
});

// Unexpected errors
app.use((error, req, res, next) => {
  logError("Unexpected server error:", error);

  if (res.headersSent) return next(error);

  res.status(500).json({
    message: "Internal server error.",
  });
});

// Start server first, then verify the database.
// Keep a single interval and avoid starting checks before DB is ready.
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});

let monitoringTimer = null;
let shuttingDown = false;

async function startMonitoring() {
  try {
    await db.query("SELECT 1");
    console.log("MySQL connection successful.");

    try {
      await checkAllDevices();
    } catch (error) {
      logError("Initial network check failed:", error);
    }

    monitoringTimer = setInterval(() => {
      checkAllDevices().catch((error) => {
        logError("Scheduled network check failed:", error);
      });
    }, 60 * 1000);
  } catch (error) {
    logError("Startup database check failed:", error);
  }
}

startMonitoring();

// Graceful shutdown
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (monitoringTimer) clearInterval(monitoringTimer);

  server.close(() => {
    db.end()
      .catch((error) => logError("Database shutdown error:", error))
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
