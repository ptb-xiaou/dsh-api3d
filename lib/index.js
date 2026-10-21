import z from '@deepseek-ai/schemastery'
import { directFetch, proxyEnvPresent } from './direct-fetch.js'
import { PI_AI_ENTRY, PROVIDER, ROUTE } from './route.js'
import { DEFAULT_API_KEY_ENV, ROW_ID, SENTINEL, SENTINEL_PATH, SITE_DEFAULT_BASE_URL } from './site.js'

/**
 * dsh-api3d —— 单站中转接入包的宿主半。
 *
 * 组合包的 `cordis.patch.yml` 在 pi-ai 适配器（`llm-pi-ai`）上声明**一条**中转站
 * 路由：协议、模型目录、思考档位全在那里，是配置不是代码。
 *
 * 本插件只负责配置表达不了的那几件事，它们都是对同一个出站请求的改写：
 *
 * 1. **地址。** 路由的 `baseURL` 指向哨兵主机（`upstream.api3d.invalid`），因为
 *    适配器读不到本插件的设置命名空间。围栏在出站时把它改写为设置页里填的基础
 *    地址。这样「换地址」是设置页里的一次写入，下一个请求就生效，不需要改文件、
 *    重装或重启。
 *
 * 2. **User-Agent（可选）。** 有些中转站按 User-Agent 区分客户端，而 `llm-pi-ai`
 *    会剥掉与它强制归属头冲突的 profile header，再补上
 *    `user-agent: deepseek-harness/<version>`。归属头按设计是强制的（白标部署可以
 *    替换，不能抑制），所以替换只能发生在适配器**之下** —— 在 provider SDK 构建
 *    client 时从全局作用域取到的那个 `fetch` 上。默认留空即保留归属头。
 *
 * 3. **传输。** 有些中转站的 WAF 会对数据中心出口 IP（正是 `HTTPS_PROXY` 一跳
 *    产生的）返回 200 HTML 挑战页而不是 SSE 流，provider SDK 只会把它呈现为不透明
 *    的传输失败。dsh 在插件加载前就按启动环境装好了代理 dispatcher，所以围栏必须
 *    自己拥有这些请求的 transport（见 `lib/direct-fetch.js`）。
 *
 * 4. **工具 schema。** 部分上游把「对象节点没有 required 数组」判为非法
 *    （`null is not of type "array"`）。围栏给出站工具 schema 的对象节点补
 *    `required: []` —— 与省略语义等价，对本来就接受的端点是无操作。
 *
 * 5. **路由的存活。** profile 自己的补丁层在每个 bundle 层之后应用，而 loader 把
 *    补丁的 `config` 赋值在组合结果之上而非合并（只有一层深），所以任何自带
 *    provider 的 profile 都会把这条路由整个字典替换掉。围栏通过宿主条目自己的
 *    volatile config 把它重新装回去。
 *
 * 围栏刻意做得很窄：只在归属主机匹配时改一个 header，只在哨兵主机上改写一个
 * URL，其余请求原样转交给上一个 `fetch`。它通过 `ctx.effect()` 安装，停用或重载
 * 插件时会还原它替换掉的那个 `fetch`。
 *
 * @module dsh-api3d
 */

/** 稳定的 Cordis 插件名。必须等于补丁层的行 id。 */
const name = ROW_ID

/**
 * 本插件拥有的设置命名空间。
 *
 * 它同时是浏览器半注册设置卡用的键，两半在这里相遇而不需要互相 import。
 */
const SETTINGS_NAMESPACE = ROW_ID

const Config = z.object({
  /**
   * 中转站基础地址。本插件设置卡存在的全部理由：一次填写，作用于这条路由上的
   * 每一个模型。
   *
   * 留空则不改写，请求会打到哨兵主机并以 DNS 失败告终 —— 这是刻意的：静默打到
   * 某台真实服务器比大声失败糟糕得多。
   */
  baseURL: z
    .string()
    .default(SITE_DEFAULT_BASE_URL)
    .description('站点基础地址，默认 https://api3d.cn/v1')
    .volatile(),
  /**
   * 凭据引用名（环境变量文法），**不是密钥本身**。密钥由设置页的 API Key 输入框
   * 写入 ~/.dsh/.credentials.yaml，或由同名环境变量提供；路由的 `apiKeyEnv` 与它
   * 保持一致。
   */
  apiKeyEnv: z
    .string()
    .default(DEFAULT_API_KEY_ENV)
    .description('凭据引用名（密钥存放位置的键名，不是密钥）')
    .volatile(),
  /**
   * 发往中转站的 User-Agent。留空即保留 harness 的归属头，这是默认也应该是常态；
   * 只有中转站明确要求某个值时才填。
   */
  userAgent: z
    .string()
    .default('')
    .description('替换发往中转站的 User-Agent；留空保留 harness 归属头')
    .volatile(),
  /**
   * 直连策略。
   *
   * `auto`：只有进程真的设了代理变量时才走直连 —— 直连传输存在的唯一目的就是
   * 逃开代理 dispatcher，没装代理时它没有意义。`always`：无条件直连。`never`：
   * 从不直连，走全局 fetch（即跟随进程代理）。
   */
  directMode: z
    .union([z.const('auto'), z.const('always'), z.const('never')])
    .default('auto')
    .description('直连策略：auto 按代理变量、always 总是、never 从不')
    .volatile(),
  /** 是否给出站工具 schema 补 `required: []`。 */
  patchToolSchema: z
    .boolean()
    .default(true)
    .description('给出站工具 schema 的对象节点补 required: []，兼容严格上游')
    .volatile(),
  /**
   * 中转站把请求转发给多个上游通道，个别通道会以「请求无效」为由拒绝本可重试的
   * 请求；同一个请求成功还是失败取决于哪个通道接了它。开启后这类失败在插件内部
   * 重发，会话完全看不到；关闭则原样报错。
   *
   * 默认关闭：静默掩盖一个真正的 400 会把一个可见错误换成一个令人困惑的空回合。
   */
  silentRetry: z
    .boolean()
    .default(false)
    .description('中转站以上游瞬时错误拒绝时在插件内部重发，不暴露给会话')
    .volatile(),
  /** 开启静默重试时，单次请求最多发送几次（含首次）。 */
  silentRetryAttempts: z
    .number()
    .step(1)
    .min(1)
    .max(10)
    .default(3)
    .description('静默重试时单次请求的最大发送次数')
    .volatile(),
  /**
   * 附加到 402 额度耗尽错误后面的说明。有些中转站用 HTTP 402 + 一个被错误标成
   * `text/event-stream` 的 JSON 错误体来回答额度耗尽，provider SDK 只会把它呈现
   * 为不透明的传输失败；围栏保留原始消息并追加这段文字。留空即关闭。
   */
  quotaHint: z
    .string()
    .default('')
    .description('附加到中转站 402 额度耗尽错误后的说明文字')
    .volatile(),
  /**
   * 从站点 `/v1/models` 导入的模型目录，存成 JSON 字符串（形如
   * `[{"id":"deepseek-v4.1-flash","displayName":"DeepSeek V4.1 Flash"}]`）。
   *
   * 空串表示用补丁层里手写的那份内置清单。非空时它整个替换内置清单 —— 站点报出
   * 什么，模型选择器里就是什么，不再依赖人肉核对。
   *
   * 它是 volatile 字段：导入后写这一格不重载本 fiber，宿主条目经
   * `loader/volatile-update` 重新注册路由，模型选择器下一个渲染周期就能看到。
   */
  models: z
    .string()
    .default('')
    .description('从站点导入的模型目录（JSON 数组）；留空使用补丁层内置清单')
    .volatile(),
  /**
   * profile 补丁层把本包的路由挤掉时，通过宿主条目的 volatile config 重新声明它。
   *
   * 默认开启，因为替代方案是「在最可能需要它的 profile 里静默失效」。关闭是留给
   * 那种「我自己管这条路由，宁可看见冲突也不要被人在底下解决」的部署。
   *
   * 在激活时读一次而不是逐请求读，所以它是普通字段（非 volatile）：改它会让
   * profile 补丁重载这个 fiber 并重跑 `apply`，而那是它唯一能起作用的时刻。
   */
  claimRoute: z
    .boolean()
    .default(true)
    .description('profile 补丁层替换掉路由时自动重新声明它'),
  /** 激活时在终端打印一次围栏状态。 */
  announce: z.boolean().default(true).description('激活时打印一次围栏状态'),
})

