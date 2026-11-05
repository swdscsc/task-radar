# 办事雷达 · TaskCard

把「通知 / 群消息 / 截图」一键解析成结构化的**办事卡**：自动提取事项、截止时间、待办清单、所需材料、办理步骤，并支持**登录后云端保存（跨设备同步）**与**到期提醒**。

一个产品，两端共用同一套云端后端：

- `web/` —— 电脑/手机浏览器网页版（已上线，含登录 + 云端同步 + 提醒）
- `miniprogram/` —— 微信小程序端（已接入同一云端后端：登录 + 跨设备同步 + 本地兜底）

---

## 功能

- **智能解析**：粘贴通知原文或上传截图（OCR），AI 提取结构化办事卡。
- **结构化结果**：标题、分类、截止时间（含规范化日期）、待办清单、所需材料、办理步骤、待确认疑问。
- **账号登录**：WorkBuddy 账号登录（OAuth），每人数据按账号隔离（RLS）。
- **云端保存 + 跨设备**：登录后办事卡与提醒存入云端，手机/电脑通用。
- **到期提醒**：提醒中心 + 浏览器通知（页面打开时轮询到期提醒）；提醒时间可预设或自定义。
- **本地兜底**：未登录时数据仅存本机浏览器 / 小程序本地，不上传。

## 架构

```
                 ┌──────────────┐        ┌──────────────────────┐
   浏览器网页 ───▶│              │        │  WorkBuddy Cloud      │
   (web/)        │  同一云端后端 │───────▶│  - Auth (OAuth)        │
                 │  (endpoint)  │        │  - Database (RLS)      │
   微信小程序 ───▶│              │        │  - Storage / LLM       │
   (miniprogram/)└──────────────┘        └──────────────────────┘
```

- 后端：`wbapp_XrK8n6IQEOHB04l0XXM43T` 的 WorkBuddy Cloud Service（Auth / Database / Storage / LLM，无第三方付费）。
- 数据表：`cards`（办事卡）、`reminders`（提醒），均开启行级安全（RLS），`owner_id = auth.uid()` 隔离。
- 前端：网页端用全局 `WorkBuddyCloud` SDK；小程序端用 `/miniprogram` SDK 子路径。

## 目录

```
task-radar/
├── web/                 # 网页版（静态站点，可直接托管）
│   ├── index.html
│   ├── assets/app.js     # 主逻辑 + 解析
│   ├── assets/account.js # 云端账户/卡片/提醒/通知层
│   ├── assets/styles.css
│   └── vendor/           # WorkBuddyCloud SDK
└── miniprogram/          # 微信小程序
    ├── pages/            # index(解析) / cards(我的卡) / settings
    └── utils/            # api / ocr / store / samples / system-prompt
```

## 本地运行

### 网页版（本地开发）
源码是多文件结构，直接静态托管 `web/` 即可本地预览：
```bash
cd web
python3 -m http.server 8080
# 打开 http://localhost:8080
```
> 登录/云端功能依赖 `assets/account.js` 中的 `endpoint` 与 `publishableKey`（公开可提交，非密钥）。

### 网页版（构建为单文件再部署）
WorkBuddy Sites 的网关会把 `/assets/*` 等所有路径重写回入口 `index.html`，导致多文件静态站点无法加载 JS/CSS。故部署前需把资源内联成单文件：
```bash
cd web
python3 build.py        # 读取 src-template.html + assets/ + vendor/ → 生成单文件 index.html
```
生成的 `index.html` 即为可直接部署到 WorkBuddy Sites（`language: static`）的产物，零外部请求。

### 微信小程序
用**微信开发者工具**打开 `miniprogram/` 目录即可预览。

## 状态与路线

- [x] 网页版：解析 / 登录 / 云端卡片 / 提醒中心 / 浏览器通知
- [x] 网页版：截图 OCR 识别任务
- [x] 小程序：解析 / 本地卡片 / OCR
- [x] 小程序：接入同一云端后端（登录 + 跨设备同步 + 本地兜底）
- [ ] 真正的后台推送（Web Push / 微信订阅消息，应用关闭时也能提醒）

## 隐私

- 解析时消息文本会发送给模型服务用于生成结构化结果。
- 登录后数据按账号隔离存储在云端；未登录仅存本地。
- 不采集账号密码，不绕过任何平台权限。
