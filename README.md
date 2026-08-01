# 天饺软件开发工作室官网

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
cd C:\Users\LEGION\Documents\Codex\2026-08-02\wo-x\outputs
$env:ADMIN_TOKEN = "请替换为一段足够长的随机字符串"
npm start
```

打开 `http://127.0.0.1:8787/` 查看官网，访问 `/admin.html` 管理咨询。

## GitHub Pages

GitHub Pages 只运行静态网站，不能运行 `server.js`。因此仓库中的前端可以通过 Pages 公开访问，咨询 API 需要把 Node 服务部署到独立的 Node 主机后，再把前端请求地址改成对应 API 地址。

## 已实现

- `POST /api/inquiries`：校验并保存官网咨询表单
- `GET /api/health`：健康检查
- `GET /api/inquiries`：使用 `x-admin-token` 查询咨询
- `PATCH /api/inquiries/:id`：更新咨询状态
- 请求体大小限制、字段校验、蜜罐字段、内存限流、原子写入和基础安全响应头

咨询数据默认保存到 `data/inquiries.json`。邮箱、企业微信和短信通知暂未接入，因为这些渠道需要工作室自己的账号、密钥和接收地址；当前先保证咨询可靠落库，通知作为下一步独立适配器接入。
