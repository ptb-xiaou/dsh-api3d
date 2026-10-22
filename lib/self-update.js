// ============================================================================
// dsh-api3d —— 宿主半的「检查更新 / 一键升级」
//
// 用户要求：插件管理器**没有更新 API**（它的文案写死「插件安装后暂不支持自动更新。
// 若需升级，请先卸载再安装新版」），所以「手动更新」只能由插件自己驱动包管理器：
// 对自己所在的 profile 跑一次 `pnpm add dsh-api3d@<目标版本>` —— 也就是插件管理器
// 自己在做的那一件事。
//
// 三条实测教训决定了实现方式（与 dsh-api3d-pet 同源，都是真机踩出来的）：
//   ① profile 的 node_modules 可能是**旧版 pnpm 的 store** 链的（`ERR_PNPM_UNEXPECTED_STORE`），
//      所以要**按 store 大版本挑候选**：先读 `<profile>/node_modules/.modules.yaml` 的 storeDir
//      得到目标大版本，再把候选里版本匹配的排到最前；候选依次重试，全失败才放弃。
//   ② 刚发布的新版本常常还不在 pnpm 的**本地元数据缓存**里 ⇒ 必须带
//      `--config.prefer-online=true`，否则会立刻 `No matching version found`。
//   ③ 宿主半是**启动时加载**的 ⇒ 装完不可能自己生效，只能提示「重启 DSH 后生效」；
//      软链安装（link: / 开发目录）不能这样升级 ⇒ 明确拒绝，而不是搞坏它。
//
// 路由（注册在 connection.fetch 上，那条通道自带 Host/Origin 围栏与浏览器会话鉴权）：
//   POST /api/api3d.update-check  → 版本信息 + 能不能自升级 + 用哪个 pnpm
//   POST /api/api3d.update        → { action:'apply', target, confirm } 真正升级（带备份/回滚）
//   POST /api/api3d.update-log    → 最近 40 行升级日志（客户端拿它当安装进度）
//
// 三个路由**一律 200 + body 里的 ok/code**：客户端要读 code 才能把原因翻译成人话，
// 而走 4xx 容易在 fetch 的错误分支里把 body 丢掉。
// ============================================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { exec, execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** 自己的包名 —— 也是要认领的组合包 subject 名。 */
export const PKG_NAME = 'dsh-api3d'

/** 本包根目录（lib/ 的上一级）—— 用来判断「这份是怎么装上的」。 */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** DSH 家目录：宿主会带 DSH_HOME，独立跑（测试）时退回 ~/.dsh。 */
function dshHome() {
  const env = String(process.env.DSH_HOME || '').trim()
  if (env) return env
  try {
    return path.join(os.homedir(), '.dsh')
  } catch {
    return path.join(process.cwd(), '.dsh')
  }
}

const UPDATE_LOG_FILE = path.join(dshHome(), '.api3d-update.log')
const UPDATE_BACKUP_DIR = path.join(dshHome(), '.api3d-update-backup')
const UPDATE_TIMEOUT_MS = 180000

/** 读自己 package.json 里的版本（宿主半的「当前版本」）。 */
let ownVersionCache = ''
export function ownVersion() {
  if (ownVersionCache) return ownVersionCache
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
    ownVersionCache = String(JSON.parse(raw).version || '') || '0.0.0'
  } catch {
    ownVersionCache = '0.0.0'
  }
  return ownVersionCache
}

/** 追加一行升级日志（失败静默：日志写不下去不该影响升级本身）。 */
function appendUpdateLog(text) {
  try {
    fs.mkdirSync(dshHome(), { recursive: true })
    fs.appendFileSync(UPDATE_LOG_FILE, '[' + new Date().toISOString() + '] ' + String(text).slice(0, 2000) + '\n')
  } catch {}
}

/**
 * 这份宿主是「怎么装上的」：profile 依赖 / link 软链 / 开发目录 / 未知。
 *
 * @returns {{real: string, isLink: boolean, hasGit: boolean, profileDir: string, declared: string}}
 */
export function installFacts() {
  let real = PACKAGE_ROOT
  try {
    real = fs.realpathSync(PACKAGE_ROOT)
  } catch {
    real = PACKAGE_ROOT
  }
  let isLink = false
  try {
    isLink = fs.lstatSync(PACKAGE_ROOT).isSymbolicLink()
  } catch {}
  if (!isLink) {
    try {
      if (path.resolve(real) !== path.resolve(PACKAGE_ROOT)) isLink = true
    } catch {}
  }
  let hasGit = false
  try {
    hasGit = fs.existsSync(path.join(PACKAGE_ROOT, '.git'))
  } catch {}
  let dir = PACKAGE_ROOT
  let profileDir = ''
  let declared = ''
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir)
    if (!parent || parent === dir) break
    dir = parent
    try {
      const pj = path.join(dir, 'package.json')
      if (!fs.existsSync(pj)) continue
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
      const deps = Object.assign({}, (j && j.dependencies) || {}, (j && j.devDependencies) || {})
      if (deps[PKG_NAME]) {
        profileDir = dir
        declared = String(deps[PKG_NAME])
        break
      }
    } catch {}
  }
  return {
    real,
    // 软链安装即使被 ESM 解析成真实路径，profile 里的声明仍会是 link:/file:
    isLink: isLink || /^(link:|file:)/.test(String(declared || '')),
    hasGit,
    profileDir,
    declared,
  }
}

/** 把一条 pnpm 路径包装成「怎么起它」。 */
function pnpmCandidateOf(p, kind) {
  const s = String(p || '')
  if (/\.(cjs|mjs|js)$/i.test(s)) return { cmd: process.execPath, args: [s], kind }
  if (/\.(cmd|bat)$/i.test(s)) return { cmd: s, args: [], kind, needsCmd: true }
  return { cmd: s, args: [], kind }
}

/** 从 pnpm 壳（.cmd/.exe）旁边的真实包读版本：纯 fs，不 spawn（路径带空格也不会失败）。 */
function pnpmMajorFromDisk(p) {
  try {
    const dir = path.dirname(String(p || ''))
    const tries = [
      path.join(dir, 'node_modules', 'pnpm', 'package.json'),
      path.join(dir, '..', 'node_modules', 'pnpm', 'package.json'),
    ]
    for (const pj of tries) {
      try {
        const m = /(\d+)\.\d+\.\d+/.exec(String(JSON.parse(fs.readFileSync(pj, 'utf8')).version || ''))
        if (m) return parseInt(m[1], 10)
      } catch {}
    }
  } catch {}
  return 0
}

const pnpmVersionCache = new Map()

function pnpmMajorOf(cand) {
  if (!cand) return 0
  const key = String(cand.cmd) + '|' + (cand.args || []).join(' ')
  const hit = pnpmVersionCache.get(key)
  if (hit && Date.now() - hit.at < 600000) return hit.major
  let major = 0
  if (cand.needsCmd === true || /\.(cmd|bat|exe)$/i.test(String(cand.cmd))) {
    const fromDisk = pnpmMajorFromDisk(cand.cmd)
    if (fromDisk) {
      pnpmVersionCache.set(key, { at: Date.now(), major: fromDisk })
      return fromDisk
    }
  }
  try {
    const run =
      cand.needsCmd === true
        ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', cand.cmd, '--version'], {
            timeout: 8000,
            windowsHide: true,
            encoding: 'utf8',
          })
        : execFileSync(cand.cmd, (cand.args || []).concat(['--version']), {
            timeout: 8000,
            windowsHide: true,
            encoding: 'utf8',
          })
    const m = /(\d+)\.\d+\.\d+/.exec(String(run))
    major = m ? parseInt(m[1], 10) : 0
  } catch {
    major = 0
  }
  pnpmVersionCache.set(key, { at: Date.now(), major })
  return major
}

/** profile 的 node_modules 是哪个 pnpm 大版本装的（`.modules.yaml` 的 storeDir 尾巴）。 */
export function moduleStoreMajor(profileDir) {
  try {
    if (!profileDir) return 0
    const text = fs.readFileSync(path.join(profileDir, 'node_modules', '.modules.yaml'), 'utf8')
    const line = /^\s*storeDir:\s*(.+)$/m.exec(String(text))
    const tail = line ? /v(\d+)\s*$/.exec(String(line[1]).trim()) : null
    return tail ? parseInt(tail[1], 10) : 0
  } catch {
    return 0
  }
}

function orderPnpmForProfile(list, profileDir) {
  try {
    if (!list || list.length < 2) return list
    const want = moduleStoreMajor(profileDir)
    if (!want) return list
    const scored = list.map((c, i) => {
      const major = pnpmMajorOf(c)
      c.major = major
      return { c, i, rank: major === want ? 0 : 1 }
    })
    scored.sort((a, b) => a.rank - b.rank || a.i - b.i)
    return scored.map((x) => x.c)
  } catch {
    return list
  }
}

