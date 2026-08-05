# 任务选择拦截 & 麦克风先就绪再倒计时 Spec

## Why
两个用户体验问题：(1) 首次打开 attempt1/attempt2/diagnosis/evaluate/facilitate/report 页面时无任务数据，直接跳入空白页；(2) attempt1/attempt2 倒计时不等待麦克风就绪，用户来不及说话。

## What Changes
- **新增** 所有任务关联页面的任务选择拦截：无已选任务时渲染 `HistoryTaskSelector`，用户选完再进入对应页面
- **修改** attempt1/attempt2 的启动流程：`initDevices()` 后等待 `micStatus === "ready"` 再触发倒计时

## Impact
- Affected specs: 无
- Affected code:
  - `poa-frontend/src/app/attempt1/page.tsx`
  - `poa-frontend/src/app/attempt2/page.tsx`
  - `poa-frontend/src/app/diagnosis/page.tsx`
  - `poa-frontend/src/app/evaluate/page.tsx`
  - `poa-frontend/src/app/facilitate/page.tsx`
  - `poa-frontend/src/app/report/page.tsx`
  - `poa-frontend/src/lib/store.tsx`

## ADDED Requirements

### Requirement: 任务关联页面的任务选择拦截
所有与具体任务关联的页面（attempt1、attempt2、diagnosis、evaluate、facilitate、report）SHALL 在渲染前检查是否有已选任务。若无，渲染 `HistoryTaskSelector` 供用户选择。

#### Scenario: 首次访问，无已选任务
- **WHEN** 用户首次访问任一任务关联页面，无 `currentTask` 且 session 无已选标记
- **THEN** 页面渲染 `HistoryTaskSelector` 选择器
- **AND** 用户选择历史任务后刷新当前页面并进入正常内容区
- **AND** 用户可点击"上传新照片"跳转到 `/scenario`

#### Scenario: 会话中已选任务，返回该页面
- **WHEN** 用户在同一会话中已选择过任务，再次访问任务关联页面
- **THEN** 直接进入正常内容区，不显示选择器
- **AND** 页面提供"切换任务"入口供用户更换学习任务

#### Scenario: 无历史记录
- **WHEN** 用户无任何历史场景记录，访问任务关联页面
- **THEN** `HistoryTaskSelector` 显示"暂无学习记录"并指引用户去 `/scenario` 上传照片

### Requirement: 麦克风就绪后再开始倒计时
attempt1 和 attempt2 页面 SHALL 在 `initDevices()` 完成且 `micStatus === "ready"` 后才触发 3-2-1-GO 倒计时。

#### Scenario: 麦克风正常就绪
- **WHEN** 设备检测通过，`initDevices()` 获取到麦克风流
- **THEN** 页面等待 `micStatus` 变为 `"ready"` 后才设置 `countdownKey` 触发倒计时
- **AND** 倒计时开始前显示"准备中..."提示

#### Scenario: 麦克风获取失败
- **WHEN** `initDevices()` 无法获取麦克风流（`micStatus === "error"`）
- **THEN** 页面仍允许进入（使用摄像头音频作为降级），继续倒计时流程
- **AND** 控制台记录 warning 日志
