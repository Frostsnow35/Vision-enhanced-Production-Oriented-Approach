/**
 * Locale-aware utility functions for bilingual content display.
 * 
 * Usage:
 *   const locale = useLocale();
 *   const displayText = pickLocale(data.field, data.field_en, locale);
 */

/**
 * Pick the correct language version for a bilingual field.
 * Falls back to the Chinese version if English is not available.
 */
export function pickLocale(
  zhValue: string | null | undefined,
  enValue: string | null | undefined,
  locale: string,
): string {
  const effectiveLocale = locale || "zh";
  if (effectiveLocale === "en" && enValue) return enValue;
  return zhValue || "";
}

/**
 * Pick locale-aware content from an object that may have `_en` suffixed fields.
 * Example: pickLocaleField(data, "scene_label", "en") → data.scene_label_en || data.scene_label
 */
export function pickLocaleField<T extends Record<string, any>>(
  data: T | null | undefined,
  field: string,
  locale: string,
): string {
  if (!data) return "";
  const enField = `${field}_en`;
  const effectiveLocale = locale || "zh";
  if (effectiveLocale === "en" && data[enField]) return String(data[enField]);
  return String(data[field] || "");
}

/**
 * Pick locale-aware content from an object's translations JSON field.
 * Example: pickTranslation(obj, "label", "en") → obj.translations?.label || obj.label
 */
export function pickTranslation<T extends Record<string, any>>(
  data: T | null | undefined,
  field: string,
  locale: string,
): string {
  if (!data) return "";
  const effectiveLocale = locale || "zh";
  if (effectiveLocale === "en") {
    const translations = data.translations as Record<string, string> | undefined;
    if (translations?.[field]) return translations[field];
    // Also try _en suffixed field
    const enValue = data[`${field}_en`];
    if (enValue) return String(enValue);
  }
  return String(data[field] || "");
}
