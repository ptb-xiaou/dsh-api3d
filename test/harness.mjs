/**
 * 测试用的小工具：假上下文、假原生 fetch，以及一个能在不启动宿主的情况下
 * 装/拆围栏的夹具。
 *
 * @module dsh-api3d/test/harness
 */
import { Config, apply } from '../lib/index.js'

/** cosmokit 写 volatile 引用单元用的全局 symbol（`Symbol.for` 跨副本相等）。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * 就地改写一个 volatile 配置字段，模拟一次设置写入。
 *
 * 真实宿主也是这么做的：不重载 fiber，只改引用单元里的当前快照。
 *
 * @param {object} config - 已解析的设置段。
 * @param {string} field - 字段名。
 * @param {unknown} value - 新值。
 */
export function setField(config, field, value) {
  const unit = config[field]
  if (typeof unit?.[VOLATILE_WRITE] !== 'function') throw new Error(`${field} 不是 volatile 字段`)
  unit[VOLATILE_WRITE](value)
}

/**
 * 读取一个 volatile 配置字段的当前值。
 *
 * @param {object} config - 已解析的设置段。
 * @param {string} field - 字段名。
 * @returns {unknown} 当前快照值。
 */
export function getField(config, field) {
  const unit = config[field]
  return typeof unit?.get === 'function' ? unit.get() : unit
}

/**
 * 一个够用的假 Cordis 上下文：`effect` 立即执行回调并记下它的清理函数。
 *
 * @returns {{ctx: object, dispose: () => void, labels: string[]}} 夹具。
 */
export function makeCtx() {
  const disposers = []
  const labels = []
  const ctx = {
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    effect(callback, label) {
      const dispose = callback()
      const wrapped = () => {
        dispose?.()
      }
      disposers.push(wrapped)
      if (label !== undefined) labels.push(label)
      return wrapped
    },
    on() {
      return () => {}
    },
    get() {
      return undefined
    },
  }
  return {
    ctx,
    labels,
    dispose() {
      while (disposers.length > 0) disposers.pop()()
    },
  }
}

/**
 * 一个只记录调用的原生 `fetch`。
 *
 * 记录里同时给出 `url`、`init` 与 `method`：围栏在两种入参形状下委派方式不同 ——
 * 字符串/URL 会走到「URL + init」，裸 `Request` 会走到「重建后的 Request」，只看
 * `init.method` 会漏掉后者。
 *
 * @param {Array<{url: string, init: object, method: string}>} calls - 调用记录数组。
 * @param {() => Response | Promise<Response>} [respond] - 造响应；默认 200 JSON。
 * @returns {typeof fetch} 假 fetch。
 */
export function recordingFetch(calls, respond) {
  return async function native(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const fromInit = init?.method
    const fromRequest = typeof input === 'object' && input !== null && typeof input.method === 'string' ? input.method : undefined
    const initBody = init?.body
    const requestBody = typeof input === 'object' && input !== null ? input.body : undefined
    calls.push({
      url,
      init: init ?? {},
      method: fromInit ?? fromRequest ?? 'GET',
      hasBody: (initBody ?? null) !== null || (requestBody ?? null) !== null,
    })
    return respond === undefined ? new Response('{"ok":true}', { status: 200 }) : respond()
  }
}

/**
 * 装上围栏跑一段测试，结束后还原全局 `fetch`。
 *
 * `claimRoute` 与 `announce` 默认关掉：围栏测试不关心路由声明，也不该往测试输出里
 * 打印东西。`directMode` 默认 `never`，因为这些测试断言的是「原生 fetch 收到了
 * 什么」，一台真的设了代理变量的机器会把请求改道到直连传输，断言随之失真空转。
 * 直连传输自己由 `direct-transport.test.mjs` 单独覆盖。
 *
 * @param {object} overrides - 覆盖默认设置。
 * @param {(kit: object) => Promise<void> | void} body - 测试体。
 * @returns {Promise<unknown>} 测试体的返回值。
 */
export async function withFence(overrides, body) {
  return withFenceResponses(overrides, undefined, body)
}

/**
 * 同 {@link withFence}，但可以让每个请求返回不同的响应。
 *
 * 静默重试只有在「第一次拒绝、第二次成功」这类脚本化响应下才测得出行为。
 *
 * @param {object} overrides - 覆盖默认设置。
 * @param {(() => Response | Promise<Response>) | undefined} responder - 每次调用取响应。
 * @param {(kit: object) => Promise<void> | void} body - 测试体。
 * @returns {Promise<unknown>} 测试体的返回值。
 */
export async function withFenceResponses(overrides, responder, body) {
  const { ctx, dispose, labels } = makeCtx()
  const calls = []
  const native = recordingFetch(calls, responder)
  const before = globalThis.fetch
  globalThis.fetch = native
  const config = Config({ claimRoute: false, announce: false, directMode: 'never', ...overrides })
  try {
    apply(ctx, config)
    return await body({ calls, config, ctx, labels, native })
  } finally {
    dispose()
    globalThis.fetch = before
  }
}

/**
 * 按脚本依次返回响应，用完之后一直重复最后一个。
 *
 * 每个 `Response` 条目都会被 `clone()` 一次再交出去：真实的 `fetch` 每次返回的是
 * 全新响应，而 `Response` 的 body 是一次性的 —— 直接复用同一个对象会让第二次调用
 * 撞上「Body has already been read」，那是夹具的错，不是被测代码的错。
 *
 * @param {Array<Response | (() => Response)>} sequence - 响应序列；函数条目每次调用。
 * @returns {() => Response} 取下一个响应的函数。
 */
export function scripted(sequence) {
  let index = 0
  return () => {
    const item = sequence[Math.min(index, sequence.length - 1)]
    index += 1
    if (typeof item === 'function') return item()
    return typeof item?.clone === 'function' ? item.clone() : item
  }
}

/**
 * 一个「中转站把通道方言拒绝当成请求无效」的 400 响应。
 *
 * @returns {Response} 该响应。
 */
export function relayTransient400() {
  return new Response(JSON.stringify({ error: { message: 'reasoning_content must be passed back to the API' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
}

/** 读取界面文案表用的假 React 与假 UI 基元。 */
export function fakePrimitives() {
  const stub = (name) => {
    const Component = (props) => ({ type: name, props })
    Component.displayName = name
    return Component
  }
  return {
    SettingsForm: stub('SettingsForm'),
    SegmentedControl: stub('SegmentedControl'),
    Switch: stub('Switch'),
  }
}
