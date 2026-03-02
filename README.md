# Cloudflare Proxy (Customized Version)

> 基于 Cloudflare Workers 的全功能 HTTP/HTTPS 代理服务（增强版）

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lemodragon/cloudflare-proxy)

这是一个定制化的 Cloudflare Workers 代理脚本，在原版基础上增加了 **Docker Hub 镜像代理**、**访问令牌控制**、**域名白名单**和**自动引流/跳转**功能。

## 页面展示

![screenshot](./screenshot.png)

> Web 界面会根据环境变量配置动态显示状态徽章（Docker/代理 锁定状态、白名单启用状态）。

## 核心特性

- **Docker Hub 镜像代理** - 完整支持 Docker Registry V2 API，可直接替换镜像前缀或配置为全局镜像源
- **访问令牌 (ACCESS_TOKEN)** - 支持 Bearer、Basic (docker login)、查询参数、路径嵌入四种认证方式
- **白名单控制 (WHITELIST)** - 通过环境变量配置允许访问的域名，未授权域名将被拒绝
- **多种代理方式** - Web 界面、查询参数、路径方式、HTTP 标准代理
- **HTTPS 支持** - 完整支持 HTTPS 网站代理
- **智能重定向** - 自动处理 301/302 等重定向
- **路径修复** - 自动修复 HTML 中的相对路径
- **CORS 支持** - 完整的跨域资源共享支持
- **响应式 UI** - 完美适配移动端和桌面端，含动态状态指示灯
- **自动引流** - Web 界面访问 15 秒后自动跳转至指定演示站
- **零成本运行** - Cloudflare Workers 免费版每天 10 万次请求

## 环境变量配置

部署后通过 Cloudflare Dashboard 或 `wrangler secret` 配置以下环境变量：

### ACCESS_TOKEN（访问令牌）

控制谁能使用代理服务。**不设置则完全开放。**

- **作用范围**：同时控制 Docker 代理和通用 HTTP 代理
- **支持多令牌**：用逗号分隔，如 `token1,token2,token3`
- **设置方式**（推荐使用 Secret，部署后不会被清空）：

```bash
# 方式一：Wrangler CLI（推荐，加密存储）
wrangler secret put ACCESS_TOKEN
# 输入令牌值，如：my-secret-token

# 方式二：Cloudflare Dashboard
# Worker → Settings → Variables and Secrets → Add → Type: Secret
```

设置后的认证方式：

| 场景 | 认证方式 | 示例 |
|------|----------|------|
| Docker 拉取镜像 | `docker login` 密码 | `docker login your-proxy.com -u any -p YOUR_TOKEN` |
| 浏览器/API | Bearer 请求头 | `Authorization: Bearer YOUR_TOKEN` |
| 浏览器/API | 查询参数 | `?token=YOUR_TOKEN` |
| Emby 等无法加头的客户端 | 路径首段嵌入 | `/YOUR_TOKEN/target.com/path` |
| Web 界面 | 令牌输入框 | 页面表单中填写 |

### WHITELIST（域名白名单）

限制代理可访问的目标域名。**不设置则允许所有域名。**

- **子域名匹配**：添加 `google.com` 会自动匹配 `api.google.com`
- **Docker 代理**：需添加 `registry-1.docker.io` 才能使用 Docker 功能

```bash
# 方式一：Wrangler CLI
wrangler secret put WHITELIST
# 输入值：github.com, raw.githubusercontent.com, registry-1.docker.io

# 方式二：wrangler.toml（明文，适合非敏感配置）
# [vars]
# WHITELIST = "github.com, registry-1.docker.io"

# 方式三：Dashboard → Variables and Secrets
```

## 安装方式

### 方式一：一键部署（推荐）

点击上方 "Deploy to Cloudflare Workers" 按钮，按照提示完成部署。

### 方式二：使用 Wrangler CLI

```bash
# 1. 安装 Wrangler
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 克隆仓库
git clone https://github.com/lemodragon/cloudflare-proxy.git
cd cloudflare-proxy

# 4. 部署
wrangler deploy

# 5. 配置环境变量（可选）
wrangler secret put ACCESS_TOKEN
wrangler secret put WHITELIST
```

### 方式三：使用 Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages**
3. 点击 **Create Application** > **Create Worker**
4. 将 `worker.js` 代码完整复制粘贴到编辑器
5. 点击 **Save and Deploy**
6. 在 **Settings → Variables and Secrets** 中配置环境变量

## 使用方式

### Docker 镜像代理

**用法一：直接替换镜像前缀**

```bash
# 登录（设置了 ACCESS_TOKEN 时必须）
docker login your-proxy.com -u any -p YOUR_TOKEN

# 拉取镜像（镜像名前加代理域名）
docker pull your-proxy.com/library/nginx:latest
docker pull your-proxy.com/jc21/nginx-proxy-manager:latest
```

**用法二：配置为全局 Docker 镜像源**

```json
// /etc/docker/daemon.json
{
  "registry-mirrors": ["https://your-proxy.com"]
}
```

```bash
# 重启 Docker 生效
sudo systemctl restart docker

# 之后正常拉取即可自动走代理
docker pull nginx:latest
```

> Docker 代理仅需白名单添加 `registry-1.docker.io`，认证流程内部自动处理。

### 通用 HTTP/HTTPS 代理

**方式 1: Web 界面**

直接访问 Worker URL，在网页界面输入目标网址。如设置了 ACCESS_TOKEN，在令牌输入框中填写。

```
https://your-proxy.com/
```

**方式 2: 查询参数**

