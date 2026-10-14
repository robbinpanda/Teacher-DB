"use client";
import { useEffect } from "react";
import { reportBrowserRuntime } from "../lib/browser-runtime";

export function RuntimeDiagnostics() {
  useEffect(() => {
    reportBrowserRuntime("start");
    const timer = window.setInterval(() => reportBrowserRuntime("sample"), 15000);
    const error = () => reportBrowserRuntime("error");
    const rejected = () => reportBrowserRuntime("unhandled_rejection");
    const hidden = () => reportBrowserRuntime("pagehide");
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejected);
    window.addEventListener("pagehide", hidden);
    return () => {
      clearInterval(timer);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejected);
      window.removeEventListener("pagehide", hidden);
    };
  }, []);
  return null;
}
