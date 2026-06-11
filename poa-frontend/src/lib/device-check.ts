// 设备检测状态工具
// 统一管理"用户是否已通过设备检测"的状态
// - 通过后写入 localStorage.device_check_passed
// - 用于 attempt1/attempt2/facilitate 等需要摄像头/麦克风的页面判断是否置灰功能按钮

const KEY = "device_check_passed";
const AT = "device_check_at";

export function isDeviceCheckPassed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(KEY) === "true";
}

export function markDeviceCheckPassed(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, "true");
  localStorage.setItem(AT, String(Date.now()));
}

export function clearDeviceCheck(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  localStorage.removeItem(AT);
}
