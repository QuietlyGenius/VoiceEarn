// This is dev-tooling config: the API mock middleware below shims Vercel's
// serverless (req, res) objects, whose shapes don't map cleanly to Vite's
// Connect types, so a few `any`s are intentional and localized here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins: any[] = [react(), tailwindcss()];
  try {
    // @ts-expect-error optional local plugin, not always present
    const m = await import('./.vite-source-tags.js');
    plugins.push(m.sourceTags());
  } catch {
    // .vite-source-tags.js is an optional local-only plugin; ignore if absent.
  }

  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);
  const processEnvDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
  }

  // Serves files written by the mock storage (api/db-client.js) under
  // public/mock-uploads. Vite's static server doesn't pick up this directory
  // because it's created after startup, so we stream it ourselves. Dev-only —
  // production audio/book URLs come straight from Supabase Storage.
  const MOCK_MIME: Record<string, string> = {
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip'
  };

  // Local Vercel Serverless API mock middleware for seamless local testing
  const apiMockPlugin = (): Plugin => ({
    name: 'vercel-api-mock',
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith('/mock-uploads/')) {
          const rel = decodeURIComponent(req.url.split('?')[0]);
          const filePath = path.resolve(process.cwd(), 'public', `.${rel}`);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            res.setHeader('Content-Type', MOCK_MIME[ext] || 'application/octet-stream');
            res.setHeader('Accept-Ranges', 'bytes');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        if (req.url && req.url.startsWith('/api/')) {
          // Parse request URL and queries
          const url = new URL(req.url, `http://${req.headers.host}`);
          const pathname = url.pathname;
          const apiName = pathname.replace(/^\/api\//, '').split('?')[0];
          const query = Object.fromEntries(url.searchParams.entries());

          const filePath = path.resolve(process.cwd(), 'api', `${apiName}.js`);

          if (fs.existsSync(filePath)) {
            try {
              // Read JSON request body if applicable
              let body: any = {};
              if (['POST', 'PUT', 'DELETE'].includes(req.method || '')) {
                const buffers: any[] = [];
                for await (const chunk of req) {
                  buffers.push(chunk);
                }
                const rawBody = Buffer.concat(buffers).toString();
                if (rawBody) {
                  try {
                    body = JSON.parse(rawBody);
                  } catch {
                    body = rawBody;
                  }
                }
              }

              // Load and execute Vercel handler
              const module = await server.ssrLoadModule(filePath);
              const handler = module.default;

              // Mock Vercel req/res objects
              const mockReq = Object.assign(req, {
                query,
                body,
              });

              const mockRes = {
                statusCode: 200,
                headers: {} as Record<string, any>,
                setHeader(name: string, value: any) {
                  this.headers[name] = value;
                  res.setHeader(name, value);
                  return this;
                },
                status(code: number) {
                  this.statusCode = code;
                  res.statusCode = code;
                  return this;
                },
                json(data: any) {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(data));
                  return this;
                },
                end(data: any) {
                  res.end(data);
                  return this;
                }
              };

              await handler(mockReq, mockRes);
              return;
            } catch (err: any) {
              console.error(`[Vite API Server] Error executing ${apiName}.js:`, err);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
              return;
            }
          }
        }
        next();
      });
    }
  });

  plugins.push(apiMockPlugin());

  return {
    plugins,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: processEnvDefines,
    server: {
      watch: {
        // The local mock DB (api/db-client.js) rewrites this file on every
        // API call. Without ignoring it, Vite's watcher treats each write as
        // an untracked module change and force-reloads the whole page —
        // which, mid-recording, kills the active MediaRecorder.
        ignored: ['**/local-db.json', '**/public/mock-uploads/**'],
      },
    },
  };
})
