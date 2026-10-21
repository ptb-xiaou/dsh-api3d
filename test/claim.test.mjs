/**
 * 路由的存活：profile 的补丁层把 `llm-pi-ai.providers` 整个字典替换掉之后，本包的
 * 路由怎么被并回来、以及为什么必须在每次解析时并。
 *
 * @module dsh-api3d/test/claim
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, apply, claimRelayRoute, relayRouteState, watchRelayRoute, withRelayRoute } from '../lib/index.js'
import { PROVIDER, ROUTE } from '../lib/route.js'
import { PI_AI_ENTRY } from '../lib/route.js'
import { setField } from './harness.mjs'

const PI_AI_ROW = { options: { id: PI_AI_ENTRY.id, name: PI_AI_ENTRY.name, config: { providers: { mine: {} } } } }

/**
 * 造一个够用的上下文，并把 `on` / `inject` 的调用记下来。
 *
 * @param {object} options - `entries` 与 `update` 的行为。
 * @returns {object} 上下文与记录。
 */
function makeLoaderCtx({ entries = [], update } = {}) {
  const onCalls = []
  const injectCalls = []
  const warnings = []
  const effects = []
  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)), error() {}, info() {}, debug() {} },
    effect(callback, label) {
      const dispose = callback()
      effects.push({ label, dispose })
      return () => dispose?.()
    },
    on(event, listener, options) {
      onCalls.push({ event, listener, options })
      return () => {}
    },
    inject(services, callback) {
      injectCalls.push(services)
      callback(ctx)
    },
    get(service) {
      if (service !== 'loader') return undefined
      return {
        entries: () =>
          entries.map((entry) => ({
            options: entry.options,
            update: update ?? (async () => {}),
          })),
      }
    },
    onCalls,
    injectCalls,
    warnings,
    effects,
  }
  return ctx
}

test('claimRelayRoute：没有 loader 服务时报 absent', async () => {
  const ctx = { get: () => undefined }
  assert.equal(await claimRelayRoute(ctx), 'absent')
})

test('claimRelayRoute：找不到 llm-pi-ai 条目时报 absent', async () => {
  const ctx = makeLoaderCtx({ entries: [{ options: { id: 'other', name: 'other' } }] })
  assert.equal(await claimRelayRoute(ctx), 'absent')
})

test('claimRelayRoute：同名路由已经是本插件那条时报 declared 且不写条目', async () => {
  let writes = 0
  const ctx = makeLoaderCtx({
    entries: [
      {
        options: {
          id: PI_AI_ENTRY.id,
          name: PI_AI_ENTRY.name,
          config: { providers: { [PROVIDER]: structuredClone(ROUTE) } },
        },
      },
    ],
    update: async () => {
      writes += 1
    },
  })
  assert.equal(await claimRelayRoute(ctx), 'declared')
  assert.equal(writes, 0, '值一样就不该再写一次条目，那会白白触发一次重解析')
})

test('claimRelayRoute：同名路由是别人那条时覆盖成本插件那条', async () => {
  const seen = []
  const ctx = makeLoaderCtx({
    entries: [
      {
        options: {
          id: PI_AI_ENTRY.id,
          name: PI_AI_ENTRY.name,
          config: { providers: { [PROVIDER]: { displayName: '别人的同名路由', models: [] } } },
        },
      },
    ],
    update: async (next) => seen.push(next),
  })
  assert.equal(await claimRelayRoute(ctx), 'claimed')
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].config.providers[PROVIDER], ROUTE)
})

test('claimRelayRoute：导入的目录压过补丁层那条（导入后模型要出现）', async () => {
  const config = Config({ announce: false })
  setField(
    config,
    'models',
    JSON.stringify([{ id: 'deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017' }]),
  )
  const seen = []
  const ctx = makeLoaderCtx({
    entries: [
      {
        options: {
          id: PI_AI_ENTRY.id,
          name: PI_AI_ENTRY.name,
          config: { providers: { [PROVIDER]: structuredClone(ROUTE) } },
        },
      },
    ],
    update: async (next) => seen.push(next),
  })
  assert.equal(await claimRelayRoute(ctx, config), 'claimed')
  assert.deepEqual(
    seen[0].config.providers[PROVIDER].models.map((model) => model.id),
    ['deepseek-v4.1-flash-1017'],
  )
})

test('claimRelayRoute：路由被挤掉时写回条目', async () => {
  const seen = []
  const ctx = makeLoaderCtx({ entries: [PI_AI_ROW], update: async (next) => seen.push(next) })
  assert.equal(await claimRelayRoute(ctx), 'claimed')
  assert.equal(seen.length, 1)
  assert.deepEqual(Object.keys(seen[0].config.providers).sort(), [PROVIDER, 'mine'])
  assert.deepEqual(seen[0].config.providers[PROVIDER], ROUTE)
})

test('claimRelayRoute：providers 类型不对时不碰它，直接报 unusable', async () => {
  let writes = 0
  const ctx = makeLoaderCtx({
    entries: [{ options: { id: PI_AI_ENTRY.id, name: PI_AI_ENTRY.name, config: { providers: [] } } }],
    update: async () => {
      writes += 1
    },
  })
  assert.equal(await claimRelayRoute(ctx), 'unusable')
  assert.equal(writes, 0, '存在但类型不对是 profile 自己的表达，必须原样放行')
})

