
import { Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import PrivacyPolicy from './pages/PrivacyPolicy';
import "./index.css";

function App() {
    const location = useLocation();
    const containerClassName = location.pathname === "/dashboard" ? "container dashboard-route-container" : "container";

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
