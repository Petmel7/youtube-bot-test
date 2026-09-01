
import { Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import PrivacyPolicy from './pages/PrivacyPolicy';
import "./index.css";

function App() {
    const location = useLocation();
    const routeContainerClass = location.pathname === "/dashboard"
        ? "dashboard-route-container"
        : location.pathname === "/admin"
            ? "admin-route-container"
            : "";
    const containerClassName = `container ${routeContainerClass}`.trim();

    return (
        <div className={containerClassName}>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            </Routes>
        </div>
    );
}

export default App;
