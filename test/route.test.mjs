/**
 * 路由骨架的一致性：`lib/route.js` 是**手写**模块（不是生成物），补丁层只负责 `- insert:`
 * 本插件、不声明路由。这里同时覆盖围栏用来判断「路由还在不在」的三态判定，以及
 * `withRelayRoute` 的「缺失才补 / 要求覆盖才覆盖 / 没有目录就不声明」三种语义。
 *
 * @module dsh-api3d/test/route
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// js-yaml 在这个宿主里是 CJS，具名导入在 ESM 下解析不到，走默认导出。
import yaml from 'js-yaml'
import { MODEL_TEMPLATE, PI_AI_ENTRY, PROVIDER, ROUTE } from '../lib/route.js'
import { SETTINGS_NAMESPACE, name, relayRouteState, withRelayRoute } from '../lib/index.js'
import { BUNDLE_NAME, ROW_ID, SENTINEL, SENTINEL_PATH } from '../lib/site.js'

const patch = yaml.load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))

/** pi-ai 认识的两个输入模态；模板里出现别的就是错的。 */
const MODALITIES = ['text', 'image']

/** pi-ai 认识的思考档位。 */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** 一个「有目录」的路由值：装给 llm-pi-ai 的就是这个形状。 */
const INSTALLED = { ...ROUTE, models: [{ id: 'm1', name: 'M1' }] }

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

test('补丁层只插入本插件，不声明 llm-pi-ai 路由', () => {
  // 声明一条带模型的路由 = 还没导入就显示模型；声明一条不带模型的路由 = pi-ai 把
  // 它判为配置错误（resolves no models）。两条都不可接受，所以路由只在运行时装。
  assert.equal(rowById(PI_AI_ENTRY.id), undefined, '补丁层不该再有 llm-pi-ai 行')

  const inserted = patch.find((row) => Array.isArray(row?.insert))
  assert.ok(inserted, 'insert 行缺失')
  const entry = inserted.insert.find((item) => item.id === ROW_ID)
  assert.deepEqual(entry, { id: ROW_ID, name: BUNDLE_NAME })
})

test('路由骨架刻意不带 models（零模型声明会被 pi-ai 拒绝）', () => {
  assert.equal(ROUTE.models, undefined)
  assert.equal(PROVIDER, 'api3d')
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

test('能力模板在 pi-ai 的合法词汇表内', () => {
  assert.equal(typeof MODEL_TEMPLATE.id, 'string')
  assert.ok(MODEL_TEMPLATE.id.length > 0)
  assert.equal(typeof MODEL_TEMPLATE.name, 'string')
  assert.ok(Number.isInteger(MODEL_TEMPLATE.contextWindow) && MODEL_TEMPLATE.contextWindow > 0)
  assert.ok(Number.isInteger(MODEL_TEMPLATE.maxTokens) && MODEL_TEMPLATE.maxTokens > 0)
  assert.ok(Array.isArray(MODEL_TEMPLATE.input) && MODEL_TEMPLATE.input.length > 0)
  for (const modality of MODEL_TEMPLATE.input) assert.ok(MODALITIES.includes(modality), modality)

  const efforts = MODEL_TEMPLATE.reasoningEfforts
  assert.ok(efforts && typeof efforts === 'object', '模板要么是 false，要么给出档位映射')
  const levels = Object.keys(efforts)
  assert.ok(levels.length > 0)
  for (const level of levels) assert.ok(THINKING_LEVELS.includes(level), level)
  for (const [level, wire] of Object.entries(efforts)) {
    if (level === 'off') assert.equal(wire, null, 'off 必须是不发送（null）')
    else assert.equal(typeof wire, 'string', `${level} 必须给出线上拼写`)
    if (typeof wire === 'string') assert.ok(wire.length > 0, `${level} 的拼写不能为空`)
  }
})

test('relayRouteState 区分 declared / missing / unusable', () => {
  assert.equal(relayRouteState({ providers: { [PROVIDER]: {} } }), 'declared')
  assert.equal(relayRouteState({ providers: { other: {} } }), 'missing')
  assert.equal(relayRouteState({}), 'missing')
  assert.equal(relayRouteState({ providers: undefined }), 'missing')
  assert.equal(relayRouteState({ providers: [] }), 'unusable')
  assert.equal(relayRouteState({ providers: 'nope' }), 'unusable')
  // 整条配置缺失是常态（本包不再自带 llm-pi-ai 声明）：那是「没有」，不是「不可用」。
  assert.equal(relayRouteState(undefined), 'missing')
  assert.equal(relayRouteState(null), 'missing')
  assert.equal(relayRouteState([]), 'unusable')
})

test('withRelayRoute 从「整条配置缺失」起底', () => {
  const merged = withRelayRoute(undefined, INSTALLED)
  assert.deepEqual(merged, { providers: { [PROVIDER]: INSTALLED } })
  assert.deepEqual(withRelayRoute(null, INSTALLED, { replace: true }), {
    providers: { [PROVIDER]: INSTALLED },
  })
})

test('withRelayRoute 默认放行类型不对的配置，force 时才按空配置覆盖', () => {
  const broken = { providers: [] }
  assert.equal(withRelayRoute(broken, INSTALLED, { replace: true }), broken, '默认原样放行')

  const forced = withRelayRoute(broken, INSTALLED, { replace: true, force: true })
  assert.deepEqual(forced, { providers: { [PROVIDER]: INSTALLED } })

  const scalar = withRelayRoute('nope', INSTALLED, { replace: true, force: true })
  assert.deepEqual(scalar, { providers: { [PROVIDER]: INSTALLED } })
})

test('withRelayRoute 只补缺失，不覆盖 profile 自己的声明', () => {
  const merged = withRelayRoute({ providers: { mine: { api: 'openai-completions' } } }, INSTALLED)
  assert.deepEqual(Object.keys(merged.providers).sort(), [PROVIDER, 'mine'])
  assert.deepEqual(merged.providers[PROVIDER], INSTALLED)
  // 并入的是副本，改它不会污染传进来的路由值。
  assert.notEqual(merged.providers[PROVIDER], INSTALLED)

  const own = { providers: { [PROVIDER]: { api: 'openai-responses' } } }
  assert.equal(withRelayRoute(own, INSTALLED), own, 'profile 自己声明了同名路由时必须原样放行')

  const absent = { providers: { [PROVIDER]: {} } }
  assert.equal(withRelayRoute(absent, INSTALLED), absent, '已经带着路由时不该重建对象')
})

test('withRelayRoute 在 replace: true 时用本插件的值覆盖同名路由', () => {
  const own = { providers: { [PROVIDER]: { api: 'openai-responses' }, mine: {} } }
  const merged = withRelayRoute(own, INSTALLED, { replace: true })
  assert.deepEqual(merged.providers[PROVIDER], INSTALLED)
  assert.deepEqual(merged.providers.mine, {}, '其它路由原样保留')

  const same = { providers: { [PROVIDER]: INSTALLED } }
  assert.equal(withRelayRoute(same, INSTALLED, { replace: true }), same, '值一样时不重写')
})

test('withRelayRoute 在「没有导入目录」时什么都不做', () => {
  // 既不声明，也不撤下别人声明的同名路由（那可能是 profile 自己写给另一个中转站的）。
  const missing = { providers: { mine: {} } }
  assert.equal(withRelayRoute(missing, undefined, { replace: true }), missing)
  const declared = { providers: { [PROVIDER]: { displayName: '别人的' } } }
  assert.equal(withRelayRoute(declared, undefined, { replace: true }), declared)
})
