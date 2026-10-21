import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'

/**
 * 中转站请求的直连传输：用来绕开进程级代理。
 *
 * 中转站的 Cloudflare WAF 会把来自数据中心出口 IP 的请求（正是 HTTPS_PROXY 一跳
 * 产生的）判成挑战，回一个 200 的 HTML 中间页而不是 SSE 流，provider SDK 只会把
 * 它呈现成一个不可分辨的传输失败。住宅网络的直连能过。dsh 在插件加载之前就已
 * 从 launch environment 装好了代理 dispatcher，所以围栏无法靠配置重路由；它必须
 * 自己拥有这些请求的传输。
 *
 * 为什么不用 undici 的 `init.dispatcher`：一个 dispatcher 只能与运行中的 Node
 * 自带的那份 undici 互操作——从 npm 装的、大版本不同的 Agent 会在内建 fetch 里
 * 触发内部 handler 断言失败。`node:http`/`node:https` 没有这种耦合。
 *
 * 本桥在 provider SDK 依赖的一切上跟随 fetch 的形状：流式请求体与响应体、abort
 * 信号、status/header 保真。它不跟随重定向（中转站的 API 契约里没有重定向），
 * 并且恒以 identity 编码应答，因为它不做解压。
 */

/** 必须不带 body 的状态码。 */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

/** 共享 agent，让中转站请求像 fetch 一样复用连接池里的 socket。 */
const agents = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
}

/**
 * launch environment 是否点名了本进程会遵守的代理。
 *
 * dsh 正是从这些变量装它的 dispatcher，所以它们的存在才是直连有意义的前提；
 * 没有它们时直连与普通 fetch 行为一致，围栏也就保留原生路径。
 *
 * @param {typeof process.env} [env] - 要检查的环境。
 * @returns {boolean} 任一代理变量被设为非空白值时返回 true。
 */
export function proxyEnvPresent(env = process.env) {
  for (const name of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY']) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') return true
  }
  return false
}

/**
 * 用一条 `node:http`/`node:https` 直连发一个请求。
 *
 * @param {URL | string} input - 要请求的绝对 URL。
 * @param {RequestInit} [init] - method、headers、body 与 signal。可识别的 body
 *   形状：string、ArrayBuffer/TypedArray、URLSearchParams、ReadableStream
 *   （以分块上传流式发送）。未知的 init 字段被忽略。
 * @returns {Promise<Response>} 响应，body 为流式。
 */
export function directFetch(input, init = {}) {
  // URL 解析失败必须变成 rejected promise 而不是同步抛出：调用方（围栏）把它当作
  // fetch 用，而 fetch 从不同步抛。
  let url
  try {
    url = typeof input === 'string' ? new URL(input) : input
  } catch (cause) {
    return Promise.reject(new TypeError(`fetch failed (direct transport: invalid URL ${String(input)})`, { cause }))
  }
  if (!(url instanceof URL) || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return Promise.reject(new TypeError(`fetch failed (direct transport: unsupported URL ${String(input)})`))
  }

  const headers = new Headers(init.headers ?? undefined)
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity')
  const headerBag = {}
  for (const [name, value] of headers.entries()) headerBag[name] = value

  const method = (init.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD' && init.body !== undefined && init.body !== null
  const streamBody = hasBody && typeof ReadableStream === 'function' && init.body instanceof ReadableStream
  const payload = !hasBody
    ? null
    : streamBody
      ? null
      : typeof init.body === 'string'
        ? Buffer.from(init.body, 'utf8')
        : init.body instanceof URLSearchParams
          ? Buffer.from(init.body.toString(), 'utf8')
          : ArrayBuffer.isView(init.body) || init.body instanceof ArrayBuffer
            ? Buffer.from(init.body)
            : null
  if (payload !== null && !headers.has('content-length')) headerBag['content-length'] = String(payload.length)

  const signal = init.signal ?? undefined

  return new Promise((resolve, reject) => {
    let currentResponse = null
    let settled = false

    // abort 监听必须活过响应头：中途被取消的一轮必须切断连接，而不是继续把
    // 中转站的流抽干。
    function settle() {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
    }
    function onAbort() {
      request.destroy()
      currentResponse?.destroy()
    }
    function failure(cause) {
      settle()
      reject(
        signal?.aborted
          ? new DOMException('This operation was aborted', 'AbortError')
          : new TypeError('fetch failed', { cause }),
      )
    }

    const transport = url.protocol === 'http:' ? http : https
    const request = transport.request(url, { method, headers: headerBag, agent: agents[url.protocol] }, (response) => {
      currentResponse = response
      response.on('close', settle)
      const responseHeaders = new Headers()
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1])
      }
      const status = response.statusCode ?? 590
      const bodyInit = NULL_BODY_STATUS.has(status) || method === 'HEAD' ? null : Readable.toWeb(response)
      resolve(new Response(bodyInit, { status, statusText: response.statusMessage ?? '', headers: responseHeaders }))
    })

    request.on('error', failure)
    if (signal !== undefined) {
      if (signal.aborted) {
        failure(new DOMException('This operation was aborted', 'AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    if (payload !== null) request.end(payload)
    else if (streamBody) {
      const source = Readable.fromWeb(init.body)
      source.on('error', (cause) => request.destroy(cause))
      source.pipe(request)
    } else request.end()
  })
}
