
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import WalletConnectionProvider from "./wallet/appKit";
import "./index.css";
import "./i18n";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
    <ThemeProvider>
        <WalletConnectionProvider>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </WalletConnectionProvider>
    </ThemeProvider>
);

