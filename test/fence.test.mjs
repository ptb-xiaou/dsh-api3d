/**
 * 围栏的出站改写：地址、归属头、透传边界、卸载与叠层安全。
 *
 * @module dsh-api3d/test/fence
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, apply } from '../lib/index.js'
import { getField, makeCtx, setField, withFence } from './harness.mjs'

const SENTINEL_MODELS = 'https://upstream.api3d.invalid/v1/chat/completions'

test('哨兵请求被改写为设置里的基础地址', async () => {
  await withFence({ baseURL: 'https://api.example.com/v1' }, async ({ calls }) => {
    const response = await fetch(SENTINEL_MODELS, { method: 'POST', body: '{}' })
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions')
    assert.equal(calls[0].init.method, 'POST')
  })
})

test('路径前缀整体替换，而不是简单拼接', async () => {
  // 路由的 baseURL 是 /v1；站点把接口挂在 /api/v1 下时必须整段换掉，否则会拼成
  // /v1/api/v1/chat/completions。
  await withFence({ baseURL: 'https://api.example.com/api/v1' }, async ({ calls }) => {
    await fetch(SENTINEL_MODELS)
    assert.equal(calls[0].url, 'https://api.example.com/api/v1/chat/completions')
  })
})

test('基础地址只写到域名时，路由声明的 /v1 前缀被保留', async () => {
  // OpenAI 兼容中转站几乎都挂在 /v1 下；把 /v1 丢掉会让「只填域名」变成安静的 404。
  await withFence({ baseURL: 'https://api.example.com' }, async ({ calls }) => {
    await fetch(SENTINEL_MODELS)
    assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions')
  })
  await withFence({ baseURL: 'https://api.example.com/' }, async ({ calls }) => {
    await fetch(SENTINEL_MODELS)
    assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions')
  })
})

test('基础地址的协议与端口一并生效', async () => {
  await withFence({ baseURL: 'http://127.0.0.1:8080/v1/' }, async ({ calls }) => {
    await fetch('https://upstream.api3d.invalid/v1/models')
    assert.equal(calls[0].url, 'http://127.0.0.1:8080/v1/models')
  })
})

test('不属于本路由的主机原样透传', async () => {
  await withFence({ baseURL: 'https://api.example.com/v1', userAgent: 'x' }, async ({ calls }) => {
    const input = 'https://other.example.org/anything'
    const init = { method: 'GET' }
    await fetch(input, init)
    assert.equal(calls[0].url, input)
    // 透传是原样的：连 headers 对象都不该被换成新集合。
    assert.equal(calls[0].init, init)
  })
})

test('没填地址时回落到站点默认地址（api3d.cn），开箱即用', async () => {
  await withFence({}, async ({ calls, config }) => {
    assert.equal(getField(config, 'baseURL'), 'https://api3d.cn/v1')
    await fetch(SENTINEL_MODELS)
    assert.equal(calls[0].url, 'https://api3d.cn/v1/chat/completions')
  })
})

test('把地址显式清空后哨兵请求原样透传，好让 DNS 大声失败', async () => {
  // 默认值存在，所以「空」必须由用户显式清空才成立 —— 那时请求真的打到哨兵主机，
  // 以 DNS 失败告终，而不是静默连上一台真实服务器。
  await withFence({ baseURL: '' }, async ({ calls, config }) => {
    assert.equal(getField(config, 'baseURL'), '')
    await fetch(SENTINEL_MODELS)
    assert.equal(calls[0].url, SENTINEL_MODELS)
  })
})

test('地址不是 http(s) 时不做改写', async () => {
  await withFence({ baseURL: 'file:///etc/passwd' }, async ({ calls }) => {
    await fetch(SENTINEL_MODELS)
    assert.equal(calls[0].url, SENTINEL_MODELS)
  })
})

test('路由已经被写成真实主机时，只改归属头、不动 URL', async () => {
  await withFence({ baseURL: 'https://api.example.com/v1', userAgent: 'relay/1.0' }, async ({ calls }) => {
    const input = 'https://api.example.com/v1/chat/completions'
    await fetch(input, { headers: { 'x-keep': 'yes' } })
    assert.equal(calls[0].url, input)
    const headers = new Headers(calls[0].init.headers)
    assert.equal(headers.get('user-agent'), 'relay/1.0')
    assert.equal(headers.get('x-keep'), 'yes')
  })
})

test('User-Agent 留空就不碰调用方的头', async () => {
  await withFence({ baseURL: 'https://api.example.com/v1' }, async ({ calls }) => {
    await fetch(SENTINEL_MODELS, { headers: { 'user-agent': 'harness-attribution/9' } })
    const headers = new Headers(calls[0].init.headers)
    assert.equal(headers.get('user-agent'), 'harness-attribution/9')
  })
})

test('填了 User-Agent 就覆盖调用方的头', async () => {
  await withFence({ baseURL: 'https://api.example.com/v1', userAgent: 'claude-cli/2.1.300 (external, cli)' }, async ({ calls }) => {
    await fetch(SENTINEL_MODELS, { headers: { 'user-agent': 'deepseek-harness/0.1.7' } })
    const headers = new Headers(calls[0].init.headers)
    assert.equal(headers.get('user-agent'), 'claude-cli/2.1.300 (external, cli)')
  })
})

test('地址是逐请求解析的：写完设置下一个请求立刻生效', async () => {
  await withFence({ baseURL: 'https://a.example.com/v1' }, async ({ calls, config }) => {
    await fetch(SENTINEL_MODELS)
    assert.equal(calls[0].url, 'https://a.example.com/v1/chat/completions')

    setField(config, 'baseURL', 'https://b.example.com/api/v1')

    await fetch(SENTINEL_MODELS)
    assert.equal(calls[1].url, 'https://b.example.com/api/v1/chat/completions')
  })
})

test('URL 对象与 Request 对象两种入参都被改写', async () => {
  await withFence({ baseURL: 'https://api.example.com/v1' }, async ({ calls }) => {
    await fetch(new URL(SENTINEL_MODELS))
    assert.equal(calls[0].url, 'https://api.example.com/v1/chat/completions')

    const request = new Request(SENTINEL_MODELS, { method: 'POST', body: 'stream-me' })
    await fetch(request)
    assert.equal(calls[1].url, 'https://api.example.com/v1/chat/completions')
    assert.equal(calls[1].method, 'POST')
    // 裸 Request 会被重建成新 Request（body 是流，必须带 duplex 才能构造成功），
    // 所以看 body 要去 Request 上找，而不是看 init。
    assert.equal(calls[1].hasBody, true, '流式 body 必须活过重建')
  })
})

test('卸载时只还原自己装上的那个 fetch', async () => {
  const { ctx, dispose } = makeCtx()
  const before = globalThis.fetch
  const native = async () => new Response('native')
  globalThis.fetch = native
  try {
    apply(ctx, Config({ claimRoute: false, announce: false }))
    const fenced = globalThis.fetch
    assert.notEqual(fenced, native)

    dispose()
    assert.equal(globalThis.fetch, native)
  } finally {
    globalThis.fetch = before
  }
})

test('卸载不会冲掉之后叠加上来的那层包装', async () => {
  const { ctx, dispose } = makeCtx()
  const before = globalThis.fetch
  const native = async () => new Response('native')
  globalThis.fetch = native
  try {
    apply(ctx, Config({ claimRoute: false, announce: false }))
    const ours = globalThis.fetch
    const outer = async (...args) => ours(...args)
    globalThis.fetch = outer

    dispose()
    assert.equal(globalThis.fetch, outer, '上层包装才是全局的拥有者')
  } finally {
    globalThis.fetch = before
  }
})

test('没有全局 fetch 时只警告，不抛错', () => {
  const { ctx, dispose } = makeCtx()
  const before = globalThis.fetch
  const warnings = []
  ctx.logger.warn = (message) => warnings.push(message)
  // @ts-expect-error 故意制造缺失的全局 fetch
  delete globalThis.fetch
  try {
    apply(ctx, Config({ claimRoute: false, announce: false }))
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /没有可包装的全局 fetch/)
  } finally {
    globalThis.fetch = before
    dispose()
  }
})
