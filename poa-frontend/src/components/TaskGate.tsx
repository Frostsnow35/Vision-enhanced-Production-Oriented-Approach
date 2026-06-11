"use client";

import { useEffect, useState, type ReactNode } from "react";
import HistoryTaskSelector from "./HistoryTaskSelector";
import { isTaskSelectedInSession } from "@/lib/store";

function getCurrentTaskFromStorage(): boolean {
  try {
    const raw = localStorage.getItem("currentTask");
    if (!raw) return false;
    const task = JSON.parse(raw);
    return !!(task && (task.scene_label || task.roles || task.goal));
  } catch {
    return false;
  }
}

export default function TaskGate({ children }: { children: ReactNode }) {
  const [hasTask, setHasTask] = useState<boolean | null>(null);

  useEffect(() => {
    const exists = getCurrentTaskFromStorage() && isTaskSelectedInSession();
    setHasTask(exists);
  }, []);

  if (hasTask === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-muted-foreground">加载中...</span>
      </div>
    );
  }

  if (!hasTask) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <HistoryTaskSelector reloadOnSelect={true} />
      </div>
    );
  }

  return <>{children}</>;
}
