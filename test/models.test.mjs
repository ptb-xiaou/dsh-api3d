/**
 * 密钥/模型向导的宿主半契约。
 *
 * 向导的浏览器半只负责收集输入与展示结果；真正的活儿全在这边：拿密钥去站点查
 * 目录、把勾选的目录装回 `llm-pi-ai` 路由，以及把两件事暴露成 connection 围栏内
 * 的两条精确 Fetch 路由。
 *
 * 这里全部用假的 `globalThis.fetch` 与假的 loader —— 不碰网络、不启动宿主。唯一
 * 真打网络的地方是 `test/integration.test.mjs` 的 loopback 替身，而那是围栏的事。
 *
 * @module dsh-api3d/test/models
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Config,
  apply,
  applyImportedModels,
  discoverModels,
  importedModels,
  normalizeModelCatalog,
  routeOfCatalog,
  routeValue,
  withRelayRoute,
} from '../lib/index.js'
import { PI_AI_ENTRY, PROVIDER } from '../lib/site.js'
import { MODEL_TEMPLATE, ROUTE } from '../lib/route.js'
import { setField } from './harness.mjs'

/** 一个和测试夹具同样口径的设置段：路由声明与公告都关掉。 */
function makeConfig(overrides = {}) {
  return Config({ claimRoute: false, announce: false, directMode: 'never', ...overrides })
}

/**
 * 装上假 fetch 跑一段测试，结束后还原。
 *
 * @param {(input: unknown, init: object) => Response | Promise<Response>} respond - 造响应。
 * @param {(calls: object[]) => Promise<unknown> | unknown} body - 测试体。
 * @returns {Promise<unknown>} 测试体的返回值。
 */
async function withFetch(respond, body) {
  const calls = []
  const before = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    calls.push({ url: typeof input === 'string' ? input : String(input), init: init ?? {} })
    return respond(input, init)
  }
  try {
    return await body(calls)
  } finally {
    globalThis.fetch = before
  }
}

/** 一个 JSON 响应。 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 一个只够被 `claimRelayRoute` / `applyImportedModels` 认出来的 loader 条目。 */
function makeEntry(config = { providers: {} }) {
  const updates = []
  return {
    updates,
    entry: {
      options: { id: PI_AI_ENTRY.id, name: PI_AI_ENTRY.name, config },
      update: async (patch) => {
        updates.push(patch)
      },
    },
  }
}

/**
 * 一个够用的宿主上下文：`inject` 立刻回调，`get` 只认 loader。
 *
 * @returns {{ctx: object, effects: unknown[]}} 夹具。
 */
function makeHostCtx({ loader, connection } = {}) {
  const effects = []
  const ctx = {
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return () => dispose?.()
    },
    on: () => () => {},
    get(name) {
      if (name === 'loader') return loader
      if (name === 'connection') return connection
      return undefined
    },
    inject(_deps, callback) {
      const scoped = {
        connection,
        effect: (cb) => {
          const dispose = cb()
          effects.push(dispose)
          return dispose
        },
        get: (name) => ctx.get(name),
      }
      const dispose = callback(scoped)
      if (typeof dispose === 'function') effects.push(dispose)
      return dispose
    },
  }
  return { ctx, effects }
}

test('normalizeModelCatalog 认 OpenAI 形状并保留显示名', () => {
  assert.deepEqual(
    normalizeModelCatalog({ data: [{ id: 'a', display_name: 'A' }, { id: ' b ' }, { id: 'c', displayName: 'C' }] }),
    [
      { id: 'a', displayName: 'A' },
      { id: 'b', displayName: 'b' },
      { id: 'c', displayName: 'C' },
    ],
  )
})

test('normalizeModelCatalog 也认 Anthropic 形状与纯字符串条目', () => {
  assert.deepEqual(normalizeModelCatalog({ models: [{ name: 'x', displayName: 'X' }, 'y'] }), [
    { id: 'x', displayName: 'X' },
    { id: 'y', displayName: 'y' },
  ])
})

test('normalizeModelCatalog 丢弃认不出 id 的条目、重复 id 只留第一条', () => {
  assert.deepEqual(
    normalizeModelCatalog({ data: [null, { id: '' }, { id: '  ' }, {}, { id: 'dup', display_name: 'first' }, { id: 'dup', display_name: 'second' }] }),
    [{ id: 'dup', displayName: 'first' }],
  )
  assert.deepEqual(normalizeModelCatalog(undefined), [])
  assert.deepEqual(normalizeModelCatalog('nope'), [])
  assert.deepEqual(normalizeModelCatalog({ data: {} }), [])
})

