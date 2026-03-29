import http from 'node:http';
import https from 'node:https';
import { fileURLToPath, URL } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

const PORT = 9876;
const TARGET = 'https://api.anthropic.com';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = join(__dirname, 'logs');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

let reqIndex = 0;

const server = http.createServer((req, res) => {
  const targetUrl = new URL(req.url || '/', TARGET);
  const chunks = [];

  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const id = ++reqIndex;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = `${LOG_DIR}\\req-${id}-${ts}.json`;

    let parsedBody = null;
    try { parsedBody = JSON.parse(body.toString()); } catch {}

    const record = {
      id,
      timestamp: new Date().toISOString(),
      request: {
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion,
        headers: { ...req.headers },
        body: parsedBody ?? body.toString(),
      },
    };

    // Pretty print to console
    console.log('\n' + '='.repeat(100));
    console.log(`REQUEST #${id} @ ${record.timestamp}`);
    console.log('='.repeat(100));
    console.log(`${record.request.method} ${record.request.url} HTTP/${record.request.httpVersion}`);
    console.log('\n--- REQUEST HEADERS ---\n');
    for (const [k, v] of Object.entries(record.request.headers)) {
      console.log(`  ${k}: ${v}`);
    }

    if (parsedBody) {
      console.log('\n--- REQUEST BODY (all fields) ---\n');
      for (const [key, val] of Object.entries(parsedBody)) {
        if (key === 'messages') {
          console.log(`  ${key}: [${val.length} messages]`);
          val.forEach((m, i) => {
            const preview = typeof m.content === 'string'
              ? m.content.slice(0, 200)
              : JSON.stringify(m.content).slice(0, 200);
            console.log(`    [${i}] role=${m.role} content=${preview}...`);
          });
        } else if (key === 'system' && typeof val === 'string') {
          console.log(`  ${key}: (${val.length} chars)`);
          console.log(val);
        } else if (key === 'system' && Array.isArray(val)) {
          console.log(`  ${key}: [${val.length} blocks]`);
          val.forEach((b, i) => console.log(`    [${i}] type=${b.type} ${b.type === 'text' ? `text=(${b.text?.length} chars)` : JSON.stringify(b).slice(0, 200)}`));
        } else if (key === 'tools') {
          console.log(`  ${key}: [${val.length} tools]`);
          val.forEach(t => console.log(`    - ${t.name}: ${t.description?.slice(0, 100)}`));
        } else if (key === 'tool_choice') {
          console.log(`  ${key}:`, JSON.stringify(val));
        } else {
          console.log(`  ${key}:`, JSON.stringify(val));
        }
      }
    } else {
      console.log('\n--- REQUEST BODY (raw) ---\n');
      console.log(body.toString());
    }

    // Also dump raw request to file
    fs.writeFileSync(logFile, JSON.stringify(record, null, 2));
    console.log(`\n💾 Saved full raw request to: ${logFile}`);
    console.log('='.repeat(100) + '\n');

    // Forward to Anthropic
    const proxyReq = https.request(targetUrl, {
      method: req.method,
      headers: { ...req.headers, host: 'api.anthropic.com' },
    }, proxyRes => {
      const resChunks = [];

      proxyRes.on('data', chunk => resChunks.push(chunk));
      proxyRes.on('end', () => {
        const resBody = Buffer.concat(resChunks);
        const isStreaming = proxyRes.headers['content-type']?.includes('text/event-stream');
        const resLog = {
          id,
          timestamp: new Date().toISOString(),
          request: record.request,
          response: {
            statusCode: proxyRes.statusCode,
            headers: { ...proxyRes.headers },
            body: isStreaming ? resBody.toString() : (() => { const s = resBody.toString(); if (!s) return null; try { return JSON.parse(s); } catch { return s; } })(),
          },
        };

        // Update the log file with response
        fs.writeFileSync(logFile, JSON.stringify(resLog, null, 2));

        console.log(`\n📥 RESPONSE #${id} @ ${resLog.timestamp}`);
        console.log(`   Status: ${proxyRes.statusCode}`);
        for (const [k, v] of Object.entries(resLog.response.headers)) {
          console.log(`   ${k}: ${v}`);
        }
        if (isStreaming) {
          console.log(`   Body: streaming SSE (${resBody.length} bytes)`);
          // Parse and summarize SSE events
          const events = resBody.toString().split('\n').filter(l => l.startsWith('data:'));
          const eventTypes = {};
          events.forEach(e => {
            try {
              const d = JSON.parse(e.slice(5).trim());
              eventTypes[d.type] = (eventTypes[d.type] || 0) + 1;
            } catch {}
          });
          console.log('   SSE events:', eventTypes);
        } else {
          console.log(`   Body: ${resBody.toString().slice(0, 500)}`);
        }
        console.log(`💾 Log updated with response: ${logFile}\n`);
      });

      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      console.error('Proxy error:', err.message);
      res.writeHead(502);
      res.end('Bad Gateway');
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`\n🔍 Prompt Capture Proxy running at http://localhost:${PORT}`);
  console.log(`📡 Forwarding to ${TARGET}`);
  console.log(`💾 Logs dir: ${LOG_DIR}\n`);
  console.log('Now run Claude Code in another terminal with:');
  console.log(`\n  set ANTHROPIC_BASE_URL=http://localhost:${PORT}\n  claude\n`);
  console.log('Waiting for requests...\n');
});
