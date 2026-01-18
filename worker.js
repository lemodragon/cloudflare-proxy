/**
 * Cloudflare Worker HTTP/HTTPS Proxy
 * * 版本说明：v2.0 (Customized)
 * * 功能列表：
 * 1. 核心功能：支持 Web UI、URL参数、路径、HTTP标准协议多种代理方式。
 * 2. 白名单机制：通过环境变量 WHITELIST 控制允许访问的域名（如果不设置则允许所有）。
 * 3. 自动引流：访问 Web UI 首页 15秒后自动跳转到指定演示站。
 * 4. 点击引流：点击页面 Logo 或标题直接跳转到指定演示站。
 * 5. 智能重写：自动修复目标网页中的相对路径资源。
 * 6. UI 定制：使用了自定义的 Logo 和 Favicon。
 */

export default {
  // 注入 env 参数以获取环境变量
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检请求处理
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    // HTTP CONNECT 方法 - HTTPS 隧道代理 (目前 Worker 尚不支持 TCP 隧道，故禁用)
    if (request.method === 'CONNECT') {
      return handleConnect(request);
    }

    // 根路径 - 返回 Web UI 界面
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(getRootHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...corsHeaders()
        }
      });
    }

    // 修复 favicon.ico 被错误代理导致的 502 错误
    if (url.pathname === '/favicon.ico') {
      return Response.redirect('https://demo-cloudflare-imgbed.pages.dev/file/f8fd26c6eff4c2e26b824.png', 301);
    }

    // 代理请求处理，传入 env 以支持白名单功能
    return handleProxyRequest(request, url, env);
  }
};

/**
 * 检查 URL 是否在白名单中
 * @param {string} targetUrlStr 目标 URL 字符串
 * @param {string} whitelistEnv 环境变量字符串
 */
function isWhitelisted(targetUrlStr, whitelistEnv) {
  // 1. 如果没有设置环境变量，或内容为空，则全部放行（默认开放模式）
  if (!whitelistEnv || whitelistEnv.trim() === '') {
    return { allowed: true };
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    const targetHost = targetUrl.hostname;

    // 2. 解析白名单，按逗号分隔，去除空格和空项
    const allowedDomains = whitelistEnv.split(',')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    // 3. 再次检查，如果解析后数组为空，也全部放行
    if (allowedDomains.length === 0) {
      return { allowed: true };
    }

    // 4. 匹配逻辑：完全相等 或 属于子域名
    // 例如白名单有 "google.com"，则 "google.com" 和 "api.google.com" 都允许
    const isAllowed = allowedDomains.some(domain => {
      return targetHost === domain || targetHost.endsWith('.' + domain);
    });

    return { 
      allowed: isAllowed, 
      error: isAllowed ? null : `Domain '${targetHost}' is not in the whitelist.` 
    };

  } catch (e) {
    // URL 格式错误
    return { allowed: false, error: 'Invalid Target URL' };
  }
}

/**
 * 处理 CONNECT 方法 (HTTPS 隧道)
 */
function handleConnect(request) {
  return new Response(
    'CONNECT method not supported. Use HTTP proxy mode instead.',
    {
      status: 501,
      statusText: 'Not Implemented',
      headers: {
        'Content-Type': 'text/plain',
        ...corsHeaders()
      }
    }
  );
}

/**
 * 处理代理请求的核心逻辑
 */
