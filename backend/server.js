require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const { isIP } = require("net");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

const CATEGORIES = [
  "POS Master",
  "POS Client",
  "CCTV",
  "Fingerprint",
];

app.use(cors({
  origin: process.env.FRONTEND_URL
    ? [
        process.env.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:5174",
      ]
    : true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.json({
      success: true,
      message: "Backend and database connected",
      database: "Connected",
    });
  } catch (error) {
    console.error("Database health check:", error.message);

    res.status(500).json({
      success: false,
      message: "Database connection failed",
      detail: error.message,
    });
  }
});

// Validate device
function validateDevice(body) {
  const name = String(body.name || "").trim();
  const ip = String(body.ip || "").trim();
  const type = String(body.type || "").trim();
  const category = String(body.category || "").trim();

  if (!name || !ip || !category) {
    return {
      error: "Name, IP address, and category are required.",
    };
  }

  if (isIP(ip) !== 4) {
    return {
      error: "Enter a valid IPv4 address.",
    };
  }

  if (!CATEGORIES.includes(category)) {
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
    const ip = String(device.ip || "");

    if (isIP(ip) !== 4) {
      return resolve({
        ...device,
        status: "Offline",
        lastChecked: new Date(),
      });
    }

    const windows = process.platform === "win32";

    const args = windows
      ? ["-n", "1", "-w", "1500", ip]
      : ["-n", "-c", "1", "-W", "2", ip];

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

// Get all devices
app.get("/api/devices", async (req, res) => {
  try {
    const [devices] = await db.query(
      "SELECT * FROM devices ORDER BY id"
    );

    res.json({ devices });
  } catch (error) {
    console.error("GET devices:", error.message);

    res.status(500).json({
      message: "Failed to load devices.",
      detail: error.message,
    });
  }
});

// Add a device
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
    console.error("POST device:", error.message);

    res.status(500).json({
      message: "Failed to add device.",
      detail: error.message,
    });
  }
});

// Update a device
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

    if (!existing.length) {
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
    console.error("PUT device:", error.message);

    res.status(500).json({
      message: "Failed to update device.",
      detail: error.message,
    });
  }
});

// Delete a device
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

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Device not found.",
      });
    }

    res.json({
      message: "Device deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE device:", error.message);

    res.status(500).json({
      message: "Failed to delete device.",
      detail: error.message,
    });
  }
});

// Check all devices
let checkPromise = null;

async function checkAllDevices() {
  if (checkPromise) return checkPromise;

  checkPromise = (async () => {
    const [devices] = await db.query(
      "SELECT * FROM devices ORDER BY id"
    );

    const results = await Promise.all(
      devices.map(pingDevice)
    );

    for (const device of results) {
      await db.execute(
        `UPDATE devices
         SET status = ?, lastChecked = ?
         WHERE id = ?`,
        [device.status, device.lastChecked, device.id]
      );
    }

    return results;
  })();

  try {
    return await checkPromise;
  } finally {
    checkPromise = null;
  }
}

app.post("/api/check", async (req, res) => {
  try {
    const devices = await checkAllDevices();

    res.json({
      message: "Network check completed.",
      devices,
    });
  } catch (error) {
    console.error("Check devices:", error.message);

    res.status(500).json({
      message: "Failed to check devices.",
      detail: error.message,
    });
  }
});

// Check one device
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

    if (!rows.length) {
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
      message: "Device checked successfully.",
      device: result,
    });
  } catch (error) {
    console.error("Check single device:", error.message);

    res.status(500).json({
      message: "Failed to check device.",
      detail: error.message,
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
  console.error("Server error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    message: "Internal server error.",
  });
});

// Start server only after testing database connectivity
async function startServer() {
  try {
    await db.query("SELECT 1");
    console.log("MySQL connected successfully.");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Backend running on port ${PORT}`);
    });

    // Run a check every 60 seconds
    setInterval(() => {
      checkAllDevices().catch((error) => {
        console.error("Scheduled check:", error.message);
      });
    }, 60000);
  } catch (error) {
    console.error("MySQL connection failed:", error.message);
    process.exit(1);
  }
}

startServer();