# dsh-api3d

[![npm](https://img.shields.io/npm/v/dsh-api3d?label=npm)](https://www.npmjs.com/package/dsh-api3d)
[![license](https://img.shields.io/github/license/ptb-xiaou/dsh-api3d)](https://github.com/ptb-xiaou/dsh-api3d/blob/main/LICENSE)

[中文](README.md) · **English**

> 📦 Repository: [ptb-xiaou/dsh-api3d](https://github.com/ptb-xiaou/dsh-api3d) ｜ npm: [dsh-api3d@0.2.3](https://www.npmjs.com/package/dsh-api3d) ｜ [Release v0.2.3](https://github.com/ptb-xiaou/dsh-api3d/releases/tag/v0.2.3) ｜ MIT (derivation notes in [NOTICE](NOTICE))

Wires the **API3D ([api3d.cn](https://api3d.cn))** relay into DeepSeek Harness as one
pi-ai route. The base URL, the API key and the outbound-compatibility switches all live
on the plugin's settings card — no file editing, no reinstall. The site address is already
baked into `lib/site.js`, so it works out of the box.

This is a **skeleton**: the core path (route survival + outbound fence + credential write +
settings card + key/model wizard) is complete and runnable. The four ops rows — balance /
usage / billing / health probe — have explicit seams waiting to be filled.

Once installed, a new **API3D** row appears in the sidebar right below **Plugins**: enter
your key once, tick the models the site serves, and you are done. See
[the key and model wizard](#key-and-model-wizard).

## Design tradeoffs

In one sentence: **the protocol, the model catalog and the reasoning tiers are
configuration, not code; the plugin exists only to make the relay actually accept the
request.**

- **No custom `LlmAdapter`.** Writing a provider adapter means reimplementing the whole
  harness ↔ pi-ai translation layer (the official one is ~1000 lines: context assembly,
  StreamChunk translation, replay state, context-overflow detection). Not worth it for a
  single site. So the route is still **executed by the official adapter** — it is simply not
  hard-coded in the patch layer: the host half installs one `llm-pi-ai.providers.api3d` into
  the config that is being resolved.
- **No "empty route" declaration.** pi-ai rejects a custom route that resolves to no models
  at all (validation reports *resolves no models; the installed catalog does not describe
  this route*). So **while nothing has been imported, this plugin declares no provider at
  all**: no API3D entry appears under Settings → Models, and no API3D group appears in the
  model picker. The route shows up once the wizard imports a catalog, and the picker follows
  immediately — no restart.
- **Runtime assembly has two traps, and this plugin exists for them** (below).

### Trap 1: the profile patch layer replaces the whole route

A profile's own `llm-pi-ai.providers` patch is applied **after every bundle layer**, and the
loader merges one level deep: the patch's `config` is an **assignment**, not a deep merge,
so the entire `providers` dictionary is replaced. Any profile that ships its own provider
(the `desktop` profile that DSH itself distributes does) loses the route this plugin
declares.

The host half cannot observe when that happens, so it hooks the resolution:
`ctx.on('internal/config', …, { global: true })` puts the route carrying the **imported
catalog** back, then `ctx.get('loader')` finds the `llm-pi-ai` entry and
`entry.update({ config })` writes it home (there is also one attempt at startup). With no
imported catalog that whole step is skipped — no route is installed and nobody else's
same-name route is touched.

> Why not write it once: the host profile's watcher re-reads the patch file seconds after
> startup and rolls a one-shot write back. It has to be re-applied on every resolution.

When it puts the route back it uses **"this plugin's own declaration wins"** semantics
(`replace`): if the resolved `providers` already contains `api3d`, the hook skips the write
when the value is identical (no needless write, which would otherwise trigger a resolution
storm of its own) and replaces the whole route otherwise. There is an easy trap here: the
**first argument of an `internal/config` listener is the host's resolved `llm-pi-ai` config,
not this plugin's settings** — the two were once named the same, so every resolution stamped
the template's default catalog back over the imported one, which showed up as "the models are
imported but the selector only ever offers one". The parameter names are now distinct, the
route to install is always computed from the plugin's settings (`routeValue`), and the claim
path no longer returns early just because a same-name route already exists.

### Trap 2: baseURL is resolved per request, but the adapter cannot see this plugin's settings

Two namespaces. So the route's `baseURL` points at a host that deliberately does not exist
(`upstream.api3d.invalid`, an RFC 2606 reserved TLD), and the fence rewrites it to the real
address from settings on the way out.

The upside of that detour is that "switch data centre" becomes one write on the settings
card. The downside is that **the fence must be on the request path** for every real
endpoint — otherwise DNS fails loudly (deliberately loud: much better than silently
hitting some real server).

The fence also carries the outbound compatibility a relay usually needs:

| Outbound compatibility | Why it is needed |
| --- | --- |
| rewrite baseURL | see above |
| optional `User-Agent` replacement | some sites authenticate by UA, while the adapter strips profile headers that conflict with its own attribution header |
| optional direct connection (bypass the process proxy) | site WAFs commonly challenge data-centre egress IPs and answer with 200 HTML instead of SSE |
| optional `required: []` fill-in | when the site forwards to a strict upstream, tool schemas without `required` are rejected |
| optional silent retry | relays forward across multiple channels, and some channels turn a retryable request into a 400 |
| 402 quota hint | sites report exhausted quota with 402 plus a JSON body mislabelled `text/event-stream` |

## Layout

| Path | Purpose |
| --- | --- |
| `lib/site.js` | **single source of identity constants**: package name, row id, provider name, sentinel host, default credential reference. Change this first when moving to another site |
| `cordis.patch.yml` | bundle patch layer: **inserts the plugin row only** (`- insert:`). The route is not declared here — see "Design tradeoffs" |
| `lib/index.js` | host half: fence, route survival, quota annotation, settings namespace |
| `lib/client.js` | browser half: settings card (base URL, API key, compatibility switches, reserved ops rows), sidebar entry, key/model wizard |
| `lib/route.js` | **hand-written**: `ROUTE` (route skeleton, **no `models`**) and `MODEL_TEMPLATE` (the wizard's per-row capability initial values) |
| `lib/direct-fetch.js` | direct transport (`node:http`/`node:https`, bypassing the process proxy) |
| `scripts/probe-models.mjs` | one real `GET {baseURL}/models` with a real key, diffed against the catalog **already imported into settings** |
| `test/` | 118 assertions, see below |

## Install and distribution

Install into a profile. [中文](README.md)

| Route | Command | Notes |
| --- | --- | --- |
| **npm** | `dsh plugin --profile web add dsh-api3d` | published as **`dsh-api3d@0.2.3`**; lookup order: the registry configured in the profile, then `registry.npmmirror.com` |
| **GitHub** | `dsh plugin --profile web add github:ptb-xiaou/dsh-api3d` | `lib/` in the repo is the built artifact — there is no build step, so it runs as installed |
| **tarball** | `dsh plugin --profile web add https://registry.npmjs.org/dsh-api3d/-/dsh-api3d-0.2.3.tgz` | an absolute local `.tgz` path works too; a GitHub Release can carry the same tgz |
| **local path** | `dsh plugin --profile web add E:\path\to\dsh-api3d` | for development; install into an isolated instance, not into the one you are working in |

**Restart DSH afterwards**: the plugin row is part of the boot graph, so hot reload does
not pick it up.

Three facts verified on clean isolated instances through the real install path, twice over —
once with the tarball produced by `npm pack`, once through the npm channel (`add dsh-api3d`;
both boots printed the plugin's own `api3d: …` startup line):

1. `add` appends `dsh-api3d` to that profile's `package.json`
   `dsh.profile.bundles` by itself — no hand-editing — and writes `dependencies` too.
2. The installed package is a **real directory** at
   `profiles/<profile>/node_modules/dsh-api3d`, and **it needs no `node_modules` of its
   own**: the host half's `import '@deepseek-ai/schemastery'` is routed by the profile's
   resolution layer to the copy the app ships. Only local development (plugin outside the
   profiles tree) needs host dependencies linked by hand — see
   [Development](#development).
3. The browser half is picked up as well: the HTML the instance serves lists `dsh-api3d`
   in its module manifest (`url: plugins/??dsh-api3d/client.js&rev=…`, with an `inject`
   list). Right after installing, before anything is imported, the startup log prints
   `api3d: 尚未导入模型 → 暂不声明 api3d 路由`; after an import it prints
   `api3d: 路由 api3d → https://api3d.cn/v1，模型目录 N 个（从站点导入）：…`.

About the **version compatibility gate**: the plugin manager checks every
`peerDependencies` entry whose name starts with `@deepseek-ai/dsh` against the running DSH
version and refuses the install when it does not match (unless an exact-version exemption
is granted in the profile's `compatibility.json`). This package only declares
`@deepseek-ai/cordis` / `@deepseek-ai/schemastery`, which the gate does not look at, so it
never blocks an install — at the cost of **no runtime version assertion**: if a major DSH
upgrade breaks the plugin, please open an issue.

> **Security note**: this package's host half runs inside the DSH process, is **not
> confined by the workspace sandbox**, and does receive your API key. Read `lib/index.js`
> before installing.

### Releasing (maintainers)

`lib/` (including the hand-written `lib/client.js` and `lib/route.js`) is a
**committed artifact**, which is why `github:` installs need no build step.

- **npm**: published as **`dsh-api3d@0.2.3`** (`latest` on the official registry).
  `npm pack` was checked to contain
  exactly 15 files — 5 under `lib/` plus `cordis.patch.yml`, `README.md`, `README.en.md`,
  `LICENSE`, `NOTICE`, `package.json` and the four wizard screenshots under `docs/`
  (322.2 kB packed / 466.3 kB unpacked); `test/` and `scripts/` are kept out by the
  `files` allowlist (`docs/` joined it in 0.2.1 — otherwise the README screenshots are
  broken on the npm page). Release with a
  token that may publish directly; if the account is required to stage publishes,
  `npm publish` fails with `E_STAGE_REQUIRED` and you need
  `npx npm@11 stage publish` plus `stage approve` (the approval needs 2FA). If the name is
  taken on npm, switch to a scoped name and update the commands in this document.
- **Always verify after publishing**, and query the official registry:
  `npm view dsh-api3d dist-tags --registry=https://registry.npmjs.org/` (or read
  `https://registry.npmjs.org/dsh-api3d` directly). The machine's global npmrc points its
  registry at `registry.npmmirror.com`, which syncs slowly and incompletely — `npm view`
  once still reported `latest: 0.1.1` long after 0.2.1 was live, which nearly got this
  document corrected the wrong way. Also, `npm publish` printing `+ dsh-api3d@x.y.z` only
  means the publish was **accepted** (the same output says `being processed`): the packument
  appears first and the tarball starts returning 200 from the CDN only a few minutes later.
  Treat the official registry's `dist-tags` plus the `dist.shasum` of the version as proof
  of a live release, not that `+` line.
- **GitHub Releases**: upload the tgz `npm pack` produces, and users can install it with
  the tarball route above.
- Before tagging, run `npm test` (118 assertions).

## Key and model wizard

After installing you do **not** have to know any field names first: a new **API3D** row
appears under **Plugins** in the sidebar; clicking it opens the wizard (it pops up
automatically the first time the panel is opened and no models have been imported yet):

1. Enter the site key (the base URL is pre-filled with `https://api3d.cn/v1`) and click
   **确认并查询模型** ("confirm and query models"). If you do not have a key yet, the line
   **"还没有 API Key？前往 api3d.cn 获取"** under the input opens the site's signup page in
   your system browser (the host treats it as an external link; it does not run an embedded
   window).
2. The host half takes that key to `GET {baseURL}/models` and lists the models the site
   actually serves.
3. Tick the ones you want and click **导入所选模型** ("import selected models").

**Step 2 lists more than names.** Every row carries a capability summary (shaped like
`输入 文本 · 上下文 1,000,000 · 最大输出 384,000 · 5 档推理`), and the **调整能力** ("adjust
capabilities") button at the end of the row expands a per-model editor:

| Control | Field it writes into the route descriptor | Initial value |
| --- | --- | --- |
| Input: 文本 / 图像 (text / image) | `input` | `text` only |
| Context (上下文) | `contextWindow` | the capability template's value (1,000,000) |
| Max output (最大输出) | `maxTokens` | same source (384,000) |
| Reasoning levels: 关闭 / minimal / low / medium / high / xhigh / max | `reasoningEfforts` | the capability template's six levels (`off` = offer Off but send nothing) |

Capabilities are **per row**: editing one row leaves the others alone and never mutates the
capability template (`MODEL_TEMPLATE` in `lib/route.js`). Leaving a number box empty means
"use the template's value".

One caveat matters here: `api3d.cn`'s `/v1/models` returns only `id` and `display_name` — no
input modalities, no context window, no reasoning levels. So the initial values come from
this plugin's capability template (`MODEL_TEMPLATE`), **not from anything the site declared**. Confirm the site
really supports image input or an extra level before ticking it, or the upstream will reject
the request. The legal vocabulary is defined by DSH's `dsh-llm-pi-ai` adapter: modalities are
only `text` / `image`, levels are only `off` / `minimal` / `low` / `medium` / `high` /
`xhigh` / `max`, and anything else is rejected at execution time. Capability fields the site
**does** report (`input`, `input_modalities`, `context_window`, `max_input_tokens`,
`limit.context`, `max_output_tokens`, `top_provider.max_completion_tokens`, and similar
spellings) are adopted as-is; only what the site stays silent about falls back to the
defaults — "did not say" and "said it does not support" are different things and never
impersonate each other.

Import does three things: writes the key into `$DSH_HOME/.credentials.yaml`, writes the
ticked catalog (each entry with its own capabilities) into this plugin's `models` setting,
and has the host install that catalog as the `llm-pi-ai` route. The model picker sees them
immediately, with no restart — before the first import neither Settings → Models nor the
picker has an API3D entry at all.

`/api/api3d.apply` takes the catalog in its **request body** instead of re-reading the plugin
setting, so even if that setting has not been re-resolved yet, what gets installed is exactly
what was just ticked; the resolution-time hook then overwrites any same-name `api3d` route
with the same catalog from settings (this plugin's own version wins).

Why the query goes through the host: `api3d.cn`'s `/v1/models` returns no
`access-control-*` headers at all, so a direct browser request is blocked by the
cross-origin preflight with a 403. The two host routes behind the wizard are:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/api3d.models` | POST `{apiKey, baseURL?}` | query the site's model catalog host-side; returns the normalized catalog (including any input modalities / context / max output / reasoning levels the site really reports) plus a set of `defaults` (the seed for each wizard row) |
| `/api/api3d.apply` | POST | install the catalog already stored in settings back into the `llm-pi-ai` route |

Both are registered on `connection.fetch`'s exact-route table, so they automatically carry
DSH's Host/Origin fence and browser session authentication; unauthorized requests never
reach the handlers.

The fields on the settings card still work (an equivalent entry point). The wizard just
automates "enter the key + pick the models"; the outbound compatibility switches (UA,
direct connection, schema fill-in, silent retry, quota hint) stay on the settings card.

This path has been run end to end in an isolated development instance with a real key
(enter key → query → tick → import):

| Step 1: enter the key | Step 2: tick models | Import done |
| --- | --- | --- |
| ![Entering the API key](docs/wizard-step1-key.png) | ![Ticking the models to import](docs/wizard-step2-models.png) | ![Import finished](docs/wizard-step3-done.png) |

Step 2 with **调整能力** expanded (again from a real site with a real key; this row had its
input modalities, context window and max output edited):

![Editing input modalities, context window, max output and reasoning levels per model](docs/wizard-step2-caps.png)

After importing, restarting the development instance changes the log line from
`尚未导入模型 → 暂不声明 api3d 路由` to `模型目录 N 个（从站点导入）：…`, which proves the
catalog really was persisted and read back. Without a restart, `/api/api3d.apply` installs
the route on the spot and the picker already shows it — both paths were verified on a real
instance.

## Configuration

After installing, find the plugin on the **Plugins** page and fill in its settings card:

| Field | Default | Notes |
| --- | --- | --- |
| base URL `baseURL` | `https://api3d.cn/v1` | the site address, already filled in. **Clearing it explicitly is not "use the default": the fence stops rewriting, requests hit the sentinel host and DNS fails** |
| credential reference `apiKeyEnv` | `API3D_API_KEY` | the **key name** of where the secret is stored, not the secret. Must match `apiKeyEnv` in `lib/route.js` |
| API key | — | a separate button writes it into `~/.dsh/.credentials.yaml`. Write-only; no read path ever fetches it back |
| imported catalog `models` | empty = no route declared | the JSON catalog written by the wizard, **not meant to be typed by hand**. While empty, neither Settings → Models nor the model picker has an API3D entry; clearing it needs one restart to withdraw an already installed route |
| User-Agent | empty | empty keeps the harness attribution header (recommended). Fill it only when the site explicitly demands a value |
| direct policy `directMode` | `auto` | `auto` = connect directly only when the process really has proxy variables set; `always` / `never` are for troubleshooting |
| fill tool schema | on | adds `required: []` to object nodes of outbound tool schemas |
| silent retry `silentRetry` | off | resend inside the plugin when the site rejects a request as an upstream transient error. Off by default: silently hiding a real 400 trades a visible error for a confusing empty turn |
| retry attempts `silentRetryAttempts` | 3 | including the first send, 1–10 |
| quota hint `quotaHint` | empty | text appended to a 402 quota-exhausted error. Empty disables it |

`claimRoute` (default on) and `announce` (default on) are not settings-card fields; change
them in `cordis.patch.yml` or in a profile patch.

### Moving to another site

(API3D's address and capabilities are already filled in; read this only when switching site or
channel.)

The catalog is **not in the code**: it comes from what the wizard imported (stored in the
plugin's `models` setting). The models the site serves, and each one's capabilities (input
modalities / context / max output / reasoning levels), are written by the wizard;
`MODEL_TEMPLATE` in `lib/route.js` only provides each row's initial values.

Measured on 2026-10-20: `GET https://api3d.cn/v1/models` returns `deepseek-v4.1-flash`.
**`deepseek-v4.1-flash-1017` on api3d.cn belongs to a welfare group and needs a different
key** (`SUB2API_ONLINE_WELFARE_KEY`); asking for it with the main key returns
`404 model_not_found`. A different group means different credentials, which should be a
separate provider route — it must not be merged into the same route's model list, which is
why the wizard only lists the models this key can actually use.

Verify before editing the catalog, and do not guess from the vendor name:

```bash
npm run probe-models                      # GET {baseURL}/models with $API3D_API_KEY
npm run probe-models -- --ref SUB2API_API_KEY   # or take a reference from the credential store
npm run probe-models -- --profile desktop       # pick which profile's imported catalog to read
```

The script performs one read-only GET, diffs the site's self-reported ids against the catalog
**already imported into settings**, and prints what is missing. To change the catalog, use the
wizard (sidebar API3D → re-pick models) — no file editing.

1. **The model catalog** — import it through the wizard; it lands in the plugin's `models`
   setting, capabilities included. The route is assembled by the host half at resolution
   time, and `ROUTE` in `lib/route.js` keeps only site-independent scaffolding (provider name,
   sentinel host, `apiKeyEnv`, `api`, `defaultInput`, `compat`).
2. **The spelling of `reasoningEfforts`** — the key is the tier offered by the picker, the
   value is the `reasoning_effort` actually sent. The wizard lays out six levels from
   `MODEL_TEMPLATE`; `off` = offer Off and send nothing. Some sites demand an explicit `none`
   and reject `off`; adjust per model in the wizard.
3. **`lib/site.js`** — only needed if you want to change the sentinel host, the default
   credential reference or the provider name. Afterwards just run `npm test`
   (`route.test.mjs` checks it against `lib/route.js`).

## Reserved seams: balance / usage / billing / health probe

The settings card already has four placeholder rows: **balance / usage / billing / health
probe**, currently rendering "not wired".

The seam's granularity is the **row**, not the number: `OPS_ROWS` defines which rows exist,
and all values go through `opValue`. Wiring real data touches `opValue` only, never the
layout.

Two implementation routes:

- **Management-plane only (do this first)** — if you have something like
  `GET /api/user/balance`, write a plain management-plane plugin: `Config` +
  `slots.register` card + one host-side polling fetch. No provider registration and no
  touching `globalThis.fetch`.
- **Remote service** — when the browser half needs on-demand queries, the host half extends
  `@deepseek-ai/dsh-typert-protocol`'s `TypertRemoteService`
  (`super(ctx, serviceKey, { namespace })` + `@Remote` decorated methods) and the browser
  half calls `ctx.remote.$mount(…)` itself. The constraints are strict: the descriptor's
  codec must be `mode: 'strict'` (otherwise `$mount` throws), host method parameters must be
  plain identifiers, and `signal` may only come last. `@deepseek-ai/dsh-typert-generator` is
  not installed on this machine, so descriptors have to be hand-written — which is why this
  skeleton does not do it yet.

## Development

```bash
npm run probe-models  # diff the site's real ids against the imported catalog
npm test              # node --test "test/*.test.mjs" (118 assertions)
```

Dependencies are **junction-linked to the host's `node_modules`**
(`@deepseek-ai/schemastery` / `js-yaml` / `react`), because harness packages must be the
host's **same instance** (`instanceof` safety) and cannot be installed as a real copy from
the registry. `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` are declared as optional
peers.

Test coverage:

| File | Coverage |
| --- | --- |
| `route.test.mjs` | the patch layer no longer declares a route, `ROUTE` carries no `models`, the `MODEL_TEMPLATE` vocabulary, and the hook's fill / replace / leave-alone-when-empty semantics |
| `fence.test.mjs` | fence: rewriting, allowlist, pass-through of non-target requests, cleanup restoring only this plugin's fetch |
| `tool-schema.test.mjs` | `required: []` fill-in and skipping `strict: true` |
| `silent-retry.test.mjs` | transient-failure classification, backoff, attempt ceiling |
| `claim.test.mjs` | `entry.update` write-back; the three owners of a same-name route (ours / someone else's / missing); **an imported catalog overriding a same-name route declared elsewhere**; **no route declared at all while nothing is imported**; no write when the value is unchanged |
| `direct-transport.test.mjs` | direct transport against a real loopback stand-in: header fidelity, no redirect following, abort tearing down the connection |
| `integration.test.mjs` | **end to end**: fence + direct transport really deliver the request to a TCP server; the boundaries of 402 quota annotation |
| `client-bundle.test.mjs` | browser-half loading contract: both halves' settings namespaces must be literally equal, six slots (including the sidebar entry and the `shell.overlay` wizard), dictionaries, the address and `target`/`rel` of the wizard's "get one at api3d.cn" link, and **the form controller keeping `this` when it is provided as prototype methods** (a real-machine crash regression) |
| `models.test.mjs` | the wizard's host half: catalog normalization (including capability fields the site reports, the "absent means do not invent" boundary, and the capability round-trip), `discoverModels` failure classification and `defaults`, per-model capability overrides that leave the template untouched, `applyImportedModels` write-back, registration and auth boundaries of the two `/api/api3d.*` routes |

## Known limitations

- **Single site.** Only one base URL is supported. For several sites use a generic gateway
  provider plugin.
- **The model catalog comes only from the wizard.** It lives in the plugin's `models` setting
  (and therefore in the profile patch layer, so it survives a restart), and each entry may
  carry its own `input` / `contextWindow` / `maxTokens` / `reasoningEfforts`. **While nothing
  is imported no route is declared at all** — pi-ai does not allow a model-less route — so a
  freshly installed plugin shows no API3D in the picker; clearing the setting needs one
  restart to withdraw an already installed route. The adapter's own automatic discovery is
  still unused — it would discover against the sentinel host and fail; see trap 2.
- **Capability initial values come from this plugin's template, not the site's declarations.**
  `api3d.cn`'s `/v1/models` reports no capabilities, so the context window, max output and
  reasoning levels shown in the wizard come from `MODEL_TEMPLATE` and must be adjusted per
  model to match what the site really does; ticking something the site does not support is
  rejected upstream.
- **The key is written by the wizard.** The wizard writes it into `$DSH_HOME/.credentials.yaml`
  as `API3D_API_KEY`; you can also enter it by hand on the settings card or under
  Settings → Models → API3D, and the two paths are equivalent. The "clear key" button only
  appears once a key is configured.
- **Balance / usage / billing / health probe are not wired.** The seams are in place, see
  above.
- **`directMode: never` fails when the site's WAF blocks data-centre egress.** That is the
  expected behaviour.

## Origin and license

MIT. Derived from [aqiu817/dsh-llm-agentrouter](https://github.com/aqiu817/dsh-llm-agentrouter)
(MIT, Copyright (c) 2026 aqiu817) — the fence, route self-healing, silent retry, direct
transport and settings-card skeleton come from that project, restructured for the
single-site case with credential writing and the ops seams added. `LICENSE` stays the
standard MIT text (including the original copyright notice) while the derivation and
reference-implementation notes live in `NOTICE` — that way GitHub's license detection
still reports MIT without dropping the attribution.

The reference implementation [Luck9Star/dsh-gateway-provider](https://github.com/Luck9Star/dsh-gateway-provider)
(MIT, Copyright (c) 2026 Luck9Star) provided the "register a provider route at runtime"
route; this skeleton assembles its route at runtime too (installed on demand, nothing
declared while empty), for the reasons at the top.
