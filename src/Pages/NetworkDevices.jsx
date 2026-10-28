
import { useCallback, useEffect, useState } from "react";


const API = "https://network-monitoring-1-jzrx.onrender.com/api";

const emptyForm = {
  name: "",
  ip: "",
  type: "",
  category: "POS Master",
};

const categories = [
  "POS Master",
  "POS Client",
  "CCTV",
  "Fingerprint",
];

export default function NetworkDevices({
  category,
  title = "IP Network Dashboard",
}) {
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      const response = await fetch(`${API}/devices`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const list = Array.isArray(data) ? data : data.devices;

      if (!Array.isArray(list)) {
        throw new Error("Invalid device data");
      }

      setDevices(list);
      setError("");
    } catch (err) {
      setError(err.message || "Cannot connect to backend");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();

    const timer = setInterval(loadDevices, 10000);

    return () => clearInterval(timer);
  }, [loadDevices]);

  async function checkNow() {
    setChecking(true);
    setError("");

    try {
      const response = await fetch(`${API}/check`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data.devices)) {
        setDevices(data.devices);
      } else {
        await loadDevices();
      }
    } catch (err) {
      setError(err.message || "Network check failed");
    } finally {
      setChecking(false);
    }
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      category: category || "POS Master",
    });
    setShowForm(true);
    setError("");
  }

  function openEditForm(device) {
    setEditingId(device.id);
    setForm({
      name: device.name || "",
      ip: device.ip || "",
      type: device.type || "",
      category: device.category || "POS Master",
    });
    setShowForm(true);
    setError("");
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const url = editingId
        ? `${API}/devices/${editingId}`
        : `${API}/devices`;

      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name.trim(),
          ip: form.ip.trim(),
          type: form.type.trim(),
          category: form.category,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP ${response.status}`);
      }

      closeForm();
      await loadDevices();
    } catch (err) {
      setError(err.message || "Unable to save device");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(device) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${device.name}" (${device.ip})?`
    );

    if (!confirmed) return;

    setError("");

    try {
      const response = await fetch(`${API}/devices/${device.id}`, {
        method: "DELETE",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP ${response.status}`);
      }

      await loadDevices();
    } catch (err) {
      setError(err.message || "Unable to delete device");
    }
  }

  const filtered = category
    ? devices.filter((device) => device.category === category)
    : devices;

  const onlineCount = filtered.filter(
    (device) => device.status === "Online"
  ).length;

  const offlineCount = filtered.filter(
    (device) => device.status === "Offline"
  ).length;

  return (
    <section className="content">
      <div className="panel-header">
        <h2>{title}</h2>

        <div className="device-actions">
          <button onClick={openAddForm}>
            + Add Device
          </button>

          <button onClick={checkNow} disabled={checking}>
            {checking ? "Checking..." : "Check Now"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="device-form-panel">
          <h3>{editingId ? "Edit Device" : "Add New Device"}</h3>

          <form onSubmit={handleSubmit} className="device-form">
            <label>
              Store / Device Name
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Example: Store 2001"
                required
              />
            </label>

            <label>
              IP Address
              <input
                name="ip"
                value={form.ip}
                onChange={handleChange}
                placeholder="Example: 192.168.1.20"
                required
                pattern="^(([0-9]{1,3})\.){3}([0-9]{1,3})$"
                title="Enter an IPv4 address, such as 192.168.1.20"
              />
            </label>

            <label>
              Device Type
              <input
                name="type"
                value={form.type}
                onChange={handleChange}
                placeholder="Example: Router, DVR, Printer"
              />
            </label>

            <label>
              Category
              <select
                name="category"
                value={form.category}
                onChange={handleChange}
                required
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-actions">
              <button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingId
                  ? "Update Device"
                  : "Save Device"}
              </button>

              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="stats">
        <div className="card">
          <span>Total Devices</span>
          <h2>{filtered.length}</h2>
        </div>

        <div className="card">
          <span>Online</span>
          <h2 className="online">{onlineCount}</h2>
        </div>

        <div className="card">
          <span>Offline</span>
          <h2 className="offline">{offlineCount}</h2>
        </div>
      </div>

      {loading && <p>Loading devices...</p>}

      {error && (
        <p className="error">
          Error: {error}
        </p>
      )}

      {!loading && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Store Name</th>
                <th>IP Address</th>
                <th>Type</th>
                <th>Category</th>
                <th>Status</th>
                <th>Last Checked</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((device) => {
                const status = (
                  device.status || "Pending"
                ).toLowerCase();

                const statusClass =
                  status === "online"
                    ? "online"
                    : status === "offline"
                    ? "offline"
                    : "pending";

                return (
                  <tr key={device.id}>
                    <td>{device.name}</td>
                    <td>{device.ip}</td>
                    <td>{device.type || "-"}</td>
                    <td>{device.category}</td>

                    <td>
                      <span className={statusClass}>
                        {status.charAt(0).toUpperCase() +
                          status.slice(1)}
                      </span>
                    </td>

                    <td>
                      {device.lastChecked
                        ? new Date(
                            device.lastChecked
                          ).toLocaleString()
                        : "Not checked"}
                    </td>

                    <td>
                      <div className="device-actions">
                        <button
                          type="button"
                          onClick={() => openEditForm(device)}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDelete(device)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!error && filtered.length === 0 && (
            <p>No devices found for this category.</p>
          )}
        </div>
      )}
    </section>
  );
}
