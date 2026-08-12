"use client";

import { useLocale } from "next-intl";

export default function LocaleSwitcher() {
  const locale = useLocale();

  const toggleLocale = () => {
    const nextLocale = locale === "zh" ? "en" : "zh";
    document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=31536000`;
    window.location.reload();
  };

  return (
    <button
      onClick={toggleLocale}
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
      title={locale === "zh" ? "Switch to English" : "切换到中文"}
    >
      {locale === "zh" ? "EN" : "中"}
    </button>
  );
}
