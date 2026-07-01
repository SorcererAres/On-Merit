import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import "./styles/globals.css"; // 唯一样式入口：@import tokens.css + @tailwind 三层

const qc = new QueryClient();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  </React.StrictMode>,
);
