#!/usr/bin/env node
/**
 * 核对「插件设置里导入的模型目录」与「站点实际提供的模型目录」是否一致。
 *
 * 为什么需要这个脚本：模型目录来自向导在站点上查到的那份，只读一次就被记下来了。
 * 之后站点下架、改名、换分组，插件这边不会有任何动静，模型照样出现在选择器里，
 * 选中后才 404 model_not_found。所以「站点到底在售什么」不能靠记，只能靠一次真实
 * 请求核对；不一致时回向导重新导入一次即可，不用改文件。
 *
 * 本脚本只发一次只读 GET {baseURL}/models，不发任何补全请求，不写任何文件。
 *
 * 用法：
 *   npm run probe-models
 *   npm run probe-models -- --profile web
 *   npm run probe-models -- --base https://api3d.cn/v1 --key-env API3D_API_KEY
 *   npm run probe-models -- --ref SUB2API_API_KEY
 *
 * 凭据解析顺序：
 *   1. 环境变量里以 --key-env 指名的那个（默认取自 lib/route.js 的 apiKeyEnv）
 *   2. --credentials 指向的 YAML（默认 $DSH_HOME/.credentials.yaml，否则 ~/.dsh）里的 refs[--ref]
 *   3. --ref 缺省时不做猜测，直接报错要求显式给
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import yaml from 'js-yaml'
import { ROUTE } from '../lib/route.js'
import { SITE_DEFAULT_BASE_URL } from '../lib/site.js'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..')

/** 从命令行参数表里取一个值，取不到返回 undefined。 */
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

/**
 * 读插件设置里导入的目录。
 *
 * 设置落在 profile 的补丁层（`- id: api3d` → `config.models`，一个 JSON 字符串），
 * 那是向导唯一的写点；没有这一段就是「还没导入任何模型」。
 *
 * @returns {{ models: { id: string, displayName?: string }[], source: string }}
 */
function readImportedCatalog() {
  const profile = arg('profile') ?? 'web'
  const patchPath = path.join(resolveHome(), 'profiles', profile, 'cordis.patch.yml')
  if (!fs.existsSync(patchPath)) return { models: [], source: `${patchPath}（不存在）` }
  const patch = yaml.load(fs.readFileSync(patchPath, 'utf8'))
  const row = (Array.isArray(patch) ? patch : []).find((entry) => entry?.id === 'api3d')
  const raw = row?.config?.models
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { models: [], source: `${patchPath}（没有 models，尚未导入）` }
  }
  try {
    const parsed = JSON.parse(raw)
    const models = (Array.isArray(parsed) ? parsed : [])
      .map((model) => (typeof model === 'string' ? { id: model } : model))
      .filter((model) => typeof model?.id === 'string' && model.id.length > 0)
    return { models, source: `${patchPath}（导入 ${models.length} 个）` }
  } catch {
    return { models: [], source: `${patchPath}（models 不是合法 JSON）` }
  }
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

const imported = readImportedCatalog()
const baseUrl = (arg('base') ?? SITE_DEFAULT_BASE_URL).replace(/\/+$/, '')
const { key, source } = resolveKey(arg('key-env') ?? ROUTE.apiKeyEnv)

console.log(`核对 ${baseUrl}/models`)
console.log(`凭据：${source}（长度 ${key.length}，不打印内容）`)
console.log(`设置里的目录：${imported.source}\n`)

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

const importedIds = imported.models.map((model) => model.id)
const missing = importedIds.filter((id) => !live.includes(id))
const missingInPlugin = live.filter((id) => !importedIds.includes(id))

console.log(`站点自报 ${live.length} 个模型：`)
for (const id of live) console.log(`  ${importedIds.includes(id) ? '✓' : '+'} ${id}`)
console.log()

if (importedIds.length === 0) {
  console.log('本插件还没有导入任何模型 —— 到侧边栏 API3D → 打开配置向导，填 key 后选择要导入的模型。')
  process.exit(0)
}

console.log(`设置里导入 ${importedIds.length} 个模型：`)
for (const id of importedIds) console.log(`  ${live.includes(id) ? '✓' : '✗'} ${id}`)

if (missing.length === 0 && missingInPlugin.length === 0) {
  console.log('\n两边一致，无需改动。')
  process.exit(0)
}

console.log('')
for (const id of missing) console.log(`⚠ 导入过「${id}」，但站点现在没有它 —— 选中后会 404 model_not_found。`)
for (const id of missingInPlugin) console.log(`⚠ 站点有「${id}」，但没导入 —— 它不会出现在模型选择器里。`)
console.log('\n回侧边栏 API3D → 打开配置向导，重新查询并导入一次即可（不用改文件、不用重启）。')
