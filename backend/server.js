
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const { isIP } = require("net");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

const ALLOWED_CATEGORIES = ["POS Master", "CCTV"];

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
    ],
  })
);

app.use(express.json());

// Check whether a device responds to a Windows ping.
function pingDevice(device) {
  return new Promise((resolve) => {
    if (!isIP(device.ip)) {
      return resolve({
        ...device,
        status: "Offline",
        lastChecked: new Date(),
      });
    }

    execFile(
      "ping",
      ["-n", "1", "-w", "1500", device.ip],
      { timeout: 2500, windowsHide: true },
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

// Prevent overlapping full network checks.
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

    // Save each device's latest status in MySQL.
    await Promise.all(
      results.map((device) =>
        db.execute(
          `UPDATE devices
           SET status = ?, lastChecked = ?
           WHERE id = ?`,
          [
            device.status,
            device.lastChecked,
            device.id,
          ]
        )
      )
    );

    const online = results.filter(
      (device) => device.status === "Online"
    ).length;

    console.log(
      `[${new Date().toLocaleString()}] Checked ${
        results.length
      } devices: ${online} online, ${
        results.length - online
      } offline`
    );

    return results;
  })().finally(() => {
    checkPromise = null;
  });

  return checkPromise;
}

// Validate device form data.
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

  if (!isIP(ip)) {
    return { error: "Please enter a valid IP address." };
  }

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return {
      error: "Category must be POS Master or CCTV.",
    };
  }

  return {
    value: { name, ip, type, category },
  };
}

// Health check.
app.get("/api/health", (req, res) => {
  res.json({
    message: "Network monitoring backend is running",
  });
});

// GET: Load all devices from MySQL.
app.get("/api/devices", async (req, res) => {
  try {
    const [devices] = await db.query(
      "SELECT * FROM devices ORDER BY id"
    );

    res.json({ devices });
  } catch (error) {
    console.error("Load devices error:", error.message);
    res.status(500).json({
      message: "Failed to load devices from MySQL.",
    });
  }
});

// POST: Add a device to MySQL.
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
    console.error("Add device error:", error.message);
    res.status(500).json({
      message: "Failed to add device to MySQL.",
    });
  }
});

// PUT: Update an existing device.
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
    console.error("Update device error:", error.message);
    res.status(500).json({
      message: "Failed to update device.",
    });
  }
});

// DELETE: Remove a device from MySQL.
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
    console.error("Delete device error:", error.message);
    res.status(500).json({
      message: "Failed to delete device.",
    });
  }
});

// POST: Check all devices.
app.post("/api/check", async (req, res) => {
  try {
    const devices = await checkAllDevices();

    res.json({
      message: "Network check completed.",
      devices,
    });
  } catch (error) {
    console.error("Network check error:", error.message);
    res.status(500).json({
      message: "Failed to check devices.",
    });
  }
});

// POST: Check one device by ID.
app.post("/api/devices/:id/check", async (req, res) => {
  try {
    const id = Number(req.params.id);

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
    console.error("Single device check error:", error.message);
    res.status(500).json({
      message: "Failed to check device.",
    });
  }
});

// Check immediately and then every 60 seconds.
checkAllDevices().catch((error) => {
  console.error("Initial network check failed:", error.message);
});

setInterval(() => {
  checkAllDevices().catch((error) => {
    console.error("Scheduled network check failed:", error.message);
  });
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
