"use client";

import type { SyntheticEvent } from "react";

const NOTEBOOK_URL =
  "https://notebook.google.com/notebook/e8e53926-d3a7-4808-9689-96879cabe4f4";

export default function Home() {
  function enhanceEngineeringApp(event: SyntheticEvent<HTMLIFrameElement>) {
    const frame = event.currentTarget;
    const doc = frame.contentDocument;
    if (!doc) return;

    const resultTabs = doc.querySelector<HTMLElement>(".nail-result-tabs");
    if (resultTabs && !doc.getElementById("geminiNotebookLink")) {
      const link = doc.createElement("a");
      link.id = "geminiNotebookLink";
      link.href = NOTEBOOK_URL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Gemini notebook";
      link.setAttribute("aria-label", "開啟 Gemini notebook");
      Object.assign(link.style, {
        marginLeft: "auto",
        display: "inline-flex",
        alignItems: "center",
        minHeight: "34px",
        padding: "0 10px",
        color: "#1d4ed8",
        fontSize: "13px",
        fontWeight: "700",
        textDecoration: "none",
        whiteSpace: "nowrap",
        borderRadius: "6px",
      });
      resultTabs.appendChild(link);
    }

    const version = doc.querySelector<HTMLElement>(".site-version");
    if (version) {
      version.textContent = "Version 153 測試";
      version.setAttribute("aria-label", "網站版次 Version 153 測試");
    }
  }

  return (
    <main className="site-shell">
      <iframe
        className="engineering-app"
        src="/engineering-query.html"
        title="工程查詢系統"
        allow="clipboard-read; clipboard-write"
        onLoad={enhanceEngineeringApp}
      />
    </main>
  );
}