/**
 * 可用 pnpm 的候选（按「与 profile store 大版本匹配」排序）。
 *
 * `DSHW_PNPM_BIN` 可用路径分隔符给多个（测试用：第一个故意失败，验证会退到第二个）。
 */
export function resolvePnpmCandidates(profileDir) {
  const override = String(process.env.DSHW_PNPM_BIN || '').trim()
  if (override) {
    const out = []
    for (const one of override.split(path.delimiter)) {
      const p = String(one || '').trim()
      if (!p) continue
      try {
        if (fs.existsSync(p)) out.push(pnpmCandidateOf(p, 'override'))
      } catch {}
    }
    if (out.length) return orderPnpmForProfile(out, profileDir)
  }
  const out = []
  // 应用自带的 pnpm（store 天然匹配应用自己的 node_modules 布局）。
  const bundled = []
  try {
    bundled.push(path.join(path.dirname(process.execPath), 'resources', 'app', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
  } catch {}
  try {
    bundled.push(path.join(process.execPath, '..', '..', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'))
  } catch {}
  for (const p of bundled) {
    try {
      if (p && fs.existsSync(p)) {
        out.push({ cmd: process.execPath, args: [p], kind: 'bundled' })
        break
      }
    } catch {}
  }
  // PATH 上的 pnpm：Windows 上 `where pnpm` 会把**无扩展名的 POSIX 壳**排在前面，
  //   Node 起不来（spawn ENOENT）⇒ 跳过无扩展名的，并把 .exe/.cmd/.bat 排前面。
  const foundPath = []
  try {
    const which = process.platform === 'win32' ? 'where.exe' : 'which'
    for (const line of String(execFileSync(which, ['pnpm'], { timeout: 4000, windowsHide: true }) || '').split(/\r?\n/)) {
      const p = line.trim()
      if (!p) continue
      if (process.platform === 'win32' && !/\.[a-z0-9]+$/i.test(p)) continue
      try {
        if (fs.existsSync(p)) foundPath.push(p)
      } catch {}
    }
  } catch {}
  if (!foundPath.length && process.platform === 'win32') {
    const guesses = []
    try {
      if (process.env.APPDATA) guesses.push(path.join(process.env.APPDATA, 'npm', 'pnpm.cmd'))
    } catch {}
    try {
      if (process.env.LOCALAPPDATA) guesses.push(path.join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.cmd'))
    } catch {}
    try {
      if (process.env.ProgramFiles) guesses.push(path.join(process.env.ProgramFiles, 'nodejs', 'pnpm.cmd'))
    } catch {}
    for (const g of guesses) {
      try {
        if (fs.existsSync(g)) foundPath.push(g)
      } catch {}
    }
  }
  const scoreOf = (p) => (/\.exe$/i.test(p) ? 0 : /\.cmd$/i.test(p) ? 1 : /\.bat$/i.test(p) ? 2 : 3)
  const uniqPath = []
  for (const p of foundPath.sort((a, b) => scoreOf(a) - scoreOf(b))) {
    if (uniqPath.indexOf(p) < 0) uniqPath.push(p)
  }
  for (const p of uniqPath.slice(0, 3)) out.push(pnpmCandidateOf(p, 'path'))
  return orderPnpmForProfile(out, profileDir)
}

/** `a` 是否比 `b` 新（只比前三段数字，预发布后缀不参与）。 */
export function isNewerVersion(candidate, current) {
  const norm = (v) =>
    String(v || '')
      .trim()
      .replace(/^v/, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((x) => parseInt(x, 10) || 0)
  const a = norm(candidate)
  const b = norm(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return false
}

/** profile 里**磁盘上**装的版本（可能比本进程的 ownVersion() 新 —— 那说明装好待重启）。 */
export function installedVersionOf(profileDir) {
  try {
    const pj = path.join(profileDir, 'node_modules', PKG_NAME, 'package.json')
    return String(JSON.parse(fs.readFileSync(pj, 'utf8')).version || '')
  } catch {
    return ''
  }
}

let updateInFlight = null

/** 起一次 pnpm（.cmd/.bat 走 cmd.exe，程序与参数作为独立 argv —— 带空格路径才不会被截断）。 */
function spamUpdate(args, cwd, pnpm) {
  return new Promise((resolve) => {
    if (!pnpm) {
      resolve({ ok: false, ms: 0, out: '', errOut: 'pnpm 不可用' })
      return
    }
    const t0 = Date.now()
    let done = false
    const finish = (val) => {
      if (!done) {
        done = true
        resolve(val)
      }
    }
    try {
      let spawnCmd = pnpm.cmd
      let spawnArgs = (pnpm.args || []).concat(args)
      if (pnpm.needsCmd === true) {
        spawnCmd = process.env.ComSpec || 'cmd.exe'
        spawnArgs = ['/d', '/c', pnpm.cmd].concat(args)
      }
      const child = execFile(
        spawnCmd,
        spawnArgs,
        {
          cwd,
          timeout: UPDATE_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
        },
        (err, stdout, stderr) => {
          finish({
            ok: !err,
            code: (err && (err.code || err.signal)) || 0,
            ms: Date.now() - t0,
            out: String(stdout || ''),
            errOut: String(stderr || (err && err.message) || ''),
          })
        },
      )
      child.on('error', (err) =>
        finish({ ok: false, ms: Date.now() - t0, out: '', errOut: String((err && err.message) || err) }),
      )
    } catch (err) {
      finish({ ok: false, ms: Date.now() - t0, out: '', errOut: String((err && err.message) || err) })
    }
  })
}

function backupProfileFiles(profileDir) {
  const saved = []
  try {
    fs.mkdirSync(UPDATE_BACKUP_DIR, { recursive: true })
  } catch {}
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    const from = path.join(profileDir, name)
    try {
      if (!fs.existsSync(from)) continue
      const to = path.join(UPDATE_BACKUP_DIR, name)
      fs.copyFileSync(from, to)
      saved.push({ name, to })
    } catch {}
  }
  return saved
}

function restoreProfileFiles(profileDir, saved) {
  let ok = true
  for (const item of saved || []) {
    try {
      fs.copyFileSync(item.to, path.join(profileDir, item.name))
    } catch {
      ok = false
    }
  }
  return ok
}

/**
 * 真正升级：把本包装进它所在的 profile（候选 pnpm 依次重试，失败回滚）。
 *
 * @param target - 目标版本（形如 `0.2.7`）。
 * @returns 结果对象（`{ok:true,...}` 或 `{ok:false,code,...}`）。
 */
export async function applySelfUpdate(target) {
  const f = installFacts()
  if (f.hasGit || !f.profileDir) {
    return { ok: false, code: 'NOT_MANAGED', error: '这份插件不是通过 profile 安装的（开发目录 / 未在 profile 依赖里）' }
  }
  if (f.isLink) {
    return { ok: false, code: 'LINK_INSTALL', error: '当前是软链安装（link:），请更新本地仓库而不是升级 npm 包' }
  }
  const candidates = resolvePnpmCandidates(f.profileDir)
  if (!candidates.length) {
    return { ok: false, code: 'PNPM_MISSING', error: '找不到可用的 pnpm（应用自带与 PATH 上都没有）' }
  }
  if (updateInFlight) {
    return { ok: false, code: 'BUSY', error: '已有一次升级在进行中（' + updateInFlight + '）' }
  }
  updateInFlight = target
  const saved = backupProfileFiles(f.profileDir)
  const tried = []
  // `--config.prefer-online=true`：刚发布的新版本常常还不在 pnpm 本地元数据缓存里，
  //   不加会立刻 `No matching version found`（实测踩过）。
  const args = [
    'add',
    PKG_NAME + '@' + target,
    '--registry',
    'https://registry.npmjs.org/',
    '--config.prefer-online=true',
    '--reporter',
    'append-only',
  ]
  appendUpdateLog(
    'apply start target=' + target + ' profile=' + f.profileDir + ' pnpm=' + candidates.map((c) => c.kind).join('>'),
  )
  try {
    for (const cand of candidates) {
      const run = await spamUpdate(args, f.profileDir, cand)
      const installed = installedVersionOf(f.profileDir)
      const tail =
        String(run.out || '')
          .split(/\r?\n/)
          .filter((x) => x.trim())
          .slice(-6)
          .join(' | ') + (run.errOut ? ' || ' + String(run.errOut).slice(-400) : '')
      tried.push({ kind: cand.kind, run, tail })
      appendUpdateLog(
        'apply try pnpm=' + cand.kind + ' ok=' + run.ok + ' code=' + run.code + ' ms=' + run.ms + ' installed=' + installed + ' out=' + tail,
      )
      if (run.ok && installed === target) {
        appendUpdateLog('apply done ok=true pnpm=' + cand.kind)
        return {
          ok: true,
          from: ownVersion(),
          to: installed,
          needsRestart: true,
          pnpm: cand.kind,
          pnpmTried: tried.map((x) => x.kind).join(' > '),
          attempts: tried.length,
          ms: run.ms,
          detail: tail,
        }
      }
      if (run.ok && installed !== target) {
        const restored = restoreProfileFiles(f.profileDir, saved)
        appendUpdateLog('apply done ok=false code=VERSION_MISMATCH installed=' + installed)
        return {
          ok: false,
          code: 'VERSION_MISMATCH',
          error: '安装后版本是 ' + (installed || '未知') + '，不是 ' + target,
          detail: tail,
          rolledBack: restored,
          pnpm: cand.kind,
        }
      }
    }
    const last = tried[tried.length - 1] || { run: {}, tail: '' }
    const restored = restoreProfileFiles(f.profileDir, saved)
    appendUpdateLog('apply done ok=false code=PNPM_FAILED tried=' + tried.map((x) => x.kind).join('>'))
    return {
      ok: false,
      code: 'PNPM_FAILED',
      error: '安装失败（pnpm 退出码 ' + ((last.run && last.run.code) || '?') + '，已试 ' + tried.length + ' 个 pnpm）',
      detail: last.tail,
      rolledBack: restored,
      pnpm: tried.map((x) => x.kind).join(' > '),
    }
  } catch (err) {
    const restored = restoreProfileFiles(f.profileDir, saved)
    appendUpdateLog('apply threw ' + String((err && err.message) || err))
    return { ok: false, code: 'SPAWN_FAILED', error: String((err && err.message) || err).slice(0, 200), rolledBack: restored }
  } finally {
    updateInFlight = null
  }
}

/** 带重定向跟随的 https GET（本机 Node 的 fetch 打 registry 会超时，实测必须用 https）。 */
function httpsGetJson(url, timeoutMs, hop) {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (err, val) => {
      if (done) return
      done = true
      if (err) reject(err)
      else resolve(val)
    }
    try {
      const req = https.get(url, { timeout: timeoutMs, headers: { 'user-agent': PKG_NAME, accept: 'application/json' } }, (res) => {
        const code = res.statusCode
        const loc = res.headers && res.headers.location
        if (code >= 300 && code < 400 && loc && (hop || 0) < 3) {
          try {
            res.resume()
          } catch {}
          let next = ''
          try {
            next = new URL(loc, url).toString()
          } catch {
            next = ''
          }
          if (next) {
            httpsGetJson(next, timeoutMs, (hop || 0) + 1).then(
              (v) => finish(null, v),
              (e) => finish(e),
            )
            return
          }
        }
        if (code !== 200) {
          try {
            res.resume()
          } catch {}
          finish(new Error('HTTP ' + code))
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => {
          body += c
          if (body.length > 200000) {
            try {
              req.destroy()
            } catch {}
            finish(new Error('响应过大'))
          }
        })
        res.on('end', () => {
          try {
            finish(null, JSON.parse(body))
          } catch {
            finish(new Error('响应不是 JSON'))
          }
        })
      })
      req.on('timeout', () => {
        try {
          req.destroy()
        } catch {}
        finish(new Error('超时'))
      })
      req.on('error', (e) => finish(e))
    } catch (err) {
      finish(err)
    }
  })
}

/** `npm view` 兜底源（子进程；只在四个 HTTP 源全挂时才用）。 */
function npmCliVersion(timeoutMs) {
  return new Promise((resolve, reject) => {
    try {
      exec('npm view ' + PKG_NAME + ' version', { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        if (err) {
          reject(new Error('npm 退出异常'))
          return
        }
        const lines = String(stdout || '')
          .trim()
          .split(/\r?\n/)
          .filter((x) => x.trim())
        const v = lines.length ? lines[lines.length - 1].trim().replace(/^v/, '') : ''
        if (!/^\d+\.\d+\.\d+/.test(v)) {
          reject(new Error('npm 输出里没有版本'))
          return
        }
        resolve(v)
      })
    } catch (err) {
      reject(err)
    }
  })
}

const UPDATE_SOURCES = [
  { name: 'npmmirror', url: 'https://registry.npmmirror.com/' + PKG_NAME + '/latest' },
  { name: 'jsdelivr', url: 'https://cdn.jsdelivr.net/npm/' + PKG_NAME + '@latest/package.json' },
  { name: 'unpkg', url: 'https://unpkg.com/' + PKG_NAME + '@latest/package.json' },
  { name: 'npmjs', url: 'https://registry.npmjs.org/' + PKG_NAME + '/latest' },
]
const UPDATE_CLI_SOURCE = { name: 'npm-cli' }
const UPDATE_SRC_TIMEOUT_MS = 2200
const UPDATE_CACHE_FRESH_MS = 2 * 60 * 1000
const UPDATE_CACHE_MAX_MS = 6 * 60 * 60 * 1000
let updateCheckCache = null
let updateCheckRefreshing = false
let installInfoCache = null

function installInfoNow() {
  try {
    const f = installFacts()
    const pnpmList = resolvePnpmCandidates(f.profileDir)
    const pnpmNow = pnpmList[0] || null
    return {
      canSelfUpdate: !!(f.profileDir && !f.isLink && !f.hasGit),
      installMode: f.isLink ? 'link' : f.hasGit ? 'dev' : f.profileDir ? 'profile' : 'unknown',
      installProfile: f.profileDir ? '$DSH_HOME/profiles/' + path.basename(f.profileDir) : '',
      installDeclared: f.declared,
      installPnpm: pnpmNow ? pnpmNow.kind : '',
      installPnpmFound: !!pnpmNow,
      installPnpmCandidates: pnpmList.map((c) => c.kind),
      installPnpmMajors: pnpmList.map((c) => pnpmMajorOf(c)),
      installStoreMajor: moduleStoreMajor(f.profileDir),
    }
  } catch {
    return null
  }
}

function warmInstallInfo(force) {
  if (!force && installInfoCache && Date.now() - installInfoCache.at < 600000) return
  setTimeout(() => {
    const info = installInfoNow()
    if (info) installInfoCache = { at: Date.now(), info }
  }, 0)
}

/**
 * 响应路径上用的装机信息：**便宜的一半同步算**（profile 归属 / 软链 / .git，纯 fs），
 * 贵的部分（spawn `pnpm --version` 排序）留给后台预热。冷启动也不"乐观放行"。
 */
function installInfoForPayload() {
  if (installInfoCache && Date.now() - installInfoCache.at < 600000) return installInfoCache.info
  warmInstallInfo(false)
  try {
    const f = installFacts()
    return {
      canSelfUpdate: !!(f.profileDir && !f.isLink && !f.hasGit),
      installMode: f.isLink ? 'link' : f.hasGit ? 'dev' : f.profileDir ? 'profile' : 'unknown',
      installInfoPending: true,
    }
  } catch {
    return { canSelfUpdate: false, installInfoPending: true }
  }
}

/**
 * 问版本：四个 HTTP 源并行，成功源里取**最高版本**（镜像会滞后/缓存，先答先用会误报"已是最新"）。
 *
 * @returns 版本信息载荷。
 */
export async function fetchUpdatePayload() {
  const results = await Promise.all(
    UPDATE_SOURCES.map(async (src) => {
      const t0 = Date.now()
      const attempt = async () => {
        const j = await httpsGetJson(src.url, UPDATE_SRC_TIMEOUT_MS, 0)
        const latest = String((j && j.version) || '')
        if (!latest) throw new Error('返回里没有 version')
        return latest
      }
      try {
        return { ok: true, name: src.name, latest: await attempt() }
      } catch (err1) {
        const fast = Date.now() - t0 < 1200
        if (!fast) return { ok: false, name: src.name, why: String((err1 && err1.message) || err1).slice(0, 40) }
        try {
          return { ok: true, name: src.name, latest: await attempt() }
        } catch (err2) {
          return { ok: false, name: src.name, why: String((err2 && err2.message) || err2).slice(0, 40) }
        }
      }
    }),
  )
  let oks = results.filter((r) => r.ok)
  if (!oks.length) {
    try {
      results.push({ ok: true, name: UPDATE_CLI_SOURCE.name, latest: await npmCliVersion(5000) })
    } catch (err) {
      results.push({ ok: false, name: UPDATE_CLI_SOURCE.name, why: String((err && err.message) || err).slice(0, 40) })
    }
    oks = results.filter((r) => r.ok)
  }
  let payload = null
  if (oks.length) {
    let hit = null
    for (const r of oks) if (!hit || isNewerVersion(r.latest, hit.latest)) hit = r
    const bySource = {}
    for (const r of oks) bySource[r.name] = r.latest
    const factsNow = installFacts()
    let installedDisk = ''
    try {
      installedDisk = factsNow.profileDir ? installedVersionOf(factsNow.profileDir) : ''
    } catch {
      installedDisk = ''
    }
    const cmpBase = installedDisk || ownVersion()
    payload = {
      ok: true,
      current: ownVersion(),
      installed: installedDisk,
      latest: hit.latest,
      hasUpdate: isNewerVersion(hit.latest, cmpBase),
      pendingRestart: !!(installedDisk && installedDisk !== ownVersion()),
      source: hit.name,
      sources: bySource,
      checkedAt: Date.now(),
    }
  } else {
    payload = {
      ok: false,
      current: ownVersion(),
      error: results.map((r) => r.name + '：' + r.why).join('；'),
      tried: UPDATE_SOURCES.map((s) => s.name).concat([UPDATE_CLI_SOURCE.name]),
    }
  }
  Object.assign(payload, installInfoForPayload())
  return payload
}

/** update-check 的缓存包装：2 分钟内算新鲜；更旧「先回旧值、后台刷新」。 */
export async function updateCheckPayload() {
  const now = Date.now()
  const cached = updateCheckCache
  if (cached && now - cached.at < UPDATE_CACHE_MAX_MS) {
    if (now - cached.at > UPDATE_CACHE_FRESH_MS && !updateCheckRefreshing) {
      updateCheckRefreshing = true
      Promise.resolve()
        .then(fetchUpdatePayload)
        .then((p) => {
          updateCheckCache = { at: Date.now(), payload: p }
        })
        .catch(() => {})
        .then(() => {
          updateCheckRefreshing = false
        })
    }
    return cached.payload
  }
  let payload = null
  try {
    payload = await fetchUpdatePayload()
  } catch (err) {
    payload = { ok: false, current: ownVersion(), error: String((err && err.message) || err) }
  }
  try {
    updateCheckCache = { at: Date.now(), payload }
  } catch {}
  return payload
}

/** 读最近 40 行升级日志（客户端拿它当安装进度）。 */
export function updateLogPayload() {
  let text = ''
  try {
    text = fs.readFileSync(UPDATE_LOG_FILE, 'utf8')
  } catch {
    text = ''
  }
  const lines = text ? text.split(/\r?\n/).filter(Boolean).slice(-40) : []
  return { ok: true, found: !!text, file: '$DSH_HOME/' + path.basename(UPDATE_LOG_FILE), lines }
}

/**
 * 把三条更新路由注册进 connection 的鉴权围栏。
 *
 * @param connection - 宿主 `connection` 服务。
 * @returns void
 */
export function registerUpdateRoutes(connection) {
  const json = (body) => Response.json(body, { headers: { 'cache-control': 'no-store' } })
  connection.fetch.register({
    path: '/api/api3d.update-check',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => json(await updateCheckPayload()),
  })
  connection.fetch.register({
    path: '/api/api3d.update',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let input = {}
      try {
        const value = await request.json()
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) input = value
      } catch {}
      if (String(input.action || '') !== 'apply') {
        return json({ ok: false, code: 'BAD_ACTION', error: 'action 只支持 apply' })
      }
      const target = String(input.target || '')
        .trim()
        .replace(/^v/, '')
      if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$/.test(target)) {
        return json({ ok: false, code: 'TARGET_INVALID', error: '目标版本号无效：' + target.slice(0, 32) })
      }
      if (
        String(input.confirm || '')
          .trim()
          .replace(/^v/, '') !== target
      ) {
        return json({ ok: false, code: 'CONFIRM_REQUIRED', error: '缺少确认（confirm 必须等于目标版本）' })
      }
      if (!isNewerVersion(target, ownVersion())) {
        return json({ ok: false, code: 'ALREADY_LATEST', error: '目标 ' + target + ' 不高于当前 ' + ownVersion() })
      }
      const result = await applySelfUpdate(target)
      return json(Object.assign({ current: ownVersion() }, result))
    },
  })
  connection.fetch.register({
    path: '/api/api3d.update-log',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => json(updateLogPayload()),
  })
}