test('importedModels 读 volatile 设置里那份 JSON 目录，坏数据回落成空', () => {
  const config = makeConfig()
  assert.deepEqual(importedModels(config), [])

  setField(config, 'models', JSON.stringify([{ id: 'm1', displayName: 'M1' }, 'm2']))
  assert.deepEqual(importedModels(config), [
    { id: 'm1', displayName: 'M1' },
    { id: 'm2', displayName: 'm2' },
  ])

  setField(config, 'models', 'not json')
  assert.deepEqual(importedModels(config), [])
  setField(config, 'models', '')
  assert.deepEqual(importedModels(config), [])
})

test('normalizeModelCatalog 保留站点上报的能力，缺字段不编造', () => {
  const [vision, nested, bare, onlyOff, emptyInput] = normalizeModelCatalog({
    data: [
      {
        id: 'vision-a',
        display_name: 'Vision A',
        input_modalities: ['text', 'image', 'audio'],
        context_length: '1000000',
        max_output_tokens: 384000,
        reasoning_efforts: ['off', 'low', 'high'],
      },
      {
        id: 'nested-b',
        limit: { context: 131072, output: 32768 },
        top_provider: { max_completion_tokens: 16384 },
      },
      { id: 'bare-c' },
      { id: 'only-off-d', input: ['text'], reasoningEfforts: { off: null } },
      { id: 'empty-input-e', input: [] },
    ],
  })

  // 认不出的模态（audio）被丢掉，字符串数字也认，档位数组按词汇表顺序落成映射。
  assert.deepEqual(vision, {
    id: 'vision-a',
    displayName: 'Vision A',
    input: ['text', 'image'],
    contextWindow: 1000000,
    maxTokens: 384000,
    reasoningEfforts: { off: null, low: 'low', high: 'high' },
  })
  // 嵌套字段名与宿主自己解析 /models 时用的那套一致。
  assert.deepEqual(nested, {
    id: 'nested-b',
    displayName: 'nested-b',
    contextWindow: 131072,
    maxTokens: 32768,
  })
  // 站点一个能力字段都没报时，条目里就不该有这些键：「没说」与「说了不支持」是两件事。
  assert.deepEqual(bare, { id: 'bare-c', displayName: 'bare-c' })
  // 只报 off 等于「非推理模型」，pi-ai 要求这种情况不要造出「有其它档位」的假象。
  assert.equal(onlyOff.reasoningEfforts, false)
  // 空的模态声明同样按「没说」处理，而不是按「不支持文本」。
  assert.equal(emptyInput.input, undefined)
})

test('向导写回的目录能被原样读回（能力字段往返）', () => {
  const config = makeConfig()
  const written = [
    {
      id: 'vision-a',
      displayName: 'Vision A',
      input: ['text', 'image'],
      contextWindow: 65536,
      maxTokens: 8192,
      reasoningEfforts: { off: null, high: 'high' },
    },
    { id: 'plain-b', displayName: 'Plain B', input: ['text'], reasoningEfforts: false },
  ]
  setField(config, 'models', JSON.stringify(written))
  // 浏览器半写进去的形状必须就是宿主半读出来的形状，否则每次重新打开向导能力都会漂移。
  assert.deepEqual(importedModels(config), written)
})

test('routeValue 未导入时是 undefined（不声明路由），导入后才铺出 models', () => {
  const config = makeConfig()
  // 零模型的自定义路由会被 pi-ai 判为配置错误，所以「没导入」只能表达成不声明。
  assert.equal(routeValue(config), undefined)

  setField(config, 'models', JSON.stringify([{ id: 'imported-a', displayName: 'Imported A' }]))
  const imported = routeValue(config)
  assert.deepEqual(
    imported.models.map((model) => model.id),
    ['imported-a'],
  )
  assert.equal(imported.models[0].name, 'Imported A')
  // 这条没声明任何能力，所以吃模板：上下文窗口、最大输出、思考档位都还是模板那一套
  // （声明了能力的条目会逐条覆盖，见下面的用例）。
  assert.equal(imported.models[0].contextWindow, MODEL_TEMPLATE.contextWindow)
  assert.equal(imported.models[0].maxTokens, MODEL_TEMPLATE.maxTokens)
  assert.equal(imported.models[0].compat.supportsReasoningEffort, true)
  // 模板本身不被就地改写。
  assert.deepEqual(MODEL_TEMPLATE.input, ['text'])
})

