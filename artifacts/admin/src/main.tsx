import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadPlatformConfig } from "./lib/platformConfig";

loadPlatformConfig();

createRoot(document.getElementById("root")!).render(<App />);