/**
 * 把一个 `fetch` 入参解析成 URL，且不消费请求体。
 *
 * @param {unknown} input - `fetch` 的第一个参数。
 * @returns {URL | undefined} 解析出的 URL；不是 URL 时返回 undefined。
 */
function urlOf(input) {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return input
    if (typeof input === 'object' && input !== null && typeof input.url === 'string') return new URL(input.url)
  } catch {
    return undefined
  }
  return undefined
}

/**
 * 解开一个 volatile 字段引用。
 *
 * 0.1.7 起 `.volatile()` 字段是以稳定的引用单元交出来的（`@deepseek-ai/cosmokit`
 * 的 `createVolatile`）：`{ get() }` 加一个只有持有者能写的
 * `Symbol.for('cosmokit.volatile.write')`。一次设置写入是**就地改这个单元**，而
 * 不是重载 fiber，所以每次读取都必须经过 `get()` 才能看到当前值。普通值原样穿过。
 *
 * 判据用 `Symbol.for(...)` 而不是 `instanceof` 或 `Object.isFrozen`：全局注册表
 * 的 symbol 在跨 ESM/CJS 副本时仍然相等，而那个正是 cosmokit 的 `isVolatile`
 * 自己用的判据（它不导出成公共 API，这里就地复刻以免多一个 peer 依赖）。
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function resolveVolatile(value) {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value && typeof value.get === 'function'
    ? value.get()
    : value
}

/**
 * 当前设置里的中转站地址，逐请求解析，所以保存后下一个请求就生效。
 *
 * @param {ReturnType<typeof Config>} config - 已解析的设置段。
 * @returns {URL | undefined} 合法且为 HTTP(S) 的地址；未填或不合法时 undefined。
 */
function targetOf(config) {
  const raw = String(resolveVolatile(config.baseURL) ?? '').trim()
  if (raw.length === 0) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url
  } catch {
    return undefined
  }
}

/**
 * 这个请求是不是发给本路由的。
 *
 * 两种情况：地址是哨兵主机（要走改写），或者地址**已经是**设置里的真实主机
 * （说明有部署把真实地址直接写进了路由，此时不改写但归属头与直连策略仍要生效）。
 *
 * @param {URL} url - 请求地址。
 * @param {URL | undefined} target - 设置里的真实地址。
 * @returns {boolean} 围栏是否应当接管这个请求。
 */
function isRelayRequest(url, target) {
  const host = url.host.toLowerCase()
  if (host === SENTINEL.toLowerCase()) return true
  return target !== undefined && host === target.host.toLowerCase()
}

/**
 * 把哨兵地址改写为设置里的真实地址。
 *
 * 不只换 host：中转站的基础路径各不相同（`/v1`、`/api/v1`、根路径都有），所以
 * 把路由 baseURL 的路径前缀换成真实地址的路径前缀，再把剩下的部分原样接上。
 * 协议与端口也一并取自真实地址，这样 http 站点与非标准端口都能工作。
 *
 * @param {URL} url - 原始请求地址。
 * @param {URL} target - 设置里的真实地址。
 * @returns {URL} 改写后的地址副本。
 */
function rewriteToTarget(url, target) {
  // 基础地址只写到域名时（pathname 为 '/'，去掉尾斜杠后为空），把路由里声明的
  // /v1 前缀保留下来。OpenAI 兼容中转站几乎都挂在 /v1 下，丢掉它会让「只填域名」
  // 变成一个安静的 404；要打到别的路径就把完整前缀写进基础地址。
  const declared = target.pathname.replace(/\/+$/, '')
  const base = declared.length === 0 ? SENTINEL_PATH : declared
  const suffix = url.pathname.startsWith(SENTINEL_PATH) ? url.pathname.slice(SENTINEL_PATH.length) : url.pathname
  const next = new URL(url)
  next.protocol = target.protocol
  next.host = target.host
  next.pathname = base + suffix
  return next
}

/**
 * 给每个对象 schema 节点补上显式的 `required` 数组，就地修改。
 *
 * 部分上游严格按字面取 `required`：缺失会被它们的元 schema 当成非法的 `null`。
 * 空数组与省略 `required` 语义等价，所以这个填充不可能改变一个合规端点接受什么。
 * 每个对象值都会被走到 —— `properties`、`items`、`oneOf` 分支都包括。
 *
 * @param {unknown} node - 一个 JSON Schema 节点，或从它可达的任意 JSON 值。
 * @returns {boolean} 是否有任何节点补上了 `required` 数组。
 */
function ensureRequiredArray(node) {
  if (Array.isArray(node)) {
    let changed = false
    for (const item of node) if (ensureRequiredArray(item)) changed = true
    return changed
  }
  if (typeof node !== 'object' || node === null) return false
  let changed = false
  if ((node.type === 'object' || node.properties !== undefined) && !Array.isArray(node.required)) {
    node.required = []
    changed = true
  }
  for (const value of Object.values(node)) if (ensureRequiredArray(value)) changed = true
  return changed
}