```bash
https://your-proxy.com/?url=https://example.com

# 带令牌
https://your-proxy.com/?url=https://example.com&token=YOUR_TOKEN
```

**方式 3: 路径方式**

```bash
# 完整 URL（带协议）
https://your-proxy.com/https://example.com

# 简写（自动添加 https://）
https://your-proxy.com/example.com

# 路径嵌入令牌（适合 Emby 等客户端）
https://your-proxy.com/YOUR_TOKEN/target.com:443/path
```

**方式 4: HTTP 代理**

```bash
# Linux/macOS
export HTTP_PROXY=https://your-proxy.com
export HTTPS_PROXY=https://your-proxy.com

# Windows (PowerShell)
$env:HTTP_PROXY="https://your-proxy.com"
$env:HTTPS_PROXY="https://your-proxy.com"

# 使用代理访问
curl https://api.github.com
```

## 使用场景

### GitHub 文件加速

加速 raw.githubusercontent.com 文件下载（需将 `raw.githubusercontent.com` 加入白名单）：

```bash
https://your-proxy.com/https://raw.githubusercontent.com/user/repo/main/file.txt
```

### Docker 镜像加速

见上方 Docker 镜像代理章节。需将 `registry-1.docker.io` 加入白名单。

### OpenAI API 代理

代理 OpenAI API 请求（需将 `openai.com` 加入白名单）：

```javascript
const openai = new OpenAI({
  baseURL: "https://your-proxy.com/https://api.openai.com/v1",
  apiKey: "your-api-key",
});
```

### 前端 CORS 代理

解决前端跨域问题：

```javascript
fetch("https://your-proxy.com/https://api.example.com/data")
  .then((res) => res.json())
  .then((data) => console.log(data));
```

### Emby 媒体服务器

对于无法自定义请求头的客户端，使用路径嵌入令牌：

```
https://your-proxy.com/YOUR_TOKEN/target.com:443/emby/path
```

## 注意事项

### 环境变量持久化

- 通过 GitHub 触发 Cloudflare 自动部署时，**Dashboard 中手动添加的明文变量（Variables）可能被覆盖**
- **推荐使用 `wrangler secret put` 或 Dashboard 中的 Secret 类型**，Secret 加密存储，部署后不会被清空
- 非敏感配置（如 WHITELIST）也可写入 `wrangler.toml` 的 `[vars]` 段

### 白名单机制

- 开启白名单后，访问未授权的域名会返回 `403 Access Denied`
- 请将所有依赖的子域名也加入白名单，或直接添加主域名（如 `google.com` 自动匹配 `api.google.com`）
- Docker 代理需要 `registry-1.docker.io` 在白名单中

### 引流跳转

- Web 界面的自动跳转仅在访问根路径 `/` 时触发
- 通过 API 或路径代理访问资源不会触发跳转，不影响业务逻辑
- 跳转目标和时间等可直接编辑 `worker.js` 中的 `getRootHtml` 函数

### 其他

- Cloudflare 默认的 `*.workers.dev` 域名在某些地区可能无法访问，建议绑定自定义域名
- 不支持 WebSocket 连接

## 常见问题

### Q: 为什么提示 "Domain is not in the whitelist"?

A: 你配置了环境变量 `WHITELIST`，但当前访问的域名不在列表中。请去 Cloudflare 后台添加该域名。

### Q: docker login 提示 401 怎么办?

A: 确认你设置了 `ACCESS_TOKEN` 环境变量，并且 `docker login` 时的密码与令牌匹配。用户名可以是任意值。

```bash
docker login your-proxy.com -u any -p YOUR_ACCESS_TOKEN
```

### Q: 部署后环境变量消失了?

A: 使用 `wrangler secret put` 或 Dashboard 的 **Secret** 类型设置变量，而非明文 Variable。Secret 不会被部署覆盖。

### Q: 配置了 registry-mirrors 但 docker pull 超时?

A: **`registry-mirrors` 模式与 `ACCESS_TOKEN` 不兼容。** Docker 客户端在 registry-mirrors（全局镜像源）模式下不会发送 `docker login` 的凭据，导致代理认证失败，Docker 回退直连 Docker Hub 超时。

两种解决方式：

| 方式 | 操作 | ACCESS_TOKEN |
|------|------|-------------|
| **镜像前缀**（推荐） | 镜像名加 `your-proxy.com/` 前缀 | 生效，`docker login` 凭据会发送 |
| **registry-mirrors** | daemon.json 配置全局镜像源 | **不生效**，需关闭 Docker 令牌验证 |

如果需要令牌控制，请使用镜像前缀方式：

```yaml
# docker-compose.yml
image: your-proxy.com/jc21/nginx-proxy-manager:latest
image: your-proxy.com/library/nginx:latest
```

### Q: 15秒跳转会打断代理访问吗?

A: 不会。Web 界面的代理请求使用 `window.open` 在新标签页打开。原标签页的跳转不会影响已打开的代理页面。

## 免责声明

本项目仅供学习和研究使用，使用者需遵守以下规定：

1. **合法使用** - 仅用于访问合法内容，不得用于访问违法或侵权内容
2. **服务条款** - 使用时需遵守 Cloudflare Workers 服务条款
3. **责任自负** - 使用本代理产生的任何后果由使用者自行承担
4. **商业用途** - 如需商业使用，请确保符合相关法律法规

## 许可证

[GPL-3 License](LICENSE)

---

**如果这个项目对你有帮助，请在 [GitHub](https://github.com/lemodragon/cloudflare-proxy) 上给我们一个 Star**