test('claimRelayRoute：条目不可配置时报 failed，而不是抛出去', async () => {
  const ctx = makeLoaderCtx({
    entries: [PI_AI_ROW],
    update: async () => {
      throw new Error('entry is not configurable')
    },
  })
  assert.equal(await claimRelayRoute(ctx), 'failed')
})

test('watchRelayRoute 挂在 internal/config 的全局 waterfall 上', () => {
  const ctx = makeLoaderCtx()
  const dispose = watchRelayRoute(ctx)
  assert.equal(typeof dispose, 'function')
  assert.equal(ctx.onCalls.length, 1)
  assert.equal(ctx.onCalls[0].event, 'internal/config')
  assert.deepEqual(ctx.onCalls[0].options, { global: true })
})

test('watchRelayRoute 只对 llm-pi-ai 条目并回路由', () => {
  const ctx = makeLoaderCtx()
  watchRelayRoute(ctx)
  const { listener } = ctx.onCalls[0]
  const config = { providers: { mine: {} } }

  const owned = listener.call({ entry: { options: PI_AI_ENTRY } }, config, () => config)
  assert.deepEqual(Object.keys(owned.providers).sort(), [PROVIDER, 'mine'])

  // 别的条目原样放行 —— 用的是同一个对象引用，说明没重建。
  const other = { providers: { mine: {} } }
  assert.equal(listener.call({ entry: { options: { id: 'llm-newapi', name: 'dsh-gateway-provider' } } }, other, () => other), other)

  // id 对但包名不对，也不该动。
  const wrongName = { providers: { mine: {} } }
  assert.equal(listener.call({ entry: { options: { id: PI_AI_ENTRY.id, name: 'someone-else' } } }, wrongName, () => wrongName), wrongName)
})

test('watchRelayRoute 不动已经带着本插件那条路由的配置', () => {
  const ctx = makeLoaderCtx()
  watchRelayRoute(ctx)
  const { listener } = ctx.onCalls[0]
  const config = { providers: { [PROVIDER]: structuredClone(ROUTE) } }
  assert.equal(listener.call({ entry: { options: PI_AI_ENTRY } }, config, () => config), config)
})

test('watchRelayRoute 把同名路由换成导入的目录，别的路由原样保留', () => {
  const config = Config({ announce: false })
  setField(
    config,
    'models',
    JSON.stringify([{ id: 'deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017' }]),
  )
  const ctx = makeLoaderCtx()
  watchRelayRoute(ctx, config)
  const { listener } = ctx.onCalls[0]
  const resolved = { providers: { [PROVIDER]: structuredClone(ROUTE), mine: { displayName: '别人' } } }

  const merged = listener.call({ entry: { options: PI_AI_ENTRY } }, resolved, () => resolved)
  assert.notEqual(merged, resolved)
  assert.deepEqual(
    merged.providers[PROVIDER].models.map((model) => model.id),
    ['deepseek-v4.1-flash-1017'],
  )
  assert.deepEqual(merged.providers.mine, { displayName: '别人' })
})

test('apply 在 claimRoute 开启时装上解析钩子并试写一次条目', async () => {
  const ctx = makeLoaderCtx({ entries: [PI_AI_ROW] })
  apply(ctx, Config({ announce: false }))
  await new Promise((resolve) => setImmediate(resolve))

  // loader 用来声明路由；connection 用来挂向导的两条 Fetch 路由。
  assert.deepEqual(ctx.injectCalls, [['loader'], ['connection']])
  assert.equal(ctx.onCalls.length, 1)
  assert.equal(ctx.onCalls[0].event, 'internal/config')
  // 三条 effect：解析钩子、试写条目，以及全局 fetch 围栏。
  assert.equal(ctx.effects.length, 3)
})

test('apply 在 claimRoute 关闭时不碰 loader，但仍然挂向导路由', async () => {
  const ctx = makeLoaderCtx({ entries: [PI_AI_ROW] })
  apply(ctx, Config({ announce: false, claimRoute: false }))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(ctx.injectCalls, [['connection']])
  assert.equal(ctx.onCalls.length, 0)
})

test('apply 在试写失败时只警告，不抛错', async () => {
  const ctx = makeLoaderCtx({
    entries: [PI_AI_ROW],
    update: async () => {
      throw new Error('nope')
    },
  })
  apply(ctx, Config({ announce: false }))
  await new Promise((resolve) => setImmediate(resolve))
  // claimRelayRoute 自己吞掉异常并返回 failed，所以只有那一条 warn。
  assert.ok(ctx.warnings.some((message) => message.includes('无法重新声明')))
})

test('relayRouteState 与 withRelayRoute 是同一套判据的两面', () => {
  const missing = { providers: {} }
  assert.equal(relayRouteState(missing), 'missing')
  assert.equal(relayRouteState(withRelayRoute(missing)), 'declared')
})