/**
 * 按需修补一个出站中转站请求体里的 `tools`。
 *
 * @param {string} text - provider SDK 序列化后的请求体。
 * @returns {string | undefined} 有工具 schema 被改动时返回重新序列化的请求体；
 *   应当原样透传时返回 undefined（无法解析、没有 tools、没有可填的，或该工具是
 *   `strict: true` —— 它的 `required` 必须列出每个属性，留给作者自己写）。
 */
function relayToolSchemaPatch(text) {
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return undefined
  let changed = false
  for (const tool of body.tools) {
    const fn = tool?.function
    if (typeof fn !== 'object' || fn === null || fn.strict === true) continue
    if (typeof fn.parameters !== 'object' || fn.parameters === null) continue
    if (ensureRequiredArray(fn.parameters)) changed = true
  }
  return changed ? JSON.stringify(body) : undefined
}

/**
 * 一个 `Request` 里必须活过「改地址」的那些字段。
 *
 * `new Request(url, request)` 不可用 —— 第二个参数必须是 init —— 所以显式复制
 * 中转站调用依赖的部分。body 按引用传递，从不被读取。
 *
 * @param {Request} request - 正在被改地址的请求。
 * @returns {RequestInit} 携带 method、body 与传输标志的 init。
 */
function requestInitOf(request) {
  return {
    method: request.method,
    ...(request.body === null || request.method === 'GET' || request.method === 'HEAD' ? {} : { body: request.body }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    credentials: request.credentials,
    redirect: request.redirect,
    referrer: request.referrer,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
  }
}

/**
 * 两个 transport 都接受的一种 init 形状：调用方传了裸 `Request` 时用它的各个部分，
 * 否则用调用方的 init，改写过的 header 放在最后。
 *
 * @param {unknown} input - `fetch` 的第一个参数。
 * @param {RequestInit | undefined} init - `fetch` 的第二个参数。
 * @param {boolean} isRequest - `input` 是否是 `Request`。
 * @param {Headers} headers - 改写后的 header 集合。
 * @returns {RequestInit} 交给选定 transport 的 init。
 */
function unifiedInit(input, init, isRequest, headers) {
  if (isRequest) return { ...requestInitOf(input), ...init, headers }
  return { ...init, headers }
}

/**
 * 那些「看起来是终局、其实换个通道就好」的中转站失败。
 *
 * 中转站把一个模型 id 轮询到多个上游通道，它们对「重放思维链该怎么编码」的看法
 * 不一致，所以同一个请求能不能被接受取决于抽到哪个通道。`INVALID_REQUEST` 不在
 * harness 默认可重试集合里，没有这一层，一个 400 就结束整个回合。
 */
const TRANSIENT_RELAY_STATUS = new Set([500, 502, 503, 504])
const TRANSIENT_RELAY_BODY =
  /must be passed back to the API|upstream rejected the request as invalid|null is not of type "array"/i

/**
 * 判断一次中转站响应是否值得重发，需要读 body 时顺便重建响应。
 *
 * 5xx 本身就是瞬时的，不必读 body，原样返回。400 是模糊的 —— 中转站既用它报
 * 「通道方言拒绝」也用它报真正写错的请求 —— 只有 body 命中
 * {@link TRANSIENT_RELAY_BODY} 才算。读 body 会消费流，所以两种情况都重建响应，
 * 给调用方留下可以报错的东西。
 *
 * 完全读不出 body（流被截断或重置）**不算**瞬时拒绝：那是一个本侧从未看见的
 * body，重发帮不上忙，而吞掉状态码会把一个可诊断的 400 变成不透明的传输错误。
 *
 * @param {Response} response - 某一次尝试的响应。
 * @returns {Promise<{retry: boolean, response: Response}>} 判定结果，附带一个
 *   调用方仍可读取的响应。
 */
async function transientRelayRejection(response) {
  if (TRANSIENT_RELAY_STATUS.has(response.status)) return { retry: true, response }
  if (response.status !== 400) return { retry: false, response }
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  if (!type.includes('json') && !type.includes('event-stream')) return { retry: false, response }
  let text
  try {
    text = await response.text()
  } catch {
    return { retry: false, response }
  }
  const rebuilt = new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  })
  return { retry: TRANSIENT_RELAY_BODY.test(text), response: rebuilt }
}

/**
 * 两次尝试之间等待，调用方先中止时解析为 false。
 *
 * @param {number} attempt - 1 表示第一次尝试之后的等待。
 * @param {AbortSignal | undefined} signal - 请求自己的 signal。
 * @returns {Promise<boolean>} 下一次尝试是否可以继续。
 */
function delayBeforeRetry(attempt, signal) {
  const ms = 200 * attempt
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 在中转站持续以瞬时错误拒绝时重发同一个请求，让 harness 只看到最终结果。
 *
 * 每次尝试都重新调用 `dispatch`，它按调用方给的部分重建请求 —— 完全相同的字节，
 * 这正是重点：失败属于抽到请求的那个通道，不属于请求本身。最后一次尝试的响应
 * 无论是什么都会被返回，所以持续故障的路由仍然报错而不是挂住。
 *
 * @param {Promise<Response>} first - 已经开始的第一次尝试。
 * @param {() => Promise<Response>} dispatch - 执行一次尝试。
 * @param {number} attempts - 允许的总发送次数（含首次）。
 * @param {AbortSignal | undefined} signal - 请求自己的 signal。
 * @param {((attempt: number) => void) | undefined} onRetry - 每次重发前通知。
 * @returns {Promise<Response>} 第一个非瞬时响应，或最后一个响应。
 */
async function retryTransient(first, dispatch, attempts, signal, onRetry) {
  const total = Math.max(1, Math.trunc(attempts))
  let pending = first
  for (let attempt = 1; attempt < total; attempt++) {
    const response = await pending
    if (signal?.aborted) return response
    const verdict = await transientRelayRejection(response)
    if (!verdict.retry) return verdict.response
    if (!(await delayBeforeRetry(attempt, signal))) return verdict.response
    onRetry?.(attempt + 1)
    pending = dispatch()
  }
  return pending
}

/**
 * 一份「本包路由已存在」的 `llm-pi-ai` 配置。
 *
 * profile 的补丁层在每个 bundle 层之后应用，它的 `config` 是赋值而非合并（一层
 * 深），所以一个声明了任何 `llm-pi-ai.providers` 的 profile 会替换掉整个字典，
 * 本包的路由随之消失。这里把它放回去。
 *
 * 合并刻意是增量的：profile 自己的路由原样保留，而 profile **自己**声明了同名
 * 路由时原样放行，这样「我就是要自己管这条路由」的部署仍然说了算。
 *
 * @param {unknown} config - 一份组合后的 `llm-pi-ai` 配置，尚未解析。
 * @param {unknown} [route] - 要声明的路由值，默认是补丁层内置的那份。
 * @returns {unknown} 同一份配置；路由缺失时并入本包的路由。
 */
function withRelayRoute(config, route = ROUTE) {
  if (relayRouteState(config) !== 'missing') return config
  const providers = typeof config.providers === 'object' && config.providers !== null ? config.providers : {}
  return { ...config, providers: { ...providers, [PROVIDER]: structuredClone(route) } }
}

/**
 * 判断一份已组合的 `llm-pi-ai` 配置是否已经带着本包的路由。
 *
 * 检查刻意很窄：读 loader 条目自己的 `config`（适配器就是从它解析 profile 的），
 * 而不是本插件对路由的私有视图。
 *
 * `providers` 缺失算「缺失」而不是「不可用」：适配器的 schema 会把它默认为 `{}`，
 * 所以一个把整个 `llm-pi-ai` 配置替换掉却没写 `providers` 的 profile 是一条路由
 * 都不服务 —— 包括本包的 —— 而这时既没有东西可并入，也没有东西需要保护。存在
 * 但类型不对才是真正属于 profile 的事：覆盖它会丢掉它想表达的东西。
 *
 * @param {unknown} config - 条目的组合配置。
 * @returns {'declared' | 'missing' | 'unusable'} 判定结果。
 */
function relayRouteState(config) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return 'unusable'
  const providers = config.providers
  if (providers === undefined) return 'missing'
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return 'unusable'
  return providers[PROVIDER] === undefined ? 'missing' : 'declared'
}

