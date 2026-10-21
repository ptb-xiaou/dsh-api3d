/**
 * 端到端：围栏 + 直连传输真的把请求送到一台 TCP 服务器上。
 *
 * 前面几个套件各测一半 —— `fence.test.mjs` 只验「原生 fetch 收到了什么」，
 * `direct-transport.test.mjs` 直接调传输本身 —— 所以「两半接在一起还对」是这里
 * 唯一能证明的事。真发一次 socket 也是唯一能证明 `rewriteToTarget` 改出来的 URL
 * 是 Node 真能拨出去的 URL 的地方。
 *
 * 顺带覆盖 402 额度注解的边界：它必须只作用于本路由的请求。
 *
 * @module dsh-api3d/test/integration
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { SENTINEL } from '../lib/site.js'
import { withFence, withFenceResponses } from './harness.mjs'

/**
 * 起一个 loopback HTTP 替身。
 *
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, body: string) => void} handler - 请求处理函数。
 * @returns {Promise<{origin: string, close: () => Promise<void>}>} 服务信息。
 */
async function serve(handler) {
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => handler(req, res, body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        // keepAlive 的 socket 会让 close() 挂住，直连传输正是用 keepAlive agent。
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

test('哨兵请求经围栏与直连传输，真的落到中转站', async () => {
  const seen = []
  const service = await serve((req, res, body) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"id":"chatcmpl-1","choices":[]}')
  })
  try {
    await withFence({ baseURL: `${service.origin}/v1`, directMode: 'always' }, async ({ calls }) => {
      const response = await globalThis.fetch(`https://${SENTINEL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-v4', messages: [{ role: 'user', content: 'hi' }] }),
      })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), '{"id":"chatcmpl-1","choices":[]}')
      // 走了直连传输，就绝不该同时打给原生 fetch。
      assert.equal(calls.length, 0, '直连传输生效时原生 fetch 不该被调用')
    })

    assert.equal(seen.length, 1)
    assert.equal(seen[0].method, 'POST')
    assert.equal(seen[0].url, '/v1/chat/completions')
    assert.equal(seen[0].headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(seen[0].body), { model: 'deepseek-v4', messages: [{ role: 'user', content: 'hi' }] })
  } finally {
    await service.close()
  }
})

test('基础地址带着自己的路径前缀时，哨兵路径被整体替换', async () => {
  const seen = []
  const service = await serve((req, res) => {
    seen.push(req.url)
    res.writeHead(200)
    res.end('ok')
  })
  try {
    await withFence({ baseURL: `${service.origin}/api/v1`, directMode: 'always' }, async () => {
      await globalThis.fetch(`https://${SENTINEL}/v1/models`)
    })
    assert.deepEqual(seen, ['/api/v1/models'])
  } finally {
    await service.close()
  }
})

test('非本路由主机的 402 不被加上中转站的额度提示', async () => {
  await withFenceResponses({ quotaHint: '余额不足' }, () => new Response('{"error":{"message":"nope"}}', { status: 402, headers: { 'content-type': 'application/json' } }), async () => {
    const response = await globalThis.fetch('https://other.example/v1/chat/completions')
    assert.equal(response.status, 402)
    assert.equal(JSON.parse(await response.text()).error.message, 'nope', '别人的 402 不该出现中转站的文案')
  })
})

test('本路由的 402 + event-stream 里的 JSON 错误体被重建为 application/json 并追加提示', async () => {
  const body = JSON.stringify({ error: { message: 'budget pool exhausted', type: 'insufficient_quota' } })
  await withFenceResponses(
    { baseURL: 'http://127.0.0.1:1/v1', quotaHint: '到站点控制台充值后重试。' },
    () => new Response(body, { status: 402, headers: { 'content-type': 'text/event-stream' } }),
    async () => {
      const response = await globalThis.fetch(`https://${SENTINEL}/v1/chat/completions`)
      assert.equal(response.status, 402)
      assert.equal(response.headers.get('content-type'), 'application/json')
      const parsed = JSON.parse(await response.text())
      assert.equal(parsed.error.message, 'budget pool exhausted\n到站点控制台充值后重试。')
      assert.equal(parsed.error.type, 'insufficient_quota', '原始字段必须保留')
    },
  )
})

test('本路由的 402 但错误体不是 JSON 时原样还回字节', async () => {
  await withFenceResponses(
    { baseURL: 'http://127.0.0.1:1/v1', quotaHint: '到站点控制台充值后重试。' },
    () => new Response('gateway timeout', { status: 402, headers: { 'content-type': 'text/plain' } }),
    async () => {
      const response = await globalThis.fetch(`https://${SENTINEL}/v1/chat/completions`)
      assert.equal(response.status, 402)
      assert.equal(response.headers.get('content-type'), 'text/plain')
      assert.equal(await response.text(), 'gateway timeout')
    },
  )
})

test('本路由的非 402 响应完全不被动过', async () => {
  await withFenceResponses(
    { baseURL: 'http://127.0.0.1:1/v1', quotaHint: '到站点控制台充值后重试。' },
    () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => {
      const response = await globalThis.fetch(`https://${SENTINEL}/v1/chat/completions`)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), '{"ok":true}')
    },
  )
})

test('提示留空时 402 原样穿过', async () => {
  const body = JSON.stringify({ error: { message: 'budget pool exhausted' } })
  await withFenceResponses(
    { baseURL: 'http://127.0.0.1:1/v1', quotaHint: '' },
    () => new Response(body, { status: 402, headers: { 'content-type': 'text/event-stream' } }),
    async () => {
      const response = await globalThis.fetch(`https://${SENTINEL}/v1/chat/completions`)
      assert.equal(response.status, 402)
      assert.equal(response.headers.get('content-type'), 'text/event-stream')
      assert.equal(await response.text(), body)
    },
  )
})
