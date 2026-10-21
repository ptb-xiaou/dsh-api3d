#!/usr/bin/env node
/**
 * 核对「插件里声明的模型目录」与「站点实际提供的模型目录」是否一致。
 *
 * 为什么需要这个脚本：手工声明的 pi-ai 路由必须把模型的 id、上下文长度、输出上限
 * 全部写死在 cordis.patch.yml 里。写死的东西会漂 —— 站点下架、改名、换分组，插件
 * 这边不会有任何动静，模型照样出现在选择器里，选中后才 404 model_not_found。
 * 所以清单不能靠猜，只能靠一次真实请求核对。
 *
 * 本脚本只发一次只读 GET {baseURL}/models，不发任何补全请求，不写任何文件。
 *
 * 用法：
 *   npm run probe-models
 *   npm run probe-models -- --ref SUB2API_API_KEY
 *   npm run probe-models -- --base https://api3d.cn/v1 --key-env API3D_API_KEY
 *
 * 凭据解析顺序：
 *   1. 环境变量里以 --key-env 指名的那个（默认 API3D_API_KEY）
 *   2. --credentials 指向的 YAML（默认 $DSH_HOME/.credentials.yaml，否则 ~/.dsh）里的 refs[--ref]
 *   3. --ref 缺省时，取核对后的 refs 里存在且与站点有关联的那个 —— 不做猜测，直接报错要求显式给
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import yaml from 'js-yaml'
import { SITE_DEFAULT_BASE_URL } from '../lib/site.js'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..')
const PATCH_FILE = path.join(ROOT, 'cordis.patch.yml')

/** 从 cd 出来的参数表里取一个值，取不到返回 undefined。 */
function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  return value !== undefined && !value.startsWith('--') ? value : undefined
}

/** 找出 DSH home：优先 $DSH_HOME，否则 ~/.dsh。 */
function resolveHome() {
  const configured = (process.env.DSH_HOME ?? '').trim()
  return configured.length > 0 ? configured : path.join(os.homedir(), '.dsh')
}

/** 读补丁层里声明的路由：baseURL（通常是哨兵）与 models。 */
function readDeclaredRoute() {
  const patch = yaml.load(fs.readFileSync(PATCH_FILE, 'utf8'))
  const row = (Array.isArray(patch) ? patch : []).find((entry) => entry?.id === 'llm-pi-ai')
  const route = row?.config?.providers && Object.values(row.config.providers)[0]
  if (route === undefined) throw new Error(`${PATCH_FILE} 里找不到 llm-pi-ai.providers.<route>`)
  return { route, models: Array.isArray(route.models) ? route.models : [] }
}

/** 解析一把可用于探测的密钥；返回 { key, source }。 */
function resolveKey(apiKeyEnv) {
  const keyEnv = arg('key-env') ?? apiKeyEnv ?? 'API3D_API_KEY'
  const fromEnv = (process.env[keyEnv] ?? '').trim()
  if (fromEnv.length > 0) return { key: fromEnv, source: `环境变量 ${keyEnv}` }

  const credentialsPath = arg('credentials') ?? path.join(resolveHome(), '.credentials.yaml')
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`找不到凭据文件 ${credentialsPath}，也可以直接用环境变量 ${keyEnv} 提供密钥`)
  }
  const refs = yaml.load(fs.readFileSync(credentialsPath, 'utf8'))?.refs ?? {}
  const explicit = arg('ref')
  if (explicit === undefined) {
    throw new Error(
      `凭据文件里有 ${Object.keys(refs).length} 条引用，但没有指定用哪一条。\n` +
        `请显式给出，例如：npm run probe-models -- --ref SUB2API_API_KEY\n` +
        `（本插件自己在设置页填的引用名是 ${keyEnv}，它在凭据库里通常还没填。）`,
    )
  }
  const key = refs[explicit]
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error(`凭据引用 ${explicit} 在 ${credentialsPath} 里不存在或为空`)
  }
  return { key: key.trim(), source: `凭据引用 refs.${explicit}` }
}