//#region imported models

/** 导入的模型目录存在设置里的字段名。 */
const MODELS_FIELD = 'models'

/** 宿主侧「查询站点可用模型」的精确 Fetch 路由（在 connection 的鉴权围栏内）。 */
const MODELS_ROUTE = '/api/api3d.models'

/** 宿主侧「把选中的模型装回路由」的精确 Fetch 路由。 */
const APPLY_ROUTE = '/api/api3d.apply'

/** 查询站点模型目录的超时（毫秒）。 */
const MODEL_DISCOVERY_TIMEOUT_MS = 20_000

/**
 * 新模型描述符的模板：取内置清单的第一条，再按每条模型自己报出（或用户在向导里
 * 改过）的能力覆盖 `id`、`name`、`input`、`contextWindow`、`maxTokens`、
 * `reasoningEfforts`。
 *
 * 站点通常一个能力字段都不报 —— api3d.cn 的 `/v1/models` 只有 `id` 与
 * `display_name` —— 所以模板是「这条没被覆盖」时的兜底。照抄内置清单比在这里
 * 重新写一遍常量更不容易漂移。
 */
const MODEL_TEMPLATE = ROUTE.models.length > 0 ? structuredClone(ROUTE.models[0]) : undefined

/** 宿主只认 pi-ai 会用的这两个输入模态；站点的其它叫法一律丢弃。 */
const INPUT_MODALITIES = ['text', 'image']

/**
 * pi-ai 的思考档位词汇表。`off` 之外每档都必须给出线上拼写才能声明，所以这里
 * 也是向导里档位多选的顺序与全集。
 */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** 站点条目里可能出现上下文窗口的字段名；点号表示嵌套（`limit.context`）。 */
const CONTEXT_WINDOW_FIELDS = [
  'contextWindow',
  'context_window',
  'context_length',
  'max_input_tokens',
  'limit.context',
]

/** 站点条目里可能出现最大输出的字段名。 */
const MAX_TOKENS_FIELDS = [
  'maxOutputTokens',
  'max_output_tokens',
  'maxTokens',
  'max_tokens',
  'limit.output',
  'top_provider.max_completion_tokens',
]

/**
 * 按候选字段名从站点条目里取一个正整数，取不到返回 undefined。
 *
 * 候选表与宿主自己解析 `/models` 时用的那套一致，这样向导里看到的能力不会与宿主
 * 原生发现路径给出不同答案。字符串数字（`"1000000"`）也认。
 *
 * @param {unknown} row - 站点条目。
 * @param {string[]} fields - 候选字段名。
 * @returns {number | undefined} 取到的正整数。
 */
function pickPositiveInteger(row, fields) {
  for (const field of fields) {
    let cursor = row
    for (const segment of field.split('.')) {
      cursor = cursor !== null && typeof cursor === 'object' ? cursor[segment] : undefined
    }
    const value = typeof cursor === 'string' && cursor.trim() !== '' ? Number(cursor) : cursor
    if (Number.isInteger(value) && value > 0) return value
  }
  return undefined
}

/**
 * 把站点声明的输入模态归一成 pi-ai 认识的子集。
 *
 * 接受字符串数组、`{ input: [...] }` 形状、以及逗号/空格分隔的字符串。一个都没
 * 认出来、或声明的就是空数组时返回 undefined —— 「站点没说」与「不支持文本」是
 * 两件事，前者应该让模板兜底。
 *
 * @param {unknown} row - 站点条目。
 * @returns {string[] | undefined} 归一后的模态列表。
 */
function normalizeInput(row) {
  const declared = [
    row?.input,
    row?.inputModalities,
    row?.input_modalities,
    row?.modalities,
  ].find((candidate) => Array.isArray(candidate) || typeof candidate === 'string')
  const rows = Array.isArray(declared)
    ? declared
    : typeof declared === 'string'
      ? declared.split(/[\s,]+/)
      : []
  const kept = INPUT_MODALITIES.filter((modality) =>
    rows.some((entry) => typeof entry === 'string' && entry.trim().toLowerCase() === modality),
  )
  return kept.length > 0 ? kept : undefined
}

/**
 * 把站点声明的思考档位归一成 pi-ai 的 `reasoningEfforts`。
 *
 * 接受字符串数组（线上拼写就用档位名，与内置清单的映射一致；`off` 映射成 `null`）
 * 或 `{ 档位: 线上拼写 }` 映射。只报了 `off`、或没有任何一档有可用拼写时返回
 * `false`，含义是「这是个非推理模型」—— pi-ai 明确要求这种情况不要造出「提供了
 * Off 之外档位」的假象。
 *
 * @param {unknown} value - 站点条目里的档位声明。
 * @returns {Record<string, string | null> | false | undefined} 归一结果。
 */
function normalizeReasoningEfforts(value) {
  if (value === false) return false
  if (value === null || typeof value !== 'object') return undefined
  const declared = new Map()
  if (Array.isArray(value)) {
    for (const level of value) {
      if (typeof level !== 'string') continue
      const name = level.trim().toLowerCase()
      declared.set(name, name === 'off' ? null : name)
    }
  } else {
    for (const [level, wire] of Object.entries(value)) declared.set(level.trim().toLowerCase(), wire)
  }
  if (declared.size === 0) return undefined
  const efforts = {}
  for (const level of THINKING_LEVELS) {
    if (!declared.has(level)) continue
    const wire = declared.get(level)
    if (level === 'off') {
      efforts.off = typeof wire === 'string' && wire.trim() !== '' ? wire.trim() : null
      continue
    }
    if (typeof wire !== 'string' || wire.trim() === '') continue
    efforts[level] = wire.trim()
  }
  return THINKING_LEVELS.some((level) => level !== 'off' && level in efforts) ? efforts : false
}

