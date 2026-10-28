import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { Toaster } from "react-hot-toast";

createRoot(document.getElementById("root")).render(
  <>
    <App />
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 2500,
        style: {
          borderRadius: "12px",
          background: "#1e293b",
          color: "#fff",
          fontSize: "14px",
        },
        success: {
          iconTheme: { primary: "#12a150", secondary: "#fff" },
        },
        error: {
          iconTheme: { primary: "#e5484d", secondary: "#fff" },
        },
      }}
    />
  </>
);