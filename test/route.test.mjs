/**
 * 路由声明的一致性：`lib/route.js` 是 `cordis.patch.yml` 的生成物，两者的漂移必须
 * 被测试挡住。另外覆盖围栏用来判断「路由还在不在」的三态判定。
 *
 * @module dsh-api3d/test/route
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// js-yaml 在这个宿主里是 CJS，具名导入在 ESM 下解析不到，走默认导出。
import yaml from 'js-yaml'
import { PI_AI_ENTRY, PROVIDER, ROUTE } from '../lib/route.js'
import { SETTINGS_NAMESPACE, name, relayRouteState, withRelayRoute } from '../lib/index.js'
import { BUNDLE_NAME, ROW_ID, SENTINEL, SENTINEL_PATH } from '../lib/site.js'

const patch = yaml.load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))

/**
 * 在补丁层里找一条顶层行。
 *
 * @param {string} id - 行 id。
 * @returns {object | undefined} 该行。
 */
function rowById(id) {
  return patch.find((row) => row?.id === id)
}

test('插件名与设置命名空间都等于补丁层的行 id', () => {
  assert.equal(name, ROW_ID)
  assert.equal(SETTINGS_NAMESPACE, ROW_ID)
  assert.equal(ROW_ID, 'api3d')
  assert.equal(BUNDLE_NAME, 'dsh-api3d')
})

test('补丁层声明了 llm-pi-ai 行与本插件的 insert 行', () => {
  const piAi = rowById(PI_AI_ENTRY.id)
  assert.ok(piAi, 'llm-pi-ai 行缺失')
  assert.equal(piAi.name, PI_AI_ENTRY.name)

  const inserted = patch.find((row) => Array.isArray(row?.insert))
  assert.ok(inserted, 'insert 行缺失')
  const entry = inserted.insert.find((item) => item.id === ROW_ID)
  assert.deepEqual(entry, { id: ROW_ID, name: BUNDLE_NAME })
})

test('lib/route.js 与 cordis.patch.yml 声明的那条路由完全一致', () => {
  const declared = rowById(PI_AI_ENTRY.id)?.config?.providers?.[PROVIDER]
  assert.ok(declared, `补丁层没有 providers.${PROVIDER}`)
  assert.equal(PROVIDER, 'api3d')
  // 这一条是防止有人手改了 YAML 却忘了跑 npm run gen-route。
  assert.deepEqual(ROUTE, declared)
})

test('路由的 baseURL 指向哨兵主机，且是 http(s)', () => {
  const url = new URL(ROUTE.baseURL)
  assert.equal(url.host, SENTINEL)
  assert.equal(url.pathname, SENTINEL_PATH)
  assert.equal(url.protocol, 'https:')
  assert.equal(SENTINEL, 'upstream.api3d.invalid')
})

test('路由的凭据字段是 引用 而不是密钥', () => {
  assert.match(ROUTE.apiKeyEnv, /^[A-Za-z_][A-Za-z0-9_]*$/)
  assert.equal(ROUTE.apiKeyEnv, 'API3D_API_KEY')
  // 密钥永远不进 headers —— 适配器会把 headers 原样交给设置页渲染。
  assert.equal(ROUTE.headers, undefined)
})

test('路由自带模型目录，避免适配器去哨兵主机做自动发现', () => {
  assert.ok(Array.isArray(ROUTE.models) && ROUTE.models.length > 0)
  for (const model of ROUTE.models) {
    assert.equal(typeof model.id, 'string')
    assert.equal(typeof model.name, 'string')
    assert.ok(Number.isInteger(model.contextWindow) && model.contextWindow > 0)
    assert.ok(Number.isInteger(model.maxTokens) && model.maxTokens > 0)
    assert.ok(model.reasoningEfforts && typeof model.reasoningEfforts === 'object')
  }
})

test('relayRouteState 区分 declared / missing / unusable', () => {
  assert.equal(relayRouteState({ providers: { [PROVIDER]: {} } }), 'declared')
  assert.equal(relayRouteState({ providers: { other: {} } }), 'missing')
  assert.equal(relayRouteState({}), 'missing')
  assert.equal(relayRouteState({ providers: undefined }), 'missing')
  assert.equal(relayRouteState({ providers: [] }), 'unusable')
  assert.equal(relayRouteState({ providers: 'nope' }), 'unusable')
  assert.equal(relayRouteState(null), 'unusable')
  assert.equal(relayRouteState([]), 'unusable')
})

test('withRelayRoute 只补缺失，不覆盖 profile 自己的声明', () => {
  const merged = withRelayRoute({ providers: { mine: { api: 'openai-completions' } } })
  assert.deepEqual(Object.keys(merged.providers).sort(), [PROVIDER, 'mine'])
  assert.deepEqual(merged.providers[PROVIDER], ROUTE)
  // 并入的是副本，改它不会污染模块级的 ROUTE。
  assert.notEqual(merged.providers[PROVIDER], ROUTE)

  const own = { providers: { [PROVIDER]: { api: 'openai-responses' } } }
  assert.equal(withRelayRoute(own), own, 'profile 自己声明了同名路由时必须原样放行')

  const absent = { providers: { [PROVIDER]: {} } }
  assert.equal(withRelayRoute(absent), absent, '已经带着路由时不该重建对象')
})