/**
 * 把站点 `/v1/models` 的响应体归一成模型目录。
 *
 * 兼容三种形状：OpenAI 的 `{ data: [{ id, display_name? }] }`、Anthropic 风格的
 * `{ models: [...] }`、以及纯字符串数组或 `{ data: ["id"] }`。认不出 id 的条目被
 * 丢弃；重复 id 只留第一条；`displayName` 缺省时回落成 id。
 *
 * 每条还会尽量带上站点自己报出的能力（`input`、`contextWindow`、`maxTokens`、
 * `reasoningEfforts`）。**只在站点真的报了的时候才带上** —— 缺字段的含义是「站点
 * 没说」，由模板兜底，而不是「这里填了个默认值」。这份目录同时也是设置里
 * `models` 字段的存储形状，所以向导写回的对象走的也是这条归一化路径。
 *
 * @param {unknown} payload - 站点响应体。
 * @returns {{
 *   id: string,
 *   displayName: string,
 *   input?: string[],
 *   contextWindow?: number,
 *   maxTokens?: number,
 *   reasoningEfforts?: Record<string, string | null> | false,
 * }[]} 归一后的模型目录。
 */
function normalizeModelCatalog(payload) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : []
  const seen = new Set()
  const catalog = []
  for (const row of rows) {
    const rawId =
      typeof row === 'string'
        ? row
        : typeof row?.id === 'string'
          ? row.id
          : typeof row?.name === 'string'
            ? row.name
            : undefined
    if (typeof rawId !== 'string') continue
    const id = rawId.trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const rawDisplay =
      typeof row?.display_name === 'string'
        ? row.display_name
        : typeof row?.displayName === 'string'
          ? row.displayName
          : ''
    const displayName = rawDisplay.trim() === '' ? id : rawDisplay.trim()
    const entry = { id, displayName }
    const input = normalizeInput(row)
    if (input !== undefined) entry.input = input
    const contextWindow = pickPositiveInteger(row, CONTEXT_WINDOW_FIELDS)
    if (contextWindow !== undefined) entry.contextWindow = contextWindow
    const maxTokens = pickPositiveInteger(row, MAX_TOKENS_FIELDS)
    if (maxTokens !== undefined) entry.maxTokens = maxTokens
    const reasoningEfforts = normalizeReasoningEfforts(row?.reasoningEfforts ?? row?.reasoning_efforts)
    if (reasoningEfforts !== undefined) entry.reasoningEfforts = reasoningEfforts
    catalog.push(entry)
  }
  return catalog
}

/**
 * 读设置里导入的模型目录。
 *
 * `models` 是 JSON 字符串；解析失败、类型不对或为空都返回空数组，含义是「用补丁层
 * 内置清单」。刻意宽容：一份写坏的设置不应该让插件起不来，只应该让内置清单生效。
 *
 * @param {unknown} config - 本插件解析后的配置（可能是 volatile 引用单元）。
 * @returns {{ id: string, displayName: string }[]} 导入的目录，未导入时为空数组。
 */
function importedModels(config) {
  const raw = resolveVolatile(config?.[MODELS_FIELD])
  if (typeof raw !== 'string' || raw.trim() === '') return []
  try {
    return normalizeModelCatalog({ data: JSON.parse(raw) })
  } catch {
    return []
  }
}

/**
 * 把导入目录铺成 pi-ai 的模型描述符。
 *
 * 每条以模板为底，再落上这条自己的 id / 名称 / 能力。**只有真的声明了的字段才
 * 覆盖**：模板里的 `input`、`reasoningEfforts`、`compat` 因此仍然是兜底，而
 * 「模板说支持图像、某个模型其实不支持」这种整条路由被带偏的情况不会出现。
 *
 * @param {{
 *   id: string,
 *   displayName: string,
 *   input?: string[],
 *   contextWindow?: number,
 *   maxTokens?: number,
 *   reasoningEfforts?: Record<string, string | null> | false,
 * }[]} catalog - 归一后的目录。
 * @returns {unknown[]} 模型描述符；没有可复用的模板时返回空数组。
 */
function modelsFromCatalog(catalog) {
  if (MODEL_TEMPLATE === undefined) return []
  return catalog.map((model) => {
    const descriptor = { ...structuredClone(MODEL_TEMPLATE), id: model.id, name: model.displayName }
    if (Array.isArray(model.input) && model.input.length > 0) {
      descriptor.input = INPUT_MODALITIES.filter((modality) => model.input.includes(modality))
    }
    if (typeof model.contextWindow === 'number') descriptor.contextWindow = model.contextWindow
    if (typeof model.maxTokens === 'number') descriptor.maxTokens = model.maxTokens
    if (model.reasoningEfforts === false) descriptor.reasoningEfforts = false
    else if (model.reasoningEfforts !== undefined) descriptor.reasoningEfforts = { ...model.reasoningEfforts }
    return descriptor
  })
}

/**
 * 向导第 2 步每行的初值。
 *
 * 站点通常不报能力字段，浏览器半因此拿不到「这条模型到底支持什么」，只能给出一份
 * 可以改的起点 —— 就用内置清单那条。`levels` / `modalities` 顺便把合法词汇表也
 * 发过去，免得两边各写一份常量、日后再漂移。
 *
 * @returns {Record<string, unknown>} 初值与词汇表。
 */
function modelDefaults() {
  const source = MODEL_TEMPLATE ?? {}
  return {
    input: Array.isArray(source.input) ? INPUT_MODALITIES.filter((m) => source.input.includes(m)) : [],
    contextWindow: typeof source.contextWindow === 'number' ? source.contextWindow : undefined,
    maxTokens: typeof source.maxTokens === 'number' ? source.maxTokens : undefined,
    reasoningEfforts:
      source.reasoningEfforts === undefined || source.reasoningEfforts === false
        ? false
        : structuredClone(source.reasoningEfforts),
    levels: [...THINKING_LEVELS],
    modalities: [...INPUT_MODALITIES],
  }
}

/**
 * 本插件此刻要声明的路由值：内置路由，模型目录有导入值时被整个替换。
 *
 * 每次调用都重新读 volatile 引用单元，所以它在 fiber 不重载的情况下也跟随设置
 * 变化 —— 这是「导入后模型选择器立刻更新」能成立的原因。
 *
 * @param {unknown} [config] - 本插件解析后的配置。
 * @returns {unknown} 路由值。
 */
function routeValue(config) {
  const catalog = importedModels(config)
  if (catalog.length === 0) return structuredClone(ROUTE)
  return { ...structuredClone(ROUTE), models: modelsFromCatalog(catalog) }
}
//#endregion

/**
 * 把本包的路由并回 `llm-pi-ai` 配置的每一次解析。
 *
 * 在**解析时**合并而不是写一次条目，才是路由能活下来的原因：宿主自己的 profile
 * watcher 会在启动时重读补丁文件并重建每个条目，所以一次性的写入会在会话开始几
 * 秒后被撤销 —— 那时第一个请求已经成功，于是整个问题不可见。解析钩子撤不掉，
 * 因为没有任何被持久化的东西可以撤回到。
 *
 * 钩子是 loader 自己的 `internal/config` waterfall，那是文档规定监听者可以在配置
 * 被校验前重塑它的地方；`global: true` 是让它能观察到自己以外的条目。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {unknown} [config] - 本插件解析后的配置，用来带上导入的模型目录。
 * @returns {() => void} 释放函数。
 */
function watchRelayRoute(ctx, config) {
  if (typeof ctx.on !== 'function') return () => {}
  return ctx.on(
    'internal/config',
    function (config, next) {
      const resolved = next()
      const entry = this?.entry
      if (entry?.options?.id !== PI_AI_ENTRY.id || entry.options.name !== PI_AI_ENTRY.name) return resolved
      return withRelayRoute(resolved, routeValue(config))
    },
    { global: true },
  )
}

/**
 * 推一次 profile 的 `llm-pi-ai` 条目去解析配置，好让 {@link watchRelayRoute} 合
 * 并进去的路由在第一个请求之前就落定。
 *
 * 光有钩子足够让路由**一直在**，但不足让它**早出现**：`llm-pi-ai` 属于基础组合包，
 * 而 bundle patch 只能追加，所以本插件激活时它早已解析完配置并注册好路由了。写
 * 一次条目会经由钩子重跑那次解析。
 *
 * `providers` 是 `.volatile()` 字段，所以这次写入走 loader 的 volatile 提交路径：
 * 值落到运行中 fiber 的引用单元，适配器收到 `loader/volatile-update`，无需重启即
 * 重新注册路由。该写入刻意不持久化，profile 自己的补丁文件保持它声明的内容。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {unknown} [config] - 本插件解析后的配置，用来带上导入的模型目录。
 * @returns {Promise<'declared' | 'claimed' | 'absent' | 'unusable' | 'failed'>}
 *   发现了什么，以及路由缺失时补回来的结果。
 */
async function claimRelayRoute(ctx, config) {
  const loader = ctx.get('loader')
  if (loader === undefined) return 'absent'
  const entry = [...loader.entries()].find(
    (row) => row.options.id === PI_AI_ENTRY.id && row.options.name === PI_AI_ENTRY.name,
  )
  if (entry === undefined) return 'absent'
  const state = relayRouteState(entry.options.config)
  if (state !== 'missing') return state
  try {
    await entry.update({ config: withRelayRoute(entry.options.config, routeValue(config)) })
  } catch {
    // 一个替换掉 providers 字典的 profile 同样有权把这个条目变成不可配置；那是
    // 它的选择，而路由缺失就是被报告的征兆，不是需要掩盖的失败。
    return 'failed'
  }
  return 'claimed'
}

//#region model discovery

/**
 * 用给定密钥向站点查询可用模型。
 *
 * **必须在宿主侧执行**：api3d.cn 的 `/v1/models` 不回任何 `access-control-*` 头，
 * 浏览器的预检请求直接被 403 拒绝。浏览器半只负责收集输入与展示结果，真正的
 * HTTP 请求发生在这里。
 *
 * 传输沿用围栏的直连策略：`always`（或 `auto` 且进程设了代理变量）走 `directFetch`，
 * 否则走全局 `fetch`（跟随进程代理）。
 *
 * @param {unknown} config - 本插件解析后的配置。
 * @param {unknown} payload - 请求体：`{ apiKey, baseURL? }`。
 * @returns {Promise<
 *   | {
 *       ok: true,
 *       models: {
 *         id: string,
 *         displayName: string,
 *         input?: string[],
 *         contextWindow?: number,
 *         maxTokens?: number,
 *         reasoningEfforts?: Record<string, string | null> | false,
 *       }[],
 *       baseURL: string,
 *       defaults: Record<string, unknown>,
 *     }
 *   | { ok: false, code: string, message: string }
 * >} 查询结果。
 */
async function discoverModels(config, payload) {
  const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (apiKey === '') return { ok: false, code: 'missing-key', message: '请填写 API Key' }
  const fallback = resolveVolatile(config?.baseURL)
  const requested = typeof payload?.baseURL === 'string' ? payload.baseURL.trim() : ''
  const rawBase = requested !== '' ? requested : typeof fallback === 'string' && fallback.trim() !== '' ? fallback.trim() : SITE_DEFAULT_BASE_URL
  let url
  try {
    url = new URL(`${rawBase.replace(/\/+$/, '')}/models`)
  } catch {
    return { ok: false, code: 'bad-base-url', message: `基础地址不是合法 URL：${rawBase}` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'bad-base-url', message: '基础地址必须走 http 或 https' }
  }
  const mode = resolveVolatile(config?.directMode)
  const direct = mode === 'always' || (mode === 'auto' && proxyEnvPresent())
  const transport = direct ? directFetch : globalThis.fetch
  let response
  try {
    response = await transport(url.href, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, code: 'transport', message: `连不上站点：${String(error?.message ?? error)}` }
  }
  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403
    return {
      ok: false,
      code: unauthorized ? 'unauthorized' : `http-${response.status}`,
      message: unauthorized ? '密钥无效或无权访问该站点' : `站点返回 HTTP ${response.status}`,
    }
  }
  let body
  try {
    body = await response.json()
  } catch {
    return { ok: false, code: 'bad-body', message: '站点返回的不是 JSON' }
  }
  const catalog = normalizeModelCatalog(body)
  if (catalog.length === 0) return { ok: false, code: 'empty-catalog', message: '站点没有报出任何模型' }
  return {
    ok: true,
    models: catalog,
    baseURL: url.href.replace(/\/models$/, ''),
    defaults: modelDefaults(),
  }
}

/**
 * 把设置里导入的模型目录装回 `llm-pi-ai` 条目。
 *
 * 走条目自己的 volatile 提交路径：`providers` 是 `.volatile()` 字段，写入落在运行
 * 中 fiber 的引用单元上，适配器收到 `loader/volatile-update` 后重新注册路由，
 * 不需要重载任何 fiber、也不需要重启。刻意不持久化：profile 的补丁文件保持它
 * 声明的内容，导入的目录存在本插件的设置里。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {unknown} config - 本插件解析后的配置。
 * @returns {Promise<{ ok: true, models: string[] } | { ok: false, code: string, message: string }>}
 *   写入结果。
 */
async function applyImportedModels(ctx, config) {
  const catalog = importedModels(config)
  if (catalog.length === 0) return { ok: false, code: 'models-empty', message: '没有可导入的模型' }
  const loader = ctx.get('loader')
  if (loader === undefined) return { ok: false, code: 'no-loader', message: '宿主没有 loader，无法写入模型目录' }
  const entry = [...loader.entries()].find(
    (row) => row.options.id === PI_AI_ENTRY.id && row.options.name === PI_AI_ENTRY.name,
  )
  if (entry === undefined) return { ok: false, code: 'no-entry', message: '宿主里没有 llm-pi-ai 条目' }
  const current = entry.options.config
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    return { ok: false, code: 'unusable', message: 'llm-pi-ai 的配置不可合并' }
  }
  const providers = resolveVolatile(current.providers)
  const baseProviders = typeof providers === 'object' && providers !== null && !Array.isArray(providers) ? providers : {}
  try {
    await entry.update({ config: { ...current, providers: { ...baseProviders, [PROVIDER]: routeValue(config) } } })
  } catch (error) {
    return { ok: false, code: 'update-failed', message: String(error?.message ?? error) }
  }
  return { ok: true, models: catalog.map((model) => model.id) }
}

/**
 * 把一个 Fetch 请求体读成 JSON 对象；读不出来就是空对象。
 *
 * @param {Request} request - 宿主 Fetch 路由收到的请求。
 * @returns {Promise<Record<string, unknown>>} 解析后的对象。
 */
async function requestJson(request) {
  try {
    const value = await request.json()
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/**
 * 把两条向导路由注册进 connection 的鉴权围栏。
 *
 * 注册在 `connection.fetch` 上而不是裸的 `webServer`：那条通道自带 Host/Origin
 * 围栏与浏览器会话鉴权，未授权的请求根本到不了处理函数。
 *
 * @param {object} connection - 宿主 connection 服务。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {unknown} config - 本插件解析后的配置。
 * @returns {void}
 */
function registerModelRoutes(connection, ctx, config) {
  connection.fetch.register({
    path: MODELS_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const result = await discoverModels(config, await requestJson(request))
      return Response.json(result, { status: result.ok ? 200 : 400, headers: { 'cache-control': 'no-store' } })
    },
  })
  connection.fetch.register({
    path: APPLY_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => {
      const result = await applyImportedModels(ctx, config)
      return Response.json(result, { status: result.ok ? 200 : 400, headers: { 'cache-control': 'no-store' } })
    },
  })
}
//#endregion

/**
 * 中转站用 HTTP 402 + 一个被错标为 `text/event-stream` 的 JSON 错误体回答额度
 * 耗尽；放着不管，provider SDK 会把它呈现为不透明的传输失败而不是它本来的 API
 * 错误。这里把这种响应重建为 `application/json`，保留原始错误消息并追加提示。
 * 其余响应原样穿过。
 *
 * @param {Promise<Response>} pending - 中转站 fetch 的 promise。
 * @param {string} hint - 追加在原始错误消息后的文字（空串时调用方不应调用本函数）。
 * @returns {Promise<Response>} 可能被重建过的响应。
 */
function annotateQuotaError(pending, hint) {
  return pending.then((response) => {
    if (response.status !== 402) return response
    const type = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!type.includes('event-stream') && !type.includes('json')) return response
    return response.text().then((text) => {
      let parsed
      let message
      try {
        parsed = JSON.parse(text)
        message = parsed?.error?.message
      } catch {
        message = undefined
      }
      const headers = new Headers(response.headers)
      if (typeof message !== 'string' || message.length === 0) {
        // 不是 JSON 错误体：原样把字节还回去。
        return new Response(text, { status: response.status, statusText: response.statusText, headers })
      }
      headers.set('content-type', 'application/json')
      parsed.error.message = message + '\n' + hint
      return new Response(JSON.stringify(parsed), { status: response.status, statusText: response.statusText, headers })
    })
  })
}

/**
 * 包一层 `fetch`，让本路由的请求带上（可选的）中转站 User-Agent，并把哨兵地址
 * 改写为设置里的真实地址。
 *
 * 除了工具 schema 与 URL 改写，包装器从不读取或重建 body：对 harness 里每个
 * provider SDK 使用的形状（url + 一个 init 对象）它复制 `init`、只替换 headers。
 * 裸 `Request` 会用 `duplex: 'half'` 重建，好让流式 body 活过克隆。
 *
 * @param {typeof fetch} native - 本包装器委派给的那个 fetch。
 * @param {() => ReturnType<typeof Config>} current - 读取当前设置段。
 * @returns {typeof fetch} 包装后的 fetch。
 */
function fenceFetch(native, current) {
  return function relayFetch(input, init) {
    const url = urlOf(input)
    if (url === undefined) return native(input, init)

    const config = current()
    const target = targetOf(config)
    if (!isRelayRequest(url, target)) return native(input, init)

    const isSentinel = url.host.toLowerCase() === SENTINEL.toLowerCase()
    // 哨兵地址但没填真实地址：不改写，让 DNS 大声失败。静默打到别处更糟。
    if (isSentinel && target === undefined) return native(input, init)

    const isRequest = typeof Request === 'function' && input instanceof Request
    const headers = new Headers(init?.headers ?? (isRequest ? input.headers : undefined))
    const userAgent = String(resolveVolatile(config.userAgent) ?? '').trim()
    if (userAgent.length > 0) headers.set('user-agent', userAgent)

    // 直连传输存在的唯一目的是逃开代理 dispatcher，所以 auto 模式要求进程真的
    // 设了代理变量；always 则无条件绕过。
    const mode = resolveVolatile(config.directMode)
    const direct = mode === 'always' || (mode === 'auto' && proxyEnvPresent()) ? directFetch : undefined

    const patching = resolveVolatile(config.patchToolSchema) !== false
    const rewritten = patching && typeof init?.body === 'string' ? relayToolSchemaPatch(init.body) : undefined
    /** 补丁产生新 body 时，把它叠到任意 init 基座上。 */
    const withPatchedBody = (base) => (rewritten === undefined ? base : { ...base, body: rewritten })

    // dispatch 是函数而不是值，因为静默重试会重新调用它：每次调用都按调用方给的
    // 部分重建请求，于是每一次尝试放到线上的都是完全相同的字节 —— 这正是重点，
    // 因为失败属于抽到请求的通道，不属于请求本身。
    const dispatch = () => {
      if (!isSentinel) {
        // 已经指向真实主机：只改写归属头，调用方自己的 URL 对象或 Request 身份不动。
        if (direct !== undefined) return direct(url, withPatchedBody(unifiedInit(input, init, isRequest, headers)))
        if (isRequest && init === undefined) return native(new Request(input, { headers, duplex: 'half' }))
        return native(input, withPatchedBody({ ...init, headers }))
      }
      const rewrittenUrl = rewriteToTarget(url, target)
      if (direct !== undefined) return direct(rewrittenUrl, withPatchedBody(unifiedInit(input, init, isRequest, headers)))
      if (isRequest)
        return native(
          new Request(rewrittenUrl, withPatchedBody({ ...(init ?? {}), ...requestInitOf(input), headers, duplex: 'half' })),
        )
      return native(rewrittenUrl, withPatchedBody({ ...init, headers }))
    }

    const signal = init?.signal ?? (isRequest ? input.signal : undefined)
    // silentRetry 是 volatile，所以它是以引用单元而不是布尔值到达的 —— 一次设置
    // 写入就地改这个单元而不重载 fiber，下一个请求必须看到新选择。
    const silentRetry = resolveVolatile(config.silentRetry) === true
    const pending =
      silentRetry && signal?.aborted !== true
        ? retryTransient(dispatch(), dispatch, resolveVolatile(config.silentRetryAttempts), signal, (attempt) =>
            console.log(`api3d: 中转站以瞬时上游错误拒绝，正在重发（第 ${attempt} 次）`),
          )
        : dispatch()

    const quotaHint = String(resolveVolatile(config.quotaHint) ?? '')
    return quotaHint === '' ? pending : annotateQuotaError(pending, quotaHint)
  }
}