test('routeValue 逐条落能力：说了的覆盖模板，没说的吃模板，模板不被改写', () => {
  const config = makeConfig()
  setField(
    config,
    'models',
    JSON.stringify([
      {
        id: 'vision-a',
        displayName: 'Vision A',
        input: ['text', 'image'],
        contextWindow: 65536,
        maxTokens: 8192,
        reasoningEfforts: { off: null, high: 'high' },
      },
      { id: 'plain-b', displayName: 'Plain B' },
      { id: 'no-reasoning-c', displayName: 'No Reasoning C', reasoningEfforts: false },
    ]),
  )
  const [vision, plain, noReasoning] = routeValue(config).models

  assert.deepEqual(vision.input, ['text', 'image'])
  assert.equal(vision.contextWindow, 65536)
  assert.equal(vision.maxTokens, 8192)
  assert.deepEqual(vision.reasoningEfforts, { off: null, high: 'high' })
  // 模板里其余字段仍然在：这不是「整条描述符被替换」，只是能力被覆盖。
  assert.equal(vision.compat.supportsReasoningEffort, true)

  assert.deepEqual(plain.input, MODEL_TEMPLATE.input)
  assert.equal(plain.contextWindow, MODEL_TEMPLATE.contextWindow)
  assert.equal(plain.maxTokens, MODEL_TEMPLATE.maxTokens)
  assert.deepEqual(plain.reasoningEfforts, MODEL_TEMPLATE.reasoningEfforts)

  // 明确声明「非推理模型」要一路传到描述符，而不是回落到模板的档位表。
  assert.equal(noReasoning.reasoningEfforts, false)

  // 模板本身没被这批覆盖改坏。
  assert.equal(MODEL_TEMPLATE.contextWindow === 65536, false)
  assert.notDeepEqual(MODEL_TEMPLATE.input, ['text', 'image'])
})

test('withRelayRoute 用传入的路由声明，且不覆盖已有的同名 provider', () => {
  const custom = { ...routeOfCatalog([{ id: 'custom-model', displayName: 'Custom Model' }]), displayName: 'Custom' }
  const merged = withRelayRoute({ providers: {} }, custom)
  assert.equal(merged.providers[PROVIDER].displayName, 'Custom')
  assert.deepEqual(
    merged.providers[PROVIDER].models.map((model) => model.id),
    ['custom-model'],
  )

  const existing = { providers: { [PROVIDER]: { displayName: 'Mine' } } }
  assert.equal(withRelayRoute(existing, custom), existing)

  // `replace` 是「本插件自己那条路由说了算」的开关：补丁层里那条同名路由会被覆盖。
  const replaced = withRelayRoute(existing, custom, { replace: true })
  assert.notEqual(replaced, existing)
  assert.equal(replaced.providers[PROVIDER].displayName, 'Custom')

  // 值已经一样时仍然不重写，避免每次解析都变成一次条目更新。
  const declared = { providers: { [PROVIDER]: structuredClone(custom) } }
  assert.equal(withRelayRoute(declared, custom, { replace: true }), declared)
})

test('discoverModels 用 Bearer 密钥查站点，返回归一目录与规范化地址', async () => {
  const config = makeConfig()
  await withFetch(
    () => jsonResponse({ data: [{ id: 'deepseek-v4.1-flash', display_name: 'DeepSeek V4.1 Flash' }] }),
    async (calls) => {
      const result = await discoverModels(config, { apiKey: 'sk-test' })
      assert.equal(result.ok, true)
      assert.deepEqual(result.models, [{ id: 'deepseek-v4.1-flash', displayName: 'DeepSeek V4.1 Flash' }])
      assert.equal(result.baseURL, 'https://api3d.cn/v1')

      assert.equal(calls.length, 1)
      assert.equal(calls[0].url, 'https://api3d.cn/v1/models')
      assert.equal(calls[0].init.method, 'GET')
      assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
      assert.equal(calls[0].init.headers.accept, 'application/json')
      assert.ok(calls[0].init.signal instanceof AbortSignal)
    },
  )
})

test('discoverModels 优先用请求里的基础地址，并吃掉尾斜杠', async () => {
  const config = makeConfig()
  await withFetch(
    () => jsonResponse({ data: [{ id: 'm' }] }),
    async (calls) => {
      const result = await discoverModels(config, { apiKey: 'k', baseURL: ' https://relay.example.com/api/v1/// ' })
      assert.equal(result.ok, true)
      assert.equal(calls[0].url, 'https://relay.example.com/api/v1/models')
      assert.equal(result.baseURL, 'https://relay.example.com/api/v1')
    },
  )
})