/** 站点给的列表形状：OpenAI 风格 { data: [{ id }] }，也容忍裸数组与 { models: [] }。 */
function normalizeListing(body) {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : undefined
  if (rows === undefined) return undefined
  return rows
    .map((row) => (typeof row === 'string' ? row : row?.id ?? row?.model ?? row?.name))
    .filter((id) => typeof id === 'string' && id.length > 0)
}

/** 把一条已声明的模型渲染成可直接粘贴的 YAML（保持原样，只做排版）。 */
function renderDeclared(model) {
  const block = yaml.dump(model, { lineWidth: -1, noRefs: true })
  return block
    .trimEnd()
    .split('\n')
    .map((line) => `          ${line}`)
    .join('\n')
}

/** 站点新出现、本插件还没声明的模型：给一份带 TODO 的骨架。 */
function renderSkeleton(id) {
  return [
    `          - id: ${id}`,
    `            name: ${id}`,
    '            # TODO 容量与输出上限必须按站点文档填，不要照抄别的模型。',
    '            contextWindow: 128000',
    '            maxTokens: 8192',
    '            input:',
    '              - text',
    '            # TODO 站点是否接受 reasoning_effort；不接受就整段删掉。',
    '            compat:',
    '              supportsReasoningEffort: false',
  ].join('\n')
}

const declaredRoute = readDeclaredRoute()
const baseUrl = (arg('base') ?? SITE_DEFAULT_BASE_URL).replace(/\/+$/, '')
const { key, source } = resolveKey(declaredRoute.route.apiKeyEnv)

console.log(`核对 ${baseUrl}/models`)
console.log(`凭据：${source}（长度 ${key.length}，不打印内容）\n`)

let response
try {
  response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  })
} catch (error) {
  console.error(`请求失败：${error.message}`)
  process.exit(1)
}

const text = await response.text()
if (!response.ok) {
  console.error(`HTTP ${response.status} —— 站点拒绝了这次探测：`)
  console.error(text.slice(0, 600))
  process.exit(1)
}

let body
try {
  body = JSON.parse(text)
} catch {
  console.error('站点返回的不是 JSON，无法核对：')
  console.error(text.slice(0, 600))
  process.exit(1)
}

const live = normalizeListing(body)
if (live === undefined) {
  console.error('响应里找不到模型列表（既不是 data[] 也不是 models[]）：')
  console.error(JSON.stringify(body).slice(0, 600))
  process.exit(1)
}

const declaredIds = declaredRoute.models.map((model) => model.id)
const missing = declaredIds.filter((id) => !live.includes(id))
const unknown = live.filter((id) => !declaredIds.includes(id))

console.log(`站点自报 ${live.length} 个模型：`)
for (const id of live) console.log(`  ${declaredIds.includes(id) ? '✓' : '+'} ${id}`)
if (declaredIds.length !== live.length || missing.length > 0) console.log()

console.log(`补丁层声明 ${declaredIds.length} 个模型：`)
for (const id of declaredIds) console.log(`  ${live.includes(id) ? '✓' : '✗'} ${id}`)

if (missing.length === 0 && unknown.length === 0) {
  console.log('\n两边一致，无需改动。')
  process.exit(0)
}

console.log('')
for (const id of missing) console.log(`⚠ 声明了「${id}」，但站点没有它 —— 选中后会 404 model_not_found。`)
for (const id of unknown) console.log(`⚠ 站点有「${id}」，但补丁层没声明 —— 它不会出现在模型选择器里。`)

console.log('\n下面是按站点实际列表重排的 models 段（替换 cordis.patch.yml 里同名的 models:）')
console.log('        models:')
for (const id of live) {
  const declared = declaredRoute.models.find((model) => model.id === id)
  console.log(declared === undefined ? renderSkeleton(id) : renderDeclared(declared))
}
console.log('\n改完记得：npm run gen-route && npm test')
