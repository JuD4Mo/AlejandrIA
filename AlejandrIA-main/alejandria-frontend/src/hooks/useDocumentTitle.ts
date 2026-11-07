import { useEffect } from "react";
import { es } from "@/i18n/es";

export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title
      ? `${title} · ${es.app.name}`
      : `${es.app.name} · Sala de lectura`;
  }, [title]);
}
