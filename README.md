# 天饺软件开发工作室官网

这是天饺软件开发工作室的官网仓库，包含一套静态展示前端，以及用于接收官网咨询表单的轻量 Node.js 服务。

## 仓库包含什么

- `index.html`：官网首页
- `styles.css`：官网样式
- `script.js`：前端交互与咨询表单提交逻辑
- `admin.html`：咨询管理页
- `server.js`：咨询 API 与静态资源服务
- `assets/`：图片等静态资源

## 当前能力

- 展示工作室定位、服务内容与案例信息
- 提交官网咨询表单
- 通过 `admin.html` 查看咨询记录并更新状态
- 基础输入校验、蜜罐字段、请求体限制、基础安全响应头

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
npm install
$env:ADMIN_TOKEN = "请替换为一段足够长的随机字符串"
npm start
```

启动后访问：

- `http://127.0.0.1:8787/`：官网首页
- `http://127.0.0.1:8787/admin.html`：咨询管理页

## API 说明

- `POST /api/inquiries`：校验并保存官网咨询表单
- `GET /api/health`：健康检查
- `GET /api/inquiries`：使用 `x-admin-token` 查询咨询
- `PATCH /api/inquiries/:id`：更新咨询状态

咨询数据默认保存到 `data/inquiries.json`。

## 部署说明

### 方案 A：单机部署

把前端静态文件和 `server.js` 部署到同一台 Node 主机，前端继续使用当前的同源 `/api/*` 请求即可，部署最简单。

### 方案 B：静态站点 + 独立 API

如果官网前端部署到 GitHub Pages、对象存储或 CDN，而 API 部署到独立 Node 主机，需要额外处理两件事：

1. 把前端的请求地址改为对应的 API 域名或反向代理地址。
2. 为 API 增加跨域、鉴权、限流和日志等生产配置。

## 后续建议

- 咨询通知可以拆成独立适配器，接入邮箱、企业微信或短信。
- 如果准备长期在线收单，建议把 `data/inquiries.json` 迁移到正式数据库。
- 对外部署时，建议在反向代理层补 HTTPS、限流和访问日志。
