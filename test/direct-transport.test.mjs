/**
 * 直连传输：进程装了代理时，中转到站的请求自己走 `node:http`/`node:https`，
 * 逃开宿主的代理 dispatcher。
 *
 * 这些测试打的是一个真实的 loopback HTTP 替身，因为要验的正是「线上字节长什么样」
 * —— header 保真、不跟随重定向、abort 能切断连接。
 *
 * @module dsh-api3d/test/direct-transport
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { directFetch, proxyEnvPresent } from '../lib/direct-fetch.js'

/**
 * 起一个 loopback HTTP 替身。
 *
 * @param {(req, res) => void} handler - 请求处理函数。
 * @returns {Promise<{origin: string, close: () => Promise<void>}>} 服务信息。
 */
async function serve(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

test('GET 保留状态、响应头与 body', async () => {
  const service = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-relay': 'yes' })
    res.end('{"ok":true}')
  })
  try {
    const response = await directFetch(`${service.origin}/v1/models`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/json')
    assert.equal(response.headers.get('x-relay'), 'yes')
    assert.equal(await response.text(), '{"ok":true}')
  } finally {
    await service.close()
  }
})

test('总是要求 identity 编码，不做解压', async () => {
  let seen
  const service = await serve((req, res) => {
    seen = req.headers['accept-encoding']
    res.writeHead(200)
    res.end('ok')
  })
  try {
    await directFetch(`${service.origin}/x`)
    assert.equal(seen, 'identity')
  } finally {
    await service.close()
  }
})

test('调用方自己指定的 accept-encoding 不会被覆盖', async () => {
  let seen
  const service = await serve((req, res) => {
    seen = req.headers['accept-encoding']
    res.writeHead(200)
    res.end('ok')
  })
  try {
    await directFetch(`${service.origin}/x`, { headers: { 'accept-encoding': 'gzip' } })
    assert.equal(seen, 'gzip')
  } finally {
    await service.close()
  }
})

test('非 2xx 状态原样返回', async () => {
  const service = await serve((_req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('nope')
  })
  try {
    const response = await directFetch(`${service.origin}/x`)
    assert.equal(response.status, 404)
    assert.equal(await response.text(), 'nope')
  } finally {
    await service.close()
  }
})

test('不跟随重定向', async () => {
  const service = await serve((_req, res) => {
    res.writeHead(302, { location: 'https://elsewhere.example/' })
    res.end()
  })
  try {
    const response = await directFetch(`${service.origin}/x`)
    assert.equal(response.status, 302, '重定向必须原样交给上层判断')
    assert.equal(response.headers.get('location'), 'https://elsewhere.example/')
  } finally {
    await service.close()
  }
})

test('POST 字符串 body 会带上 content-length', async () => {
  let body = ''
  let length
  const service = await serve((req, res) => {
    length = req.headers['content-length']
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      res.writeHead(200)
      res.end('got')
    })
  })
  try {
    const payload = '{"model":"deepseek-v4"}'
    const response = await directFetch(`${service.origin}/v1/chat/completions`, { method: 'POST', body: payload })
    assert.equal(response.status, 200)
    assert.equal(body, payload)
    assert.equal(length, String(Buffer.byteLength(payload)))
  } finally {
    await service.close()
  }
})

test('URLSearchParams body 被编码成表单', async () => {
  let body = ''
  const service = await serve((req, res) => {
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      res.writeHead(200)
      res.end('ok')
    })
  })
  try {
    await directFetch(`${service.origin}/x`, { method: 'POST', body: new URLSearchParams({ a: '1', b: '2' }) })
    assert.equal(body, 'a=1&b=2')
  } finally {
    await service.close()
  }
})

test('ReadableStream body 以分块上传发送', async () => {
  let body = ''
  const service = await serve((req, res) => {
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      res.writeHead(200)
      res.end('ok')
    })
  })
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-one-'))
        controller.enqueue(new TextEncoder().encode('chunk-two'))
        controller.close()
      },
    })
    const response = await directFetch(`${service.origin}/v1/chat/completions`, { method: 'POST', body: stream })
    assert.equal(response.status, 200)
    assert.equal(body, 'chunk-one-chunk-two')
  } finally {
    await service.close()
  }
})

test('HEAD 与 204 的响应不带 body', async () => {
  const service = await serve((req, res) => {
    if (req.method === 'HEAD') {
      res.writeHead(200)
      res.end()
      return
    }
    res.writeHead(204)
    res.end()
  })
  try {
    const head = await directFetch(`${service.origin}/x`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')

    const noContent = await directFetch(`${service.origin}/x`, { method: 'POST', body: 'x' })
    assert.equal(noContent.status, 204)
    assert.equal(await noContent.text(), '')
  } finally {
    await service.close()
  }
})

test('调用前就已中止的 signal 直接以 AbortError 拒绝', async () => {
  const service = await serve((_req, res) => {
    res.writeHead(200)
    res.end('too late')
  })
  try {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(directFetch(`${service.origin}/x`, { signal: controller.signal }), (error) => error.name === 'AbortError')
  } finally {
    await service.close()
  }
})

test('响应头到达之前中止，连接被切断', async () => {
  const service = await serve(() => {
    // 故意什么都不发：模拟中转站卡住的通道。
  })
  try {
    const controller = new AbortController()
    const pending = directFetch(`${service.origin}/x`, { signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(pending, (error) => error.name === 'AbortError')
  } finally {
    await service.close()
  }
})

test('连不上时以 TypeError( fetch failed ) 拒绝', async () => {
  const service = await serve((_req, res) => res.end())
  const dead = service.origin
  await service.close()
  await assert.rejects(directFetch(`${dead}/x`), (error) => error instanceof TypeError && error.message === 'fetch failed')
})

test('非 http(s) 或无绝对地址直接拒绝', async () => {
  await assert.rejects(directFetch('file:///etc/hosts'), TypeError)
  await assert.rejects(directFetch('/relative'), TypeError)
})

test('proxyEnvPresent 只认非空值', () => {
  assert.equal(proxyEnvPresent({}), false)
  assert.equal(proxyEnvPresent({ https_proxy: '' }), false)
  assert.equal(proxyEnvPresent({ http_proxy: '   ' }), false)
  assert.equal(proxyEnvPresent({ HTTPS_PROXY: 'http://127.0.0.1:7890' }), true)
  assert.equal(proxyEnvPresent({ http_proxy: 'http://127.0.0.1:7890' }), true)
  assert.equal(proxyEnvPresent({ all_proxy: 'socks5://127.0.0.1:1080' }), true)
})
