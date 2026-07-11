import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const TARGET_BASE = "https://ai.t8star.org";
const ANTHROPIC_BASE = "https://dashscope.aliyuncs.com/apps/anthropic";

const __dirname = (typeof (globalThis as any).__dirname !== 'undefined')
  ? (globalThis as any).__dirname
  : path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3001;

  // Manual proxy for API requests — bypasses http-proxy-middleware multipart issues
  app.all("/api/t8star/*", async (req, res) => {
    const targetPath = req.originalUrl.replace("/api/t8star", "");
    const targetUrl = `${TARGET_BASE}${targetPath}`;

    // Build headers to forward
    // Note: do NOT forward content-length; Node fetch (Undici) computes it automatically
    // and rejects manually-set content-length with UND_ERR_INVALID_ARG.
    const forwardHeaders: Record<string, string> = {};
    const allowList = [
      "authorization",
      "content-type",
      "accept",
      "accept-encoding",
      "accept-language",
    ];
    for (const key of allowList) {
      const val = req.headers[key];
      if (val) {
        forwardHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
      }
    }
    // Host is automatically set by fetch() from the URL hostname

    try {
      // Collect raw body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      console.log(`[Proxy] ${req.method} ${targetUrl}`);
      console.log(`[Proxy] Headers:`, JSON.stringify(forwardHeaders));
      if (body) {
        console.log(`[Proxy] Body size: ${body.length} bytes`);
        if (forwardHeaders['content-type']?.includes('application/json')) {
          console.log(`[Proxy] Body:`, body.toString('utf-8'));
        }
      }

      const fetchRes = await fetch(targetUrl, {
        method: req.method || "GET",
        headers: forwardHeaders,
        body: body as any,
      });

      console.log(`[Proxy] Response status: ${fetchRes.status}`);

      // Forward status and headers back
      res.status(fetchRes.status);
      fetchRes.headers.forEach((value, key) => {
        // Skip hop-by-hop headers
        if (["transfer-encoding", "connection", "keep-alive"].includes(key)) return;
        res.setHeader(key, value);
      });

      const resBody = await fetchRes.text();
      console.log(`[Proxy] Response body:`, resBody.length > 500 ? resBody.substring(0, 500) + '...' : resBody);
      res.send(resBody);
    } catch (err: any) {
      console.error("[Proxy Error]", err.message);
      res.status(502).json({ error: "Proxy error", message: err.message });
    }
  });

  // Proxy for Anthropic-compatible Qwen API (avoids browser CORS)
  app.all("/api/agent/*", async (req, res) => {
    const targetPath = req.originalUrl.replace("/api/agent", "");
    const targetUrl = `${ANTHROPIC_BASE}${targetPath}`;

    const forwardHeaders: Record<string, string> = {};
    const allowList = [
      "x-api-key",
      "anthropic-version",
      "content-type",
      "accept",
      "accept-language",
    ];
    for (const key of allowList) {
      const val = req.headers[key];
      if (val) {
        forwardHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
      }
    }
    // 不转发 accept-encoding，强制明文返回，避免 Node fetch 解压问题
    forwardHeaders["accept-encoding"] = "identity";

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      console.log(`[Agent Proxy] ${req.method} ${targetUrl}`);
      console.log(`[Agent Proxy] Headers:`, JSON.stringify(forwardHeaders));
      if (body && forwardHeaders['content-type']?.includes('application/json')) {
        console.log(`[Agent Proxy] Body:`, body.toString('utf-8'));
      }

      // 超时控制：60 秒
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);

      let fetchRes;
      try {
        fetchRes = await fetch(targetUrl, {
          method: req.method || "GET",
          headers: forwardHeaders,
          body: body as any,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      console.log(`[Agent Proxy] Response status: ${fetchRes.status}`);

      res.status(fetchRes.status);
      fetchRes.headers.forEach((value, key) => {
        if (["transfer-encoding", "connection", "keep-alive", "content-encoding", "content-length"].includes(key)) return;
        res.setHeader(key, value);
      });

      // 检查是否是 SSE 流式响应
      const contentType = fetchRes.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        // SSE 流式响应：直接 pipe，不缓冲
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        const reader = fetchRes.body.getReader();
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { res.end(); break; }
              res.write(value);
            }
          } catch (err: any) {
            console.error("[Agent Proxy Stream Error]", err.message);
            if (!res.headersSent) res.status(502).json({ error: "Stream error" });
            else res.end();
          }
        };
        pump();
      } else {
        // 非流式响应：缓冲后发送（兼容旧接口）
        const resBody = await fetchRes.text();
        console.log(`[Agent Proxy] Response body:`, resBody.length > 500 ? resBody.substring(0, 500) + '...' : resBody);
        res.send(resBody);
      }
    } catch (err: any) {
      console.error("[Agent Proxy Error]", err.name, err.message);
      res.status(502).json({ error: "Proxy error", message: `${err.name}: ${err.message}` });
    }
  });

  // 博查搜索代理
  app.all("/api/bocha/search", async (req, res) => {
    const bochaKey = req.headers["x-bocha-key"] as string;
    if (!bochaKey) {
      res.status(400).json({ error: "Missing x-bocha-key header" });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      console.log(`[Bocha Search] query: ${body ? JSON.parse(body.toString()).query : 'N/A'}`);

      const fetchRes = await fetch("https://api.bochaai.com/v1/web-search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${bochaKey}`,
          "Content-Type": "application/json",
        },
        body: body as any,
      });

      const resBody = await fetchRes.text();
      console.log(`[Bocha Search] Response status: ${fetchRes.status}`);
      res.status(fetchRes.status).send(resBody);
    } catch (err: any) {
      console.error("[Bocha Search Error]", err.message);
      res.status(502).json({ error: "Bocha search proxy error", message: err.message });
    }
  });

  // 博查 AI Search 代理（支持返回图片）
  app.all("/api/bocha/ai-search", async (req, res) => {
    const bochaKey = req.headers["x-bocha-key"] as string;
    if (!bochaKey) {
      res.status(400).json({ error: "Missing x-bocha-key header" });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      console.log(`[Bocha AI Search] query: ${body ? JSON.parse(body.toString()).query : 'N/A'}`);

      const fetchRes = await fetch("https://api.bocha.cn/v1/ai-search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${bochaKey}`,
          "Content-Type": "application/json",
        },
        body: body as any,
      });

      const resBody = await fetchRes.text();
      console.log(`[Bocha AI Search] Response status: ${fetchRes.status}`);
      res.status(fetchRes.status).send(resBody);
    } catch (err: any) {
      console.error("[Bocha AI Search Error]", err.message);
      res.status(502).json({ error: "Bocha AI search proxy error", message: err.message });
    }
  });

  // 图片代理：服务端下载外部图片，绕过浏览器 CORS 限制
  app.get("/api/proxy-image", async (req, res) => {
    const imageUrl = req.query.url as string;
    if (!imageUrl) {
      res.status(400).json({ error: "Missing url query parameter" });
      return;
    }
    try {
      // 模拟浏览器请求头，绕过防盗链
      const headers: Record<string, string> = {
        'User-Agent': (req.query.ua as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      };
      const referer = req.query.referer as string;
      if (referer) headers['Referer'] = referer;

      const fetchRes = await fetch(imageUrl, { headers });
      if (!fetchRes.ok) {
        res.status(fetchRes.status).json({ error: `Image fetch failed: ${fetchRes.status}` });
        return;
      }
      const contentType = fetchRes.headers.get('content-type') || '';
      // 验证返回的是否是图片：拒绝非 image/* 的响应（如 CDN 拦截页、空 body）
      if (!contentType.startsWith('image/')) {
        res.status(415).json({ error: 'Not an image', contentType });
        return;
      }
      const contentLength = fetchRes.headers.get('content-length');
      if (contentLength && parseInt(contentLength) < 256) {
        res.status(416).json({ error: 'Image too small', contentLength });
        return;
      }
      const buffer = Buffer.from(await fetchRes.arrayBuffer());
      res.setHeader('content-type', contentType);
      res.setHeader('cache-control', 'public, max-age=86400');
      res.send(buffer);
    } catch (err: any) {
      console.error("[Image Proxy Error]", err.message);
      res.status(502).json({ error: "Image proxy error", message: err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
      },
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