async function handleProxyRequest(request, url, env) {
  try {
    // 方式 1: 查询参数 ?url=https://example.com
    let targetUrl = url.searchParams.get('url');

    // 方式 2: 路径方式 /https://example.com 或 /example.com
    if (!targetUrl && url.pathname !== '/') {
      let path = decodeURIComponent(url.pathname.substring(1));

      // 如果路径已经包含协议
      if (path.startsWith('http://') || path.startsWith('https://')) {
        targetUrl = path;
      } else {
        // 自动添加协议
        targetUrl = url.protocol + '//' + path;
      }

      // 保留查询参数
      if (url.search) {
        targetUrl += url.search;
      }
    }

    // 方式 3: 标准 HTTP 代理 - 完整 URL 作为请求目标
    if (!targetUrl && (request.url.startsWith('http://') || request.url.startsWith('https://'))) {
      const host = request.headers.get('Host');
      if (host && !url.hostname.includes(host)) {
        targetUrl = request.url;
      }
    }

    // 如果未找到目标 URL，返回 JSON 错误提示
    if (!targetUrl) {
      return new Response(
        JSON.stringify({
          error: 'No target URL provided',
          usage: {
            web: 'Visit / for Web UI',
            method1: '?url=https://example.com',
            method2: '/https://example.com or /example.com',
            method3: 'Set as HTTP_PROXY in environment'
          }
        }, null, 2),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders()
          }
        }
      );
    }

    // --- 白名单检查逻辑 ---
    // 从 env 中读取 WHITELIST 变量
    const whitelistCheck = isWhitelisted(targetUrl, env.WHITELIST);
    if (!whitelistCheck.allowed) {
        return new Response(
            JSON.stringify({
                error: 'Access Denied',
                message: whitelistCheck.error,
                info: 'The administrator has restricted access to specific domains.'
            }, null, 2),
            {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders()
                }
            }
        );
    }
    // ---------------------

    // 验证目标 URL 格式
    let target;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: 'Invalid target URL',
          provided: targetUrl,
          message: e.message
        }, null, 2),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders()
          }
        }
      );
    }

    // 构建代理请求头
    const proxyHeaders = cleanHeaders(request.headers);

    const proxyRequest = new Request(target, {
      method: request.method,
      headers: proxyHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      redirect: 'manual' // 手动处理重定向
    });

    // 发起请求到目标服务器
    const response = await fetch(proxyRequest);
    let body = response.body;

    // 处理 3xx 重定向
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (location) {
        // 重写 Location 头，使其指向代理地址
        const modifiedLocation = `/${encodeURIComponent(new URL(location, target).toString())}`;
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: {
            ...Object.fromEntries(response.headers),
            'Location': modifiedLocation,
            ...corsHeaders(),
            ...noCacheHeaders()
          }
        });
      }
    }

    // 处理 HTML 内容中的相对路径 (防止资源 404)
    if (response.headers.get('Content-Type')?.includes('text/html')) {
      body = await handleHtmlContent(response, url.protocol, url.host, target);
    }

    // 返回最终响应
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        ...corsHeaders(),
        ...noCacheHeaders()
      }
    });

  } catch (error) {
    // 捕获异常并返回 502 Bad Gateway
    return new Response(
      JSON.stringify({
        error: 'Proxy request failed',
        message: error.message,
        stack: error.stack
      }, null, 2),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders()
        }
      }
    );
  }
}

/**
 * 处理 HTML 内容中的相对路径
 * 将 href="/style.css" 替换为 绝对路径代理地址
 */
