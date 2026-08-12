"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export default function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("lang");

  const toggleLocale = () => {
    const nextLocale = locale === "zh" ? "en" : "zh";
    document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=31536000`;
    router.refresh();
  };

  return (
    <button
      onClick={toggleLocale}
      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
      title={locale === "zh" ? t("switch_title_en") : t("switch_title_zh")}
    >
      {locale === "zh" ? t("switch_to_en") : t("switch_to_zh")}
    </button>
  );
}
