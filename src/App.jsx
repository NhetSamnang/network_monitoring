
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
} from "react-router-dom";

import {
  LayoutDashboard,
  Server,
  Monitor,
  Video,
  Fingerprint,
} from "lucide-react";

import Dashboard from "./Pages/Dashboard";
import PosMaster from "./Pages/PosMaster";
import PosClient from "./Pages/PosClient";
import CCTV from "./Pages/CCTV";
import FingerPrint from "./Pages/FingerPrint";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <aside className="sidebar">
          <h2 className="logo">Network Monitor</h2>

          <nav className="sidebar-nav">
            <NavLink to="/" end className="nav-link">
              <LayoutDashboard size={20} />
              <span>Dashboard</span>
            </NavLink>

            <NavLink to="/pos-master" className="nav-link">
              <Server size={20} />
              <span>POS Master</span>
            </NavLink>

            <NavLink to="/pos-client" className="nav-link">
              <Monitor size={20} />
              <span>POS Client</span>
            </NavLink>

            <NavLink to="/cctv" className="nav-link">
              <Video size={20} />
              <span>CCTV</span>
            </NavLink>
            
            <NavLink to="/fingerprint" className="nav-link">
              <Fingerprint size={20} />
              <span>FingerPrint</span>
            </NavLink>
          </nav>
        </aside>

        <main className="main-content">
          <header className="topbar">
            <h3>IP Network Management</h3>
          </header>

          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pos-master" element={<PosMaster />} />
            <Route path="/pos-client" element={<PosClient />} />
            <Route path="/cctv" element={<CCTV />} />
            <Route path="/fingerprint" element={<FingerPrint />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