async function handleHtmlContent(response, protocol, host, targetUrl) {
  const originalText = await response.text();
  const origin = targetUrl.origin;

  // 替换相对路径：href="/" src="/" action="/"
  const regex = /((href|src|action)=["'])\/((?!\/))/g;
  const modifiedText = originalText.replace(regex, `$1${protocol}//${host}/${origin}/$3`);

  return modifiedText;
}

/**
 * 清理请求头 - 移除不应转发的 Cloudflare 特定头
 */
function cleanHeaders(headers) {
  const cleaned = new Headers(headers);

  // 移除 Cloudflare 和代理相关头，增加隐蔽性
  const removeHeaders = [
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'cf-worker',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-real-ip'
  ];

  removeHeaders.forEach(header => cleaned.delete(header));

  return cleaned;
}

/**
 * 构造 CORS 头，允许跨域访问
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * 构造禁用缓存的头
 */
function noCacheHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
}

/**
 * 返回 Web UI 的 HTML 字符串
 * 包含了修改后的 Logo、Favicon、点击跳转和 10s 自动跳转逻辑
 */
function getRootHtml() {
  // 定义常量：Logo 地址和跳转目标地址
  const LOGO_URL = 'https://demo-cloudflare-imgbed.pages.dev/file/f8fd26c6eff4c2e26b824.png';
  const JUMP_URL = 'https://demo.lvdpub.com';

  return `<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare Proxy - 全功能代理服务</title>
  <meta name="description" content="基于 Cloudflare Workers 的全功能 HTTP/HTTPS 代理服务">
  
  <link rel="icon" href="${LOGO_URL}">

  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    // Tailwind 自定义配置
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            zinc: {
              50: '#fafafa',
              100: '#f4f4f5',
              200: '#e4e4e7',
              300: '#d4d4d8',
              400: '#a1a1aa',
              500: '#71717a',
              600: '#52525b',
              700: '#3f3f46',
              800: '#27272a',
              900: '#18181b',
            },
            teal: {
              400: '#2dd4bf',
              500: '#14b8a6',
              600: '#0d9488',
            }
          }
        }
      }
    }
  </script>

  <style>
    /* 基础样式变量 */
    :root {
      --bg-primary: theme('colors.zinc.50');
      --bg-secondary: theme('colors.white');
      --text-primary: theme('colors.zinc.800');
      --text-secondary: theme('colors.zinc.600');
      --border-color: theme('colors.zinc.100');
      --accent-color: theme('colors.teal.500');
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-primary: theme('colors.black');
        --bg-secondary: theme('colors.zinc.900');
        --text-primary: theme('colors.zinc.100');
        --text-secondary: theme('colors.zinc.400');
        --border-color: rgba(63, 63, 70, 0.4);
        --accent-color: theme('colors.teal.400');
      }
    }

    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
    }
  </style>
</head>
<body class="flex h-full flex-col">
  <div class="flex w-full flex-col">
    <div class="relative flex w-full flex-col bg-white ring-1 ring-zinc-100 dark:bg-zinc-900 dark:ring-zinc-300/20">
      <main class="flex-auto">
        <div class="sm:px-8 mt-16 sm:mt-32">
          <div class="mx-auto w-full max-w-7xl lg:px-8">
            <div class="relative px-4 sm:px-8 lg:px-12">
              <div class="mx-auto max-w-2xl lg:max-w-5xl">

                <div class="max-w-2xl">
                  <a href="${JUMP_URL}" class="group block cursor-pointer transition-opacity hover:opacity-80" title="点击跳转到演示站">
                    <img 
                      src="${LOGO_URL}" 
                      alt="Proxy Logo" 
                      class="h-20 w-auto mb-6 rounded-lg shadow-sm"
                    >
                    <h1 class="text-4xl font-bold tracking-tight text-zinc-800 sm:text-5xl dark:text-zinc-100 group-hover:text-teal-500 transition-colors">
                      Cloudflare Proxy
                    </h1>
                  </a>
                  <p class="mt-6 text-base text-zinc-600 dark:text-zinc-400">
                    基于 Cloudflare Workers 的全功能 HTTP/HTTPS 代理服务，支持多种访问方式，完全免费且易于使用。
                  </p>
                </div>

                <div class="mt-16 rounded-2xl border border-zinc-100 p-6 dark:border-zinc-700/40">
                  <form id="urlForm" class="space-y-4">
                    <div>
                      <label for="targetUrl" class="block text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                        输入目标网址
                      </label>
                      <input
                        type="text"
                        id="targetUrl"
                        placeholder="example.com 或 https://example.com"
                        required
                        class="w-full rounded-md bg-white px-4 py-2 text-sm text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-teal-500 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700 dark:placeholder:text-zinc-500"
                      >
                    </div>
                    <button
                      type="submit"
                      class="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-teal-500 dark:hover:bg-teal-400"
                    >
                      开始代理
                    </button>
                  </form>
                </div>

                <div class="mt-16 rounded-2xl border border-zinc-100 p-6 dark:border-zinc-700/40">
                  <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                    使用方式
                  </h2>
                  <div class="space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">方式 1: Web 界面</div>
                      <p>在上方输入框输入目标网址即可</p>
                    </div>
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">方式 2: 查询参数</div>
                      <code class="text-xs text-teal-600 dark:text-teal-400 break-all" id="method2"></code>
                    </div>
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">方式 3: 路径方式</div>
                      <code class="text-xs text-teal-600 dark:text-teal-400 break-all" id="method3"></code>
                    </div>
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">方式 4: HTTP 代理</div>
                      <code class="text-xs text-teal-600 dark:text-teal-400 break-all" id="method4"></code>
                    </div>
                  </div>
                </div>

                <div class="mt-16 rounded-2xl border border-zinc-100 p-6 dark:border-zinc-700/40">
                  <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                    使用场景
                  </h2>
                  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">📦 GitHub 文件加速</div>
                      <p class="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                        加速 raw.githubusercontent.com 文件下载
                      </p>
                      <code class="text-xs text-teal-600 dark:text-teal-400 break-all" id="scene1"></code>
                    </div>
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">🐳 Docker 镜像加速</div>
                      <p class="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                        配置 Docker 镜像代理源
                      </p>
                      <code class="text-xs text-teal-600 dark:text-teal-400 break-all" id="scene2"></code>
                    </div>
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">🤖 OpenAI API 代理</div>
                      <p class="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                        代理 OpenAI API 请求
                      </p>
                      <code class="text-xs text-teal-600 dark:text-teal-400 break-all" id="scene3"></code>
                    </div>
                    <div class="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                      <div class="font-medium text-zinc-900 dark:text-zinc-100 mb-2">🌍 通用 CORS 代理</div>
                      <p class="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                        解决前端跨域问题
                      </p>
                      <code class="text-xs text-teal-600 dark:text-teal-400 break-all" id="scene4"></code>
                    </div>
                  </div>
                </div>

                <div class="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div class="flex items-center text-sm text-zinc-600 dark:text-zinc-400">
                    <svg class="w-5 h-5 mr-2 text-teal-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                    HTTPS 支持
                  </div>
                  <div class="flex items-center text-sm text-zinc-600 dark:text-zinc-400">
                    <svg class="w-5 h-5 mr-2 text-teal-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                    CORS 跨域
                  </div>
                  <div class="flex items-center text-sm text-zinc-600 dark:text-zinc-400">
                    <svg class="w-5 h-5 mr-2 text-teal-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                    智能重定向
                  </div>
                  <div class="flex items-center text-sm text-zinc-600 dark:text-zinc-400">
                    <svg class="w-5 h-5 mr-2 text-teal-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                    路径修复
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </main>

      <footer class="mt-32">
        <div class="sm:px-8">
          <div class="mx-auto w-full max-w-7xl lg:px-8">
            <div class="border-t border-zinc-100 pt-10 pb-16 dark:border-zinc-700/40">
              <div class="relative px-4 sm:px-8 lg:px-12">
                <div class="mx-auto max-w-2xl lg:max-w-5xl">
                  <div class="flex flex-col items-center justify-between gap-6 sm:flex-row">
                    <p class="text-sm text-zinc-400 dark:text-zinc-500">
                      Powered by Cloudflare Workers
                    </p>
                    <a
                      href="https://github.com/lemodragon/cloudflare-proxy"
                      target="_blank"
                      class="group flex items-center text-sm font-medium text-zinc-800 transition hover:text-teal-500 dark:text-zinc-200 dark:hover:text-teal-400"
                    >
                      <svg class="w-5 h-5 mr-2 fill-zinc-500 transition group-hover:fill-teal-500 dark:fill-zinc-400 dark:group-hover:fill-teal-400" viewBox="0 0 24 24">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.475 2 2 6.588 2 12.253c0 4.537 2.862 8.369 6.838 9.727.5.09.687-.218.687-.487 0-.243-.013-1.05-.013-1.91C7 20.059 6.35 18.957 6.15 18.38c-.113-.295-.6-1.205-1.025-1.448-.35-.192-.85-.667-.013-.68.788-.012 1.35.744 1.538 1.051.9 1.551 2.338 1.116 2.912.846.088-.666.35-1.115.638-1.371-2.225-.256-4.55-1.14-4.55-5.062 0-1.115.387-2.038 1.025-2.756-.1-.256-.45-1.307.1-2.717 0 0 .837-.269 2.75 1.051.8-.23 1.65-.346 2.5-.346.85 0 1.7.115 2.5.346 1.912-1.333 2.75-1.05 2.75-1.05.55 1.409.2 2.46.1 2.716.637.718 1.025 1.628 1.025 2.756 0 3.934-2.337 4.806-4.562 5.062.362.32.675.936.675 1.897 0 1.371-.013 2.473-.013 2.82 0 .268.188.589.688.486a10.039 10.039 0 0 0 4.932-3.74A10.447 10.447 0 0 0 22 12.253C22 6.588 17.525 2 12 2Z"/>
                      </svg>
                      在 GitHub 上给我们点赞
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  </div>

  <script>
    // === 修改: 15秒自动跳转引流逻辑 ===
    window.addEventListener('load', function() {
        // 定义跳转目标
        const targetUrl = '${JUMP_URL}';
        const delay = 15000; // 15秒

        console.log('将在 ' + delay/1000 + ' 秒后跳转至: ' + targetUrl);

        setTimeout(function() {
            // 执行跳转
            window.location.href = targetUrl;
        }, delay);
    });
    // =================================

    // 获取当前域名并填充示例
    const currentOrigin = window.location.origin;

    // 填充使用方式示例
    document.getElementById('method2').textContent = currentOrigin + '/?url=https://example.com';
    document.getElementById('method3').textContent = currentOrigin + '/https://example.com';
    document.getElementById('method4').textContent = 'export HTTP_PROXY=' + currentOrigin;

    // 填充使用场景示例
    document.getElementById('scene1').textContent = currentOrigin + '/https://raw.githubusercontent.com/user/repo/main/file.txt';
    document.getElementById('scene2').textContent = currentOrigin + '/https://registry-1.docker.io';
    document.getElementById('scene3').textContent = currentOrigin + '/https://api.openai.com/v1/chat/completions';
    document.getElementById('scene4').textContent = 'fetch("' + currentOrigin + '/https://api.example.com/data")';

    // 表单提交处理
    document.getElementById('urlForm').addEventListener('submit', function(event) {
      event.preventDefault();

      let targetUrl = document.getElementById('targetUrl').value.trim();

      // 如果没有协议，自动添加 https://
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
      }

      // 构建代理 URL
      const proxyUrl = currentOrigin + '/' + encodeURIComponent(targetUrl);

      // 在新标签页打开 (不会中断当前页面的跳转倒计时)
      window.open(proxyUrl, '_blank');
    });
  </script>
</body>
</html>`;
}