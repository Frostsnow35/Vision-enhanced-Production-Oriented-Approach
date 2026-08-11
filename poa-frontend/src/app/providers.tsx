"use client";

import { useEffect, useState, ReactNode } from "react";
import { POAProvider } from "@/lib/store";
import { BASE_URL } from "@/lib/api";
import { useTranslations } from "next-intl";

const API_VERSION_KEY = "poa_api_base_url";

function ApiVersionChecker({ children }: { children: ReactNode }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const t = useTranslations("providers");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedUrl = localStorage.getItem(API_VERSION_KEY);

    if (!storedUrl) {
      localStorage.setItem(API_VERSION_KEY, BASE_URL);
      return;
    }

    if (storedUrl !== BASE_URL) {
      console.warn(`[POA] API URL changed: ${storedUrl} → ${BASE_URL}`);
      setShowPrompt(true);
    }
  }, []);

  const handleClearCache = () => {
    localStorage.clear();
    localStorage.setItem(API_VERSION_KEY, BASE_URL);
    setShowPrompt(false);
    window.location.reload();
  };

  const handleDismiss = () => {
    localStorage.setItem(API_VERSION_KEY, BASE_URL);
    setShowPrompt(false);
  };

  return (
    <>
      {showPrompt && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 fade-in duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-card-foreground">{t("config_changed")}</h3>
                <p className="text-xs text-muted-foreground">{t("backend_updated")}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t("config_msg")}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleDismiss}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("later")}
              </button>
              <button
                onClick={handleClearCache}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                {t("clear_and_refresh")}
              </button>
            </div>
          </div>
        </div>
      )}
      {children}
    </>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <POAProvider>
      <ApiVersionChecker>{children}</ApiVersionChecker>
    </POAProvider>
  );
}