test('discoverModels 的失败分类：缺密钥、地址不合法、鉴权失败、HTTP 错误', async () => {
  const config = makeConfig()
  assert.equal((await discoverModels(config, {})).code, 'missing-key')
  assert.equal((await discoverModels(config, { apiKey: '   ' })).code, 'missing-key')
  assert.equal((await discoverModels(config, { apiKey: 'k', baseURL: 'not a url' })).code, 'bad-base-url')
  assert.equal((await discoverModels(config, { apiKey: 'k', baseURL: 'ftp://relay.example.com/v1' })).code, 'bad-base-url')

  await withFetch(
    () => jsonResponse({ error: 'nope' }, 401),
    async () => {
      const result = await discoverModels(config, { apiKey: 'bad' })
      assert.equal(result.ok, false)
      assert.equal(result.code, 'unauthorized')
      assert.match(result.message, /密钥/)
    },
  )

  await withFetch(
    () => jsonResponse({}, 500),
    async () => {
      assert.equal((await discoverModels(config, { apiKey: 'k' })).code, 'http-500')
    },
  )
})

test('discoverModels 的失败分类：非 JSON、空目录、连不上', async () => {
  const config = makeConfig()
  await withFetch(
    () => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    async () => {
      assert.equal((await discoverModels(config, { apiKey: 'k' })).code, 'bad-body')
    },
  )

  await withFetch(
    () => jsonResponse({ data: [] }),
    async () => {
      assert.equal((await discoverModels(config, { apiKey: 'k' })).code, 'empty-catalog')
    },
  )

  await withFetch(
    () => {
      throw new TypeError('fetch failed')
    },
    async () => {
      const result = await discoverModels(config, { apiKey: 'k' })
      assert.equal(result.code, 'transport')
      assert.match(result.message, /连不上站点/)
    },
  )
})

test('applyImportedModels 把导入目录写进 llm-pi-ai 的 providers', async () => {
  const config = makeConfig()
  setField(config, 'models', JSON.stringify([{ id: 'm1', displayName: 'M1' }, { id: 'm2' }]))
  const { entry, updates } = makeEntry({ providers: { mine: { displayName: 'Mine' } } })
  const loader = { entries: () => [entry] }
  const { ctx } = makeHostCtx({ loader })

  const result = await applyImportedModels(ctx, config)
  assert.deepEqual(result, { ok: true, models: ['m1', 'm2'] })

  assert.equal(updates.length, 1)
  const providers = updates[0].config.providers
  assert.deepEqual(Object.keys(providers).sort(), ['api3d', 'mine'])
  assert.deepEqual(
    providers[PROVIDER].models.map((model) => model.id),
    ['m1', 'm2'],
  )
  assert.deepEqual(providers.mine, { displayName: 'Mine' })
})

test('applyImportedModels 优先用请求体里那份目录（fiber 上的配置还是旧的）', async () => {
  // 复现向导导入那一刻：设置里刚写进新目录，但插件 fiber 上的 config 仍是上一份，
  // 只读它就等于把旧目录写进路由 —— 这正是「导入后模型不出现」的另一半原因。
  const config = makeConfig()
  setField(config, 'models', JSON.stringify([{ id: 'stale-model' }]))
  const { entry, updates } = makeEntry({
    providers: { [PROVIDER]: routeOfCatalog([{ id: 'old-model', displayName: 'Old' }]) },
  })
  const { ctx } = makeHostCtx({ loader: { entries: () => [entry] } })

  const result = await applyImportedModels(ctx, config, [
    { id: 'fresh-model', displayName: 'Fresh', input: ['text', 'image'] },
  ])
  assert.deepEqual(result, { ok: true, models: ['fresh-model'] })

  assert.equal(updates.length, 1)
  const route = updates[0].config.providers[PROVIDER]
  assert.deepEqual(
    route.models.map((model) => model.id),
    ['fresh-model'],
  )
  assert.deepEqual(route.models[0].input, ['text', 'image'])
})

test('applyImportedModels 在路由已经是同一份时不再写条目', async () => {
  const config = makeConfig()
  setField(config, 'models', JSON.stringify([{ id: 'm1' }]))
  const { entry, updates } = makeEntry({ providers: {} })
  // 真 loader 写完会把 patch 落到条目自己的 options 上，这里也这么做。
  entry.update = async (patch) => {
    updates.push(patch)
    entry.options.config = patch.config
  }
  const { ctx } = makeHostCtx({ loader: { entries: () => [entry] } })

  assert.deepEqual(await applyImportedModels(ctx, config), { ok: true, models: ['m1'] })
  assert.equal(updates.length, 1)

  // 第二次导入同一份目录：路由值没变，不该再触发一次重解析。
  assert.deepEqual(await applyImportedModels(ctx, config), { ok: true, models: ['m1'] })
  assert.equal(updates.length, 1)
})

