"use client";

import type { ReactNode } from "react";
import { POAProvider } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  return <POAProvider>{children}</POAProvider>;
}
