# 参与开发

## 本地跑起来

```bash
npm install          # devDependencies: js-yaml / react / @deepseek-ai/schemastery
npm test             # node --test "test/*.test.mjs"（109 个用例）
```

装进本机 DSH 试：

```bash
dsh plugin --profile web add link:<本目录绝对路径>      # 软链安装，改源码即生效（前端 Ctrl+F5）
```

## 提交前必须过的检查

CI（`.github/workflows/ci.yml`）会跑同一组，本地照着走一遍即可：

```bash
for f in lib/index.js lib/client.js lib/direct-fetch.js lib/route.js lib/site.js; do node --check "$f"; done
grep -nE 'E:\\DSH|DSH-Test|TestBox|C:\\Users\\Administrator' lib/*.js cordis.patch.yml package.json README.md README.en.md   # 必须无输出
npm test
npm pack --dry-run    # 确认 files 白名单与 dsh.bundle.patch 指向的文件都在包里
```

## 约定

- **密钥永远不进仓库**：站点密钥存在 `$DSH_HOME/.credentials.yaml`，`cordis.patch.yml`
  里只写**凭据引用**（`apiKeyEnv`），不要写进 `headers`（那会被适配器的 `describe()` 原样返回并渲染到设置页）。
- **站点地址只有一处真源**：`lib/site.js`。默认值、向导、README 都以它为准，不要在别处再写一遍字面量。
- **模型目录不能凭厂商名猜**：用 `npm run probe-models` 打 `GET {baseURL}/models` 与站点自报的 id 做 diff，
  再更新 `cordis.patch.yml`。分组不同 = 凭据不同 = 应当是另一条 provider 路由。
- **签入的文件一律 LF**（见 `.gitattributes`）；提交前不要留下开发机绝对路径（CI 会拦）。
- **发版**：改 `package.json` 的 `version`（semver，不能与 npm 上已发布的版本重复）→ push →
  在 Actions 里手动 Run `publish.yml`（支持 dry_run 演练）。日常 push 的检查由 `ci.yml` 负责。
- **衍生与许可**：本项目按 MIT 发布，衍生说明见 `NOTICE`；改动涉及上游骨架时请在 `NOTICE` 里同步。