test('applyImportedModels 的失败分类：没导入、没 loader、没条目、条目不可合并', async () => {
  const config = makeConfig()
  const { entry } = makeEntry({ providers: {} })
  const { ctx } = makeHostCtx({ loader: { entries: () => [entry] } })

  assert.equal((await applyImportedModels(ctx, config)).code, 'models-empty')

  setField(config, 'models', JSON.stringify([{ id: 'm1' }]))
  const empty = makeHostCtx({})
  assert.equal((await applyImportedModels(empty.ctx, config)).code, 'no-loader')

  const noEntry = makeHostCtx({ loader: { entries: () => [] } })
  assert.equal((await applyImportedModels(noEntry.ctx, config)).code, 'no-entry')

  const broken = makeEntry('nope')
  const brokenCtx = makeHostCtx({ loader: { entries: () => [broken.entry] } })
  assert.equal((await applyImportedModels(brokenCtx.ctx, config)).code, 'unusable')
})

test('apply 把两条向导路由注册进 connection 的鉴权围栏', async () => {
  const config = makeConfig()
  setField(config, 'models', JSON.stringify([{ id: 'picked-model', displayName: 'Picked' }]))
  const { entry, updates } = makeEntry({ providers: {} })
  const loader = { entries: () => [entry] }
  const routes = []
  const connection = {
    fetch: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  const { ctx } = makeHostCtx({ loader, connection })

  await withFetch(
    () => jsonResponse({ data: [{ id: 'live-model', display_name: 'Live Model' }] }),
    async () => {
      apply(ctx, config)
      assert.equal(routes.length, 2)
      assert.deepEqual(
        routes.map((route) => route.path),
        ['/api/api3d.models', '/api/api3d.apply'],
      )
      for (const route of routes) {
        assert.deepEqual(route.methods, ['POST'])
        assert.equal(route.requestBody, 'buffered')
      }

      const modelsResponse = await routes[0].fetch(
        new Request('http://127.0.0.1/api/api3d.models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ apiKey: 'sk-test' }),
        }),
      )
      assert.equal(modelsResponse.status, 200)
      const modelsBody = await modelsResponse.json()
      assert.equal(modelsBody.ok, true)
      assert.deepEqual(modelsBody.models, [{ id: 'live-model', displayName: 'Live Model' }])

      const applyResponse = await routes[1].fetch(
        new Request('http://127.0.0.1/api/api3d.apply', { method: 'POST' }),
      )
      assert.equal(applyResponse.status, 200)
      const applyBody = await applyResponse.json()
      assert.deepEqual(applyBody, { ok: true, models: ['picked-model'] })
      assert.deepEqual(
        updates[0].config.providers[PROVIDER].models.map((model) => model.id),
        ['picked-model'],
      )
    },
  )
})

test('apply 在缺少 connection 时只警告，不打断围栏与路由声明', async () => {
  const config = makeConfig()
  const warnings = []
  const { ctx } = makeHostCtx({})
  ctx.logger.warn = (message) => warnings.push(String(message))

  apply(ctx, config)
  assert.ok(warnings.some((line) => line.includes('connection')))
  assert.equal(typeof globalThis.fetch, 'function')
})

test('discoverModels 成功时附带向导每行的初值与词汇表', async () => {
  const config = makeConfig()
  await withFetch(
    () => jsonResponse({ data: [{ id: 'm1' }] }),
    async () => {
      const result = await discoverModels(config, { apiKey: 'sk-test' })
      assert.equal(result.ok, true)
      // 站点不报能力时，向导要有一份可以改的起点：能力模板。
      assert.deepEqual(result.defaults.input, MODEL_TEMPLATE.input)
      assert.equal(result.defaults.contextWindow, MODEL_TEMPLATE.contextWindow)
      assert.equal(result.defaults.maxTokens, MODEL_TEMPLATE.maxTokens)
      assert.deepEqual(result.defaults.reasoningEfforts, MODEL_TEMPLATE.reasoningEfforts)
      // 词汇表跟着回去，免得浏览器半再抄一份常量。
      assert.deepEqual(result.defaults.levels, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
      assert.deepEqual(result.defaults.modalities, ['text', 'image'])
    },
  )
})
