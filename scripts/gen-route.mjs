// 从 cordis.patch.yml 生成 lib/route.js，让「运行时重新声明路由」用的值与补丁层
// 声明的值不可能漂移。改完补丁文件后跑 `npm run gen-route`；忘记跑的话
// test/route-parity.test.mjs 会失败。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { PI_AI_ENTRY, PROVIDER, SENTINEL } from '../lib/site.js'

const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const routePath = fileURLToPath(new URL('../lib/route.js', import.meta.url))

const rows = yaml.load(fs.readFileSync(patchPath, 'utf8'))
const pi = rows.find((row) => row.id === 'llm-pi-ai')
if (pi === undefined) throw new Error('cordis.patch.yml 里没有 llm-pi-ai 补丁行')
const route = pi.config.providers?.[PROVIDER]
if (route === undefined) throw new Error(`cordis.patch.yml 里没有 ${PROVIDER} 路由`)

// 身份常量只有 lib/site.js 一处定义，这里做一次一致性校验：补丁文件与常量块
// 说的必须是同一个站点、同一个哨兵主机。不一致就别生成，宁可红。
const sentinelHost = new URL(route.baseURL).host
if (sentinelHost !== SENTINEL) {
  throw new Error(`路由 baseURL 的主机是 ${sentinelHost}，但 lib/site.js 的 SENTINEL 是 ${SENTINEL}`)
}

const text = `/**
 * 运行时形态的路由值 —— 由 \`scripts/gen-route.mjs\` 从 \`cordis.patch.yml\` 生成，
 * 不要手改。改路由请改补丁文件后跑 \`npm run gen-route\`。
 *
 * 为什么需要这份副本：profile 自己的补丁层在所有 bundle 层**之后**应用，而 loader
 * 的补丁合并是把补丁的 \`config\` **赋值**在组合结果之上 —— 只有一层深，所以
 * \`providers\` 整个字典是被替换而不是被合并。任何自带 provider 的 profile（随包
 * 发行的 desktop profile 就是，任何跑第二台中转站的 profile 也是）都会把这条
 * \`${PROVIDER}\` 路由挤掉，之后每次调用都以 \`NO_ADAPTER\` 失败。
 *
 * 围栏通过宿主条目自己的 volatile config 把路由重新装回去，适配器在下一个请求
 * 就能看到。test/route-parity.test.mjs 断言这里的值仍等于补丁层的值。
 *
 * @module dsh-api3d/route
 */
import { PI_AI_ENTRY, PROVIDER } from './site.js'

/** 本包在 \`llm-pi-ai.providers\` 里拥有的路由，与 cordis.patch.yml 逐字一致。 */
const ROUTE = ${JSON.stringify(route, null, 2)}

export { PI_AI_ENTRY, PROVIDER, ROUTE }
`
fs.writeFileSync(routePath, text)
console.log('lib/route.js 已写入:', fs.statSync(routePath).size, 'bytes')
