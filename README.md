# 🎓 POA 英语实景交际学习平台

> **Vision-enhanced Production-Oriented Approach** — 让英语学习从真实场景出发，在交际中成长

一个面向大学生的英语实景交际自驱式学习网站。基于 **POA（产出导向法）** 理论，通过 AI 驱动的四步教学闭环，帮助学习者在真实交际情境中提升英语口语能力。

---

## 🧠 核心教学理念

POA（Production-Oriented Approach，产出导向法）强调"学用一体"，以产出任务为驱动，在完成真实交际任务的过程中内化语言能力。

```
📸 实景情境 ──→ 🗣️ 产出尝试 ──→ 📚 输入促成 ──→ 📊 双轨评价 ──→ 🔁 产出验证
     ↑                                                          │
     └──────────────── 证据链报告 📋 ←──────────────────────────┘
```

| 环节 | 说明 |
|------|------|
| 🖼️ **实景情境** | 上传或选择一张真实场景照片，AI 自动识别场景要素并生成 POA 驱动任务 |
| 🎤 **产出尝试** | 与 AI 角色进行英语对话，完成初次产出，系统录音并转写 |
| 🔍 **诊断促成** | AI 精准诊断产出中的 Top 3 不足，生成针对性输入材料与练习 |
| 📈 **双轨评价** | 靶向评估（针对不足改善度）+ 七维基线评估（两轮整体对比） |
| 🏆 **产出验证** | 同场景新情节再次产出，验证学习效果 |
| 📋 **证据链报告** | 完整记录学习全过程，可视化展示成长轨迹 |

---

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 🖥️ **前端** | Next.js 14 + TypeScript | App Router 页面路由 |
| 🎨 **UI** | TailwindCSS + shadcn/ui | 现代化组件库 |
| 📊 **图表** | ECharts + echarts-for-react | 雷达图、条形图可视化 |
| 🔄 **状态** | React Query (TanStack) | 服务端状态管理 |
| 🎙️ **录音** | MediaRecorder API | 浏览器端录音 |
| ⚙️ **后端** | FastAPI + Python 3.12 | 高性能异步 API |
| 🗄️ **数据库** | SQLite / PostgreSQL | 开发/生产环境 |
| ⏳ **异步** | Celery + Redis | 异步任务队列 |
| 🤖 **AI** | GPT-4V + GPT-4o-mini + Whisper | VLM 场景识别、LLM 诊断评价、ASR 语音转写 |
| ☁️ **存储** | AWS S3 / 兼容存储 | 照片与录音文件存储 |

---

## 📁 项目结构

```
V-POA/
├── 📄 README.md                    # 项目说明
├── 📄 AGENTS.md                    # 团队协作指南
├── 📄 PROJECT_RULES.md             # 项目开发规范
├── 🖥️ frontend/                    # 前端项目 (Next.js)
│   ├── app/                        # 页面路由
│   │   ├── page.tsx                # 首页
│   │   ├── scenario/page.tsx       # 实景情境页
│   │   ├── task/page.tsx           # 任务展示页
│   │   ├── attempt1/page.tsx       # 产出尝试页
│   │   ├── facilitate/page.tsx     # 诊断促成页
│   │   ├── attempt2/page.tsx       # 产出验证页
│   │   ├── evaluate/page.tsx       # 双轨评价页
│   │   └── report/page.tsx         # 证据链报告页
│   ├── components/                 # 可复用组件
│   └── lib/                        # 工具函数
├── ⚙️ backend/                     # 后端项目 (FastAPI)
│   ├── app/
│   │   ├── main.py                 # 应用入口
│   │   ├── api/                    # API 路由
│   │   │   ├── poa_routes.py       # POA 核心路由
│   │   │   └── storage_routes.py   # 文件存储路由
│   │   ├── models/                 # 数据库模型
│   │   ├── schemas/                # Pydantic 校验
│   │   └── services/               # 业务逻辑 + AI 服务
│   ├── config/                     # 配置管理
│   └── requirements.txt            # Python 依赖
└── 📄 .gitignore
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **Python** >= 3.11
- **Redis**（用于 Celery 异步任务）

### 1️⃣ 克隆仓库

```bash
git clone https://github.com/Frostsnow35/Vision-enhanced-Production-Oriented-Approach.git
cd Vision-enhanced-Production-Oriented-Approach
```

### 2️⃣ 启动后端

```bash
cd backend

# 创建虚拟环境
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS/Linux

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入你的 API Keys

# 启动服务
python start.py
```

后端默认运行在 `http://localhost:8000`，API 文档在 `/docs`。

### 3️⃣ 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端默认运行在 `http://localhost:3000`。

### 4️⃣ 启动 Celery Worker（可选）

```bash
cd backend
celery -A app.tasks worker --loglevel=info --pool=solo
```

---

## 🔌 API 概览

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/` | 健康检查 |
| `POST` | `/api/v1/generate-task` | 上传照片，生成 POA 任务 |
| `POST` | `/api/v1/transcribe` | 上传录音，ASR 转写 |
| `POST` | `/api/v1/diagnose` | 提交产出文本，诊断不足 |
| `POST` | `/api/v1/generate-input` | 根据 Gap 生成输入材料 |
| `POST` | `/api/v1/submit-exercise` | 提交练习答案，获取反馈 |
| `POST` | `/api/v1/evaluate` | 双轨评价（靶向 + 基线） |
| `GET`  | `/api/v1/report/{id}` | 获取证据链报告 |
| `POST` | `/api/v1/upload` | 文件上传（Presigned URL） |

📚 完整 API 文档：启动后端后访问 `http://localhost:8000/docs`

---

## 🗺️ 页面流程

```
┌────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 🏠 首页 │───→│🖼️ 实景情境│───→│📋 任务展示│───→│🎤 产出尝试│
└────────┘    └──────────┘    └──────────┘    └──────────┘
                                                    │
┌──────────┐    ┌──────────┐    ┌──────────┐        │
│📋 证据报告│←───│📊 双轨评价│←───│🏆 产出验证│←───┐   │
└──────────┘    └──────────┘    └──────────┘    │   │
                                                 │   │
                                          ┌──────┘   │
                                          │🔍 诊断促成│
                                          └──────────┘
```

---

## 👥 团队

| 角色 | 负责人 | 职责 |
|------|--------|------|
| 🎨 **前端负责人** | 林 | 页面开发、交互设计、可视化、录音组件 |
| ⚙️ **后端负责人** | 梁 | API 开发、AI 编排、数据库、部署运维 |

---

## 📝 分支策略

| 分支 | 用途 |
|------|------|
| `main` | 🚀 生产就绪代码 |
| `develop` | 🔧 开发集成分支 |
| `feature/day1-infrastructure` | 📦 Day 1 · 基础设施与对齐 |
| `feature/day2-scenario` | 🖼️ Day 2 · 实景情境模块 |
| `feature/day3-attempt-diagnosis` | 🎤 Day 3 · 产出尝试 + 诊断 |
| `feature/day4-facilitate` | 📚 Day 4 · 输入促成模块 |
| `feature/day5-evaluate` | 📊 Day 5 · 双轨评价 + 产出验证 |
| `feature/day6-report` | 📋 Day 6 · 证据链报告 + 联调 |
| `feature/day7-demo` | 🎬 Day 7 · 演示准备与优化 |

---

## 📄 许可证

本项目仅供教育研究与演示用途。

---

<p align="center">
  <sub>Made with ❤️ for better English learning</sub>
</p>