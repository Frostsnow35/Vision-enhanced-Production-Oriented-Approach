"use client";

import { useRouter } from "next/navigation";
import DeviceCheckModal from "@/components/DeviceCheckModal";

/**
 * 独立设备检测页 —— 展示设备检测模态框，关闭后返回上一页。
 */
export default function DeviceCheckPage() {
  const router = useRouter();

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <DeviceCheckModal
        open={true}
        onClose={() => router.back()}
      />
    </div>
  );
}
