# 修复上传图片生成交际任务 500 错误 Spec

## Overview
- **Summary**: 用户上传图片后点击"生成交际任务"时，后端 `/api/upload/image` 返回 500 Internal Server Error，导致无法生成交际任务。
- **Purpose**: 定位并修复上传流程中的500错误，确保图片上传和场景分析功能在 Railway 部署环境中正常工作。
- **Target Users**: POA英语学习平台用户

## Goals
- 修复 `/api/upload/image` 500 错误
- 确保图片上传后能成功生成交际任务
- 提供详细的错误日志便于问题定位

## Non-Goals (Out of Scope)
- 不修改 AI 模型调用逻辑
- 不修改前端 UI 设计
- 不改变已有的业务流程

## Background & Context
- 后端服务运行在 Railway 平台：`https://backend-production-6e0c.up.railway.app/`
- 前端服务运行在 Railway 平台：`https://frontend-production-f3d6.up.railway.app/`
- 后端健康检查正常，但上传端点返回 500

## Functional Requirements
- **FR-1**: 用户上传 JPG/PNG 图片应成功保存到服务器
- **FR-2**: 上传成功后应返回包含 `image_url` 的 JSON 响应
- **FR-3**: 场景分析 API 应能正确读取上传的图片文件

## Non-Functional Requirements
- **NFR-1**: 上传失败时应返回详细的错误信息
- **NFR-2**: 应提供调试端点便于排查问题

## Constraints
- **Technical**: Railway 部署环境，文件系统权限可能受限
- **Dependencies**: 依赖 `python-multipart` 处理文件上传

## Assumptions
- 后端服务已正确启动
- API 路由已正确注册
- 环境变量配置正确

## Acceptance Criteria

### AC-1: 上传图片成功
- **Given**: 用户选择一张 JPG/PNG 图片（< 5MB）
- **When**: 点击"生成交际任务"按钮
- **Then**: `/api/upload/image` 返回 200 状态码和 `{"image_url": "..."}`
- **Verification**: `programmatic`

### AC-2: 上传失败返回详细错误
- **Given**: 上传过程中发生错误（权限不足、磁盘满等）
- **When**: 点击"生成交际任务"按钮
- **Then**: 返回 500 状态码，响应体包含详细错误信息
- **Verification**: `programmatic`

### AC-3: 调试端点可用
- **Given**: 后端服务运行中
- **When**: 访问 `/debug` 端点
- **Then**: 返回服务器状态、目录结构、环境变量等信息
- **Verification**: `human-judgment`

## Open Questions
- [ ] Railway 环境中 `/tmp` 目录是否可写？
- [ ] 上传目录权限是否正确？

