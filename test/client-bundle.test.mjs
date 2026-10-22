/**
 * 浏览器半的装载契约。
 *
 * 官方不发布一个可导入的浏览器产物，所以这里用宿主网页同样的方式装载它：伪造
 * `window.__ModuleLoader__.load`，把它注册的贡献取出来，再用假的 `require` 调用
 * 工厂，最后用假的浏览器上下文跑 `apply`。
 *
 * 这些断言的价值在于「两半不许悄悄漂移」：`SETTINGS_NS` 在浏览器半是手写字面量
 * （浏览器包不能 import 宿主包），所以它必须与宿主半的 `SETTINGS_NAMESPACE`
 * 逐字相等 —— 不等就是一个静默失效的设置卡。
 *
 * @module dsh-api3d/test/client-bundle
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SETTINGS_NAMESPACE } from '../lib/index.js'
import { BUNDLE_NAME, ROW_ID } from '../lib/site.js'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * 把浏览器半装载出来。
 *
 * @returns {{contribution: object, exported: object}} 注册的贡献与工厂的导出。
 */
function loadClient() {
  let contribution
  const window = { __ModuleLoader__: { load: (value) => { contribution = value } } }
  // 宿主网页就是这么执行的：源码假定 window 在作用域里。
  new Function('window', source)(window)
  assert.ok(contribution, '客户端半没有调用 window.__ModuleLoader__.load')

  const stub = (name) => {
    const Component = (props) => ({ type: name, props })
    Component.displayName = name
    return Component
  }
  const modules = {
    react: {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (initial) => [initial, () => {}],
      useEffect: (callback) => callback(),
      useCallback: (callback) => callback,
      useSyncExternalStore: (subscribe, get) => get(),
    },
    '@deepseek-ai/dsh-client-ui-primitives': {
      SettingsForm: stub('SettingsForm'),
      SegmentedControl: stub('SegmentedControl'),
      Switch: stub('Switch'),
      Modal: stub('Modal'),
      Menu: stub('Menu'),
      IconChevronDownOutlineRegular: stub('IconChevronDownOutlineRegular'),
    },
  }
  const exported = contribution.factory((id) => {
    if (!(id in modules)) throw new Error(`客户端半 require 了未声明的模块: ${id}`)
    return modules[id]
  })
  return { contribution, exported }
}

/** 一个够用的设置表单控制器快照。 */
function fakeForm(value = {}) {
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true, revision: 1 }),
    subscribe: () => () => {},
    mutate: async () => {},
  }
}

/** 一个够用的浏览器上下文，记录每个槽位挂载了什么。 */
function makeClientCtx() {
  const registrations = []
  const dictionaries = {}
  const effects = []
  const served = []
  const ctx = {
    effect(callback, label) {
      const dispose = callback()
      effects.push(label)
      return () => dispose?.()
    },
    locale: {
      register(namespace, dict) {
        dictionaries[namespace] = dict
        return () => {}
      },
      bind: () => (key) => key,
    },
    configForms: {
      get(namespace) {
        return { namespace, getSnapshot: () => ({ status: 'ready', value: {}, writable: true, revision: 1 }), subscribe: () => () => {}, mutate: async () => {} }
      },
      whileServed(namespaces, callback) {
        served.push(namespaces)
        return callback()
      },
    },
    slots: {
      inject(slot, callback) {
        return callback()
      },
      register(options, Component) {
        registrations.push({ options, Component })
        return () => {}
      },
    },
  }
  return { ctx, registrations, dictionaries, effects, served }
}

test('浏览器半按包名注册，且 id 与包名一致', () => {
  const { contribution } = loadClient()
  assert.equal(contribution.id, BUNDLE_NAME)
})

test('导出的设置命名空间与宿主半逐字相等', () => {
  const { exported } = loadClient()
  assert.equal(exported.SETTINGS_NS, SETTINGS_NAMESPACE)
  assert.equal(exported.SETTINGS_NS, ROW_ID)
})

test('声明了申请的服务，含凭据域名', () => {
  const { exported } = loadClient()
  assert.ok(Array.isArray(exported.inject))
  for (const service of ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']) {
    assert.ok(exported.inject.includes(service), `inject 缺少 ${service}`)
  }
})

test('apply 注册字典，把设置页挂到三个配置槽位，并加一个侧边栏入口', () => {
  const { exported } = loadClient()
  const { ctx, registrations, dictionaries, served } = makeClientCtx()
  exported.apply(ctx)

  assert.deepEqual(Object.keys(dictionaries), ['settings.api3d'])
  const dict = dictionaries['settings.api3d']
  assert.deepEqual(Object.keys(dict.zh).sort(), Object.keys(dict.en).sort(), '中英文案必须同键')
  assert.equal(dict.zh.panel, 'API3D')
  assert.equal(dict.en.panel, 'API3D')
  for (const key of ['wizardTitle', 'wizardKeyStep', 'wizardModelsStep', 'wizardImport', 'panelConfigure', 'wizardNoKey', 'wizardGetKey', 'wizardGetKeyTitle']) {
    assert.ok(key in dict.zh, `中文字典缺少 ${key}`)
    assert.ok(key in dict.en, `英文字典缺少 ${key}`)
  }

  const slots = registrations.map((item) => item.options.name)
  assert.deepEqual(slots, [
    'plugins.bundle.config',
    'plugins.row.config',
    'plugins.item',
    'plugins.detail.actions',
    'sidebar.panellist',
    'main',
    'shell.overlay',
  ])

  const bySlot = Object.fromEntries(registrations.map((item) => [item.options.name, item.options]))
  assert.equal(bySlot['plugins.bundle.config'].key, BUNDLE_NAME)
  assert.equal(bySlot['plugins.row.config'].key, `${BUNDLE_NAME}#${ROW_ID}`)
  assert.equal(bySlot['plugins.item'].id, exported.SETTINGS_NS)
  assert.equal(bySlot['plugins.item'].order, 30)

  // 「手动更新」按钮：注册进官方插件页声明的详情页页头槽位，排在页面自带的
  // 开关/「卸载」之前；它**不**依赖注入，也**不**骑 whileServed —— 宿主半没装载时
  // 用户也该看到按钮（点了会如实报错），所以 served 仍是 3 条。
  assert.equal(bySlot['plugins.detail.actions'].id, 'dsh-api3d#update')
  assert.equal(bySlot['plugins.detail.actions'].order, 20)
  assert.equal(bySlot['plugins.detail.actions'].locale, 'settings.api3d')
  assert.equal(typeof bySlot['plugins.detail.actions'].inject, 'undefined')
  assert.equal(bySlot['plugins.detail.actions'].name, 'plugins.detail.actions')

  // 三个配置槽位骑在 whileServed 上：宿主半没挂上时不该留下任何痕迹。
  assert.equal(served.length, 3)
  for (const namespaces of served) assert.deepEqual(namespaces, [SETTINGS_NAMESPACE])
})

test('侧边栏入口放在「插件」下面，并打开同一个 id 的主面板', () => {
  const { exported } = loadClient()
  const { ctx, registrations } = makeClientCtx()
  exported.apply(ctx)
  const bySlot = Object.fromEntries(registrations.map((item) => [item.options.name, item]))

  const entry = bySlot['sidebar.panellist'].options
  // plugin-manager 的「插件」是 order 0、日程是 10：取 1 才是紧挨着它的下一行。
  assert.equal(entry.order, 1)
  // 侧边栏那一行与 main 槽位的条目键必须是同一个面板 id，否则点了切到空白。
  assert.equal(bySlot['main'].options.key, entry.id)
  assert.equal(entry.id, 'api3d')
  assert.equal(entry.locale, 'settings.api3d')
  assert.equal(entry.label(), 'panel') // 假 locale 的 bind 回显键名
})

test('侧边栏图标按行大小渲染，主面板显示配置入口', () => {
  const { exported } = loadClient()
  const { ctx, registrations } = makeClientCtx()
  exported.apply(ctx)
  const bySlot = Object.fromEntries(registrations.map((item) => [item.options.name, item]))

  const icon = bySlot['sidebar.panellist'].Component({ size: 18, active: true })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 18)
  assert.equal(icon.props.height, 18)

  const page = bySlot['main'].Component({ t: (key) => `t:${key}`, relayForm: fakeForm() })
  assert.equal(page.type, 'section')
  assert.equal(page.props.className, 'dshA3d_panel')

  const head = page.children[0]
  assert.equal(head.props.className, 'dshA3d_panelHead')
  const title = head.children[0].children[0]
  assert.equal(title.type, 'h1')
  assert.equal(title.children[0], 't:panelTitle')

  // 还没导入模型 → 显示「配置」按钮与空态提示。
  const action = head.children[1]
  assert.equal(action.type, 'button')
  assert.equal(action.children[0], 't:panelConfigure')
  assert.equal(page.children[1].children[0], 't:panelNoModels')
})

test('表单控制器以原型方法提供时面板也能渲染（不能丢 this）', () => {
  // `ConfigFormController` 的 `getSnapshot` / `subscribe` 是原型方法，而 React 以
  // 裸函数调用 `useSyncExternalStore` 的两个参数。直接把 `form.getSnapshot` 递进去
  // 会丢 `this`，真机上的表现是 `Cannot read properties of undefined (reading 'store')`
  // —— 面板与向导整块渲染崩溃。这条测试用原型方法复现那条路径。
  const { exported } = loadClient()
  const { ctx, registrations } = makeClientCtx()
  exported.apply(ctx)
  const bySlot = Object.fromEntries(registrations.map((item) => [item.options.name, item]))

  const snapshot = {
    status: 'ready',
    value: { models: JSON.stringify([{ id: 'm1', displayName: 'M1' }]) },
    writable: true,
    revision: 1,
  }
  class BareForm {
    constructor() {
      this.store = { getSnapshot: () => snapshot, subscribe: () => () => {} }
    }
    getSnapshot() {
      return this.store.getSnapshot()
    }
    subscribe(listener) {
      return this.store.subscribe(listener)
    }
  }

  let page
  assert.doesNotThrow(() => {
    page = bySlot['main'].Component({ t: (key) => `t:${key}`, relayForm: new BareForm() })
  })
  // 导入过模型 → 按钮变成「重新选择模型」，并列出已导入的模型。
  const head = page.children[0]
  assert.equal(head.children[1].children[0], 't:panelReconfigure')
  assert.equal(page.children[1].props.className, 'dshA3d_panelModels')
  assert.ok(JSON.stringify(page.children[1]).includes('"M1"'), '已导入模型的显示名没有渲染出来')
})

test('向导挂在 shell.overlay 上，面板首次打开时自动弹出', () => {
  const { exported } = loadClient()
  const { ctx, registrations } = makeClientCtx()
  exported.apply(ctx)
  const bySlot = Object.fromEntries(registrations.map((item) => [item.options.name, item]))

  const options = bySlot['shell.overlay'].options
  assert.equal(options.id, `${BUNDLE_NAME}#wizard`)
  assert.equal(options.order, 40)
  assert.equal(options.locale, 'settings.api3d')

  // 面板里没有导入过模型 → 挂载时把向导叫出来（模块级状态），弹窗随后渲染成 Modal。
  bySlot['main'].Component({ t: (key) => `t:${key}`, relayForm: fakeForm() })
  const wizard = bySlot['shell.overlay'].Component({ ctx, t: (key) => `t:${key}` })
  assert.equal(wizard.type.displayName, 'Modal')
  assert.equal(wizard.props.open, true)
  assert.equal(wizard.props.title, 't:wizardTitle')

  const body = wizard.children[0]
  assert.equal(body.props.className, 'dshA3d_wizard')
  // 第一步是密钥：小标题、说明、地址输入行、密钥输入行、输入框下方的获取密钥提示。
  assert.equal(body.children[0].length, 5)
  assert.equal(body.children[0][0].children[0], 't:wizardKeyStep')
})

test('密钥输入框下方给出站点入口，点击在新标签打开 api3d.cn', () => {  const { exported } = loadClient()
  const { ctx, registrations } = makeClientCtx()
  exported.apply(ctx)
  const bySlot = Object.fromEntries(registrations.map((item) => [item.options.name, item]))
  // 面板里没有导入过模型 → 挂载时弹出向导，取其第一步内容。
  bySlot['main'].Component({ t: (key) => `t:${key}`, relayForm: fakeForm() })
  const wizard = bySlot['shell.overlay'].Component({ ctx, t: (key) => `t:${key}` })
  const keyStep = wizard.children[0].children[0]

  const help = keyStep[4]
  assert.equal(help.props.className, 'dshA3d_keyHelp')
  assert.equal(help.children[0].children[0], 't:wizardNoKey')

  const link = help.children[1]
  assert.equal(link.type, 'a')
  assert.equal(link.props.className, 'dshA3d_link')
  assert.equal(link.props.href, 'https://api3d.cn', '站点地址必须与站点身份一致')
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noopener noreferrer')
  assert.equal(link.props.title, 't:wizardGetKeyTitle')
  assert.equal(link.children[0], 't:wizardGetKey')
})

test('密钥输入框打码显示首尾，并挂一个历史密钥下拉', () => {
  const { exported } = loadClient()
  const { ctx, registrations } = makeClientCtx()
  exported.apply(ctx)
  const bySlot = Object.fromEntries(registrations.map((item) => [item.options.name, item]))
  bySlot['main'].Component({ t: (key) => `t:${key}`, relayForm: fakeForm() })
  const wizard = bySlot['shell.overlay'].Component({ ctx, t: (key) => `t:${key}` })
  const keyStep = wizard.children[0].children[0]

  const keyRow = keyStep[3]
  assert.equal(keyRow.props.className, 'dshA3d_row')
  const combo = keyRow.children[1]
  assert.equal(combo.type.displayName, 'Menu')
  // 弹窗主体是 overflow:hidden 的，就地渲染的下拉会被裁掉，必须挂到 body。
  assert.equal(combo.props.portal, true)
  assert.equal(combo.props.open, false)
  assert.equal(combo.props.listClassName, 'dshA3d_keyMenu')

  const field = combo.props.anchor
  const input = field.children[0]
  assert.equal(input.type, 'input')
  assert.equal(input.props.type, 'text', 'password 会把整串藏起来，这里要露出首尾')
  assert.equal(input.props.value, '')

  const toggle = field.children[1]
  assert.equal(toggle.type, 'button')
  assert.equal(toggle.props.disabled, true, '没有历史时下拉按钮应当不可用')
  assert.equal(toggle.props['aria-label'], 't:wizardKeyHistory')
  assert.equal(toggle.props.title, 't:wizardKeyHistoryEmpty')
})

test('打码只藏中间：长串留首尾，短串不裸露', () => {
  const { exported } = loadClient()
  assert.equal(exported.maskKey(''), '')
  assert.equal(exported.maskKey('   '), '')
  assert.equal(exported.maskKey('sk-123456'), 'sk…56')
  const long = 'api3d-e661234567890abcdef'
  assert.equal(exported.maskKey(long), 'api3d-…cdef')
  assert.ok(!exported.maskKey(long).includes('1234567890'), '中间那段不该出现在屏幕上')
})