/**
 * 装上围栏。地址与重试策略都是设置段。
 *
 * 0.1.2–0.1.5 需要手工注册设置段（`settings.installSection`，0.1.7 起上游移除）；
 * 自 0.1.7 起每个已激活条目的 Config 会自动反映到设置平面，而一次设置写入更新条目
 * 配置、重载这个 fiber 并重跑 `apply` —— 所以围栏总是闭包在它启动时的那份配置上。
 * 唯一的例外是 volatile 字段：它们就地改引用单元，所以每次读取都要经过
 * `resolveVolatile`。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 插件上下文。
 * @param {ReturnType<typeof Config>} config - 解析后的条目配置。
 */
function apply(ctx, config) {
  // 路由声明是必须在每次激活都装上的两件事，而不只是第一次：一次「往 profile 里
  // 加一个自己的 provider」的编辑会重载这个 fiber，重载完成时路由又已经缺失了。
  //
  // 钩子让路由在会话余下的每次解析里都被并进去，这才是它能活过「宿主在启动几秒
  // 后重读补丁文件」的原因。一次性写入只是为了逼出一次早期解析 —— 本插件激活时
  // llm-pi-ai 早已注册完路由。
  //
  // ctx.inject 是等 loader 而不是把它声明成硬依赖，所以没挂 loader 的宿主仍然
  // 得到围栏。
  if (config.claimRoute && typeof ctx.inject === 'function') {
    ctx.inject(['loader'], (scoped) => {
      scoped.effect(() => watchRelayRoute(scoped, config), 'api3d: relay route resolution hook')
      scoped.effect(() => {
        let cancelled = false
        claimRelayRoute(scoped, config).then(
          (outcome) => {
            if (cancelled) return
            if (outcome === 'claimed') {
              console.log(`api3d: profile 补丁层替换了 llm-pi-ai.providers，${PROVIDER} 路由已被挤掉；已重新声明`)
            } else if (outcome === 'failed') {
              ctx.logger.warn(
                `api3d: profile 补丁层挤掉了 ${PROVIDER} 路由且无法重新声明；每次 ${PROVIDER} 调用都会以 NO_ADAPTER 失败`,
              )
            }
          },
          (error) => ctx.logger.warn('api3d: 路由声明失败', error),
        )
        return () => {
          cancelled = true
        }
      })
    })
  }

  // 密钥/模型向导的两条宿主路由。`connection` 只在 web 与 desktop 组合里存在，
  // 所以用软注入：没有它的部署（headless）只是没有向导，既有的围栏与路由照常工作。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (scoped) => {
      const connection =
        scoped.connection ?? (typeof scoped.get === 'function' ? scoped.get('connection') : undefined)
      if (connection === undefined || typeof connection.fetch?.register !== 'function') {
        ctx.logger.warn('api3d: connection 服务不可用，密钥/模型向导无法工作')
        return
      }
      try {
        registerModelRoutes(connection, ctx, config)
      } catch (error) {
        // 同一条路径注册两次会抛错（fiber 重载时旧路由若未被清理）。向导可以失效，
        // 但不能因此让整个插件起不来。
        ctx.logger.warn('api3d: 注册密钥/模型向导路由失败', error)
      }
    })
  }

  ctx.effect(() => {
    const previous = globalThis.fetch
    if (typeof previous !== 'function') {
      ctx.logger.warn('api3d: 没有可包装的全局 fetch；本路由的请求将无法改地址并被拒绝')
      return () => {}
    }
    const fenced = fenceFetch(previous, () => config)
    globalThis.fetch = fenced
    return () => {
      // 只还原本插件装上的那个：之后叠加上来的包装器才是全局的拥有者，把它冲掉
      // 会丢掉那一层的改写。
      if (globalThis.fetch === fenced) globalThis.fetch = previous
    }
  })

  if (config.announce) {
    const target = targetOf(config)
    const mode = resolveVolatile(config.directMode)
    const direct = mode === 'always' || (mode === 'auto' && proxyEnvPresent())
    const catalog = importedModels(config)
    const modelIds = (catalog.length > 0 ? catalog : ROUTE.models).map((model) => model.id)
    // console.log 让这行像官方 dsh web: 那行一样可见（在这个宿主里 cordis 的 logger
    // 可能被路由到别处）。
    console.log(
      `api3d: 路由 ${PROVIDER} → ${target === undefined ? '未配置地址（请求将打到哨兵主机并 DNS 失败）' : target.href}` +
        `${direct ? '，直连（绕过进程代理）' : ''}` +
        `，模型目录 ${modelIds.length} 个（${catalog.length > 0 ? '从站点导入' : '内置'}）：${modelIds.join('、')}`,
    )
  }
}

export {
  Config,
  SETTINGS_NAMESPACE,
  apply,
  applyImportedModels,
  claimRelayRoute,
  discoverModels,
  importedModels,
  name,
  normalizeModelCatalog,
  relayRouteState,
  relayToolSchemaPatch,
  routeValue,
  watchRelayRoute,
  withRelayRoute,
}
