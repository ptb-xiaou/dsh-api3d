/**
 * 静默重试：中转站内部把请求轮询到多个上游通道，个别通道会以「请求无效」拒绝一个
 * 本可重试的请求。开启后这类失败在插件内部重发，会话看不到中间那次失败。
 *
 * @module dsh-api3d/test/silent-retry
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { relayTransient400, scripted, withFenceResponses } from './harness.mjs'

const SENTINEL = 'https://upstream.api3d.invalid/v1/chat/completions'
const REQUEST = { method: 'POST', body: '{"model":"m"}' }

/**
 * 一个不带 body 的状态响应。
 *
 * @param {number} status - HTTP 状态码。
 * @returns {Response} 该响应。
 */
const status = (status_) => new Response('upstream hiccup', { status: status_ })

test('5xx 被重发，最终把成功的那次交出去', async () => {
  for (const code of [500, 502, 503, 504]) {
    await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([status(code), status(200)]), async ({ calls }) => {
      const response = await fetch(SENTINEL, REQUEST)
      assert.equal(response.status, 200, `HTTP ${code} 之后没有重发`)
      assert.equal(calls.length, 2)
    })
  }
})

test('400 且 body 命中通道方言时才重发', async () => {
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([relayTransient400(), status(200)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
  })
})

test('400 但 body 是真正的请求错误时不重发', async () => {
  const real = new Response(JSON.stringify({ error: { message: 'messages: field required' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([real, status(200)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 400, '真正的 400 必须原样报出去')
    assert.equal(calls.length, 1)
  })
})

test('400 的 content-type 不是 JSON/事件流时连读都不读', async () => {
  const html = new Response('must be passed back to the API', { status: 400, headers: { 'content-type': 'text/html' } })
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([html, status(200)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 400)
    assert.equal(calls.length, 1)
  })
})

test('重发次数含首次：attempts = 3 最多发三次', async () => {
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true, silentRetryAttempts: 3 }, scripted([status(503)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 503, '持续故障时必须报错而不是挂住')
    assert.equal(calls.length, 3)
  })
})

test('attempts = 1 等于关掉重发', async () => {
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true, silentRetryAttempts: 1 }, scripted([status(503), status(200)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 503)
    assert.equal(calls.length, 1)
  })
})

test('silentRetry 默认关闭，一次就报出去', async () => {
  await withFenceResponses({ baseURL: 'https://api.example.com/v1' }, scripted([status(503), status(200)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 503)
    assert.equal(calls.length, 1)
  })
})

test('429 不属于这一层：它归 harness 的重试栈管', async () => {
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([status(429), status(200)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 429)
    assert.equal(calls.length, 1)
  })
})

test('每次重发放上线的是完全相同的字节', async () => {
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([status(503), status(200)]), async ({ calls }) => {
    await fetch(SENTINEL, REQUEST)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].init.body, REQUEST.body)
    assert.equal(calls[1].init.body, REQUEST.body)
    assert.equal(calls[0].url, calls[1].url)
    assert.equal(calls[0].method, calls[1].method)
  })
})

test('已经被中止的请求不重发', async () => {
  const controller = new AbortController()
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([status(503), status(200)]), async ({ calls }) => {
    const pending = fetch(SENTINEL, { ...REQUEST, signal: controller.signal })
    controller.abort()
    const response = await pending
    assert.equal(response.status, 503)
    assert.equal(calls.length, 1)
  })
})

test('调用时就已中止的请求走单次派发', async () => {
  const controller = new AbortController()
  controller.abort()
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true }, scripted([status(503), status(200)]), async ({ calls }) => {
    const response = await fetch(SENTINEL, { ...REQUEST, signal: controller.signal })
    assert.equal(response.status, 503)
    assert.equal(calls.length, 1)
  })
})

test('最后一次的 400 响应仍可被调用方读取', async () => {
  await withFenceResponses({ baseURL: 'https://api.example.com/v1', silentRetry: true, silentRetryAttempts: 2 }, scripted([relayTransient400()]), async ({ calls }) => {
    const response = await fetch(SENTINEL, REQUEST)
    assert.equal(response.status, 400)
    assert.equal(calls.length, 2)
    assert.match(await response.text(), /must be passed back to the API/)
  })
})