test('密钥历史的解析与合并搬去了宿主半：浏览器只剩打码', () => {
  const { exported } = loadClient()
  // 凭据 Remote 读不回密钥值，所以「以前用过的密钥」只能由宿主从凭据库取出、
  // 只把打码标签发回来；浏览器半不再持有解析/合并逻辑（宿主侧另有测试）。
  assert.equal(exported.parseKeyHistory, undefined)
  assert.equal(exported.rememberKey, undefined)
  assert.equal(exported.keyHistoryRefOf, undefined)
  assert.equal(typeof exported.maskKey, 'function')
})

test('选中历史密钥也算「有密钥可用」：确认按钮不能被输入框判空锁死', () => {
  const { exported } = loadClient()
  assert.equal(exported.hasKeySource('', undefined), false, '既没输入也没选，应禁用')
  assert.equal(exported.hasKeySource('   ', undefined), false, '只有空白也算没填')
  assert.equal(exported.hasKeySource('sk-123', undefined), true, '手填的密钥可用')
  // 选中历史条目后输入框是空的（真实值只在宿主进程里）——曾经就是这里把按钮锁死。
  assert.equal(exported.hasKeySource('', { index: 0, label: 'api3d-…63cc' }), true, '选了历史条目就该能提交')
})

test('向导声明了三条宿主路由的字面量路径', () => {
  // 这三条路径必须与宿主半的 `MODELS_ROUTE` / `APPLY_ROUTE` / `KEYS_ROUTE` 逐字一致；
  // 浏览器半不能 import 宿主包，所以只能靠这条断言防漂移。
  assert.ok(source.includes('"/api/api3d.models"'), '缺少模型发现路由')
  assert.ok(source.includes('"/api/api3d.apply"'), '缺少导入应用路由')
  assert.ok(source.includes('"/api/api3d.keys"'), '缺少密钥清单路由')
  assert.ok(source.includes('function Api3dWizard('), '缺少向导弹窗组件')
})

test('每个配置槽位的注册项都带上表单控制器与上下文注入', () => {
  const { exported } = loadClient()
  const { ctx, registrations } = makeClientCtx()
  exported.apply(ctx)
  const configSlots = registrations.filter((item) =>
    ['plugins.bundle.config', 'plugins.row.config', 'plugins.item'].includes(item.options.name),
  )
  assert.equal(configSlots.length, 3)
  for (const { options } of configSlots) {
    assert.equal(options.locale, 'settings.api3d')
    assert.equal(typeof options.inject, 'function')
    const injected = options.inject()
    assert.ok(injected.relayForm, '表单控制器没被注入')
    assert.equal(injected.ctx, ctx)
  }

  // 「手动更新」条目挂在 `plugins.detail.actions`（详情页页头的动作区）：它是动作而不是
  // 表单，所以不注入表单控制器；但同样绑定本插件的字典命名空间。
  const updateSlot = registrations.find((item) => item.options.name === 'plugins.detail.actions').options
  assert.equal(updateSlot.locale, 'settings.api3d')
  assert.equal(updateSlot.id, 'dsh-api3d#update')
  assert.equal(typeof updateSlot.inject, 'undefined')

  const mainInjected = registrations.find((item) => item.options.name === 'main').options.inject()
  assert.equal(typeof mainInjected.t, 'function')
  assert.ok(mainInjected.relayForm, '主面板没拿到表单控制器')

  const overlayInjected = registrations.find((item) => item.options.name === 'shell.overlay').options.inject()
  assert.equal(overlayInjected.ctx, ctx)
  assert.equal(typeof overlayInjected.t, 'function')
})

test('设置命名空间在源码里是字面量而非推导值', () => {
  // 这条断言防的是「有人把字面量换成 import」——浏览器包不能 import 宿主包，
  // 真那么改了会让打包在宿主侧解析失败，而测试是唯一会在装载前发现的地方。
  assert.match(source, /const SETTINGS_NS = "api3d"/)
  assert.doesNotMatch(source, /from ['"]\.\//, '浏览器半不得依赖相对路径的宿主代码')
})
