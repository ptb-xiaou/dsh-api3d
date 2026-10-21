window.__ModuleLoader__.load({
	id: "dsh-api3d",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region locales
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			title: "API3D",
			panel: "API3D",
			panelTitle: "API3D 接入",
			panelHint: "点右侧按钮打开向导：填 API Key → 确认后列出站点可用的模型 → 勾选导入。",
			panelConfigure: "打开配置向导",
			panelReconfigure: "重新选择模型",
			panelNoModels: "还没有导入模型。点「打开配置向导」填写 API Key，DSH 会列出站点可用的模型。",
			panelModelsTitle: "已导入的模型",
			description: "把 API3D（api3d.cn）接成 DSH 的模型路由：基础地址、API Key 与出站兼容开关都在这里填。侧边栏的 API3D 面板可以一键导入站点模型。保存后下一个请求生效，模型列表不受影响。",
			baseUrl: "基础地址",
			baseUrlHint: "默认 https://api3d.cn/v1。填在路由上的只是一个哨兵主机名，本字段在出站时把它改写掉。",
			baseUrlPlaceholder: "https://api3d.cn/v1",
			apiKey: "API Key",
			apiKeyHint: "密钥写在 ~/.dsh/.credentials.yaml 里，不会回传到本页面。引用名由下方「凭据引用名」决定。",
			apiKeyPlaceholder: "sk-…",
			apiKeyConfigured: "已配置",
			apiKeyMissing: "未配置",
			apiKeySave: "保存密钥",
			apiKeySaving: "保存中…",
			apiKeySaved: "已保存",
			apiKeyFailed: "保存失败，请检查密钥格式。",
			apiKeyClear: "清除密钥",
			apiKeyCleared: "已清除",
			apiKeyEnv: "凭据引用名",
			apiKeyEnvHint: "密钥的存放键名，必须与补丁层路由的 apiKeyEnv 一致。改这里不会搬动已存的密钥。",
			userAgent: "User-Agent",
			userAgentHint: "留空即保留 harness 的归属头。只有中转站按 User-Agent 区分客户端时才填。",
			directMode: "直连传输",
			directModeHint:
				"某些中转站的 WAF 会对来自数据中心出口 IP（代理的一跳）返回网页挑战而不是 SSE 流。" +
				"直连可绕开进程代理；auto 只在进程确实设了代理变量时才直连。",
			directAuto: "自动",
			directAlways: "总是",
			directNever: "从不",
			patchToolSchema: "工具 schema 兼容",
			patchToolSchemaHint: "给出站工具 schema 的对象节点补 required: []，兼容把缺省当非法的上游。",
			silentRetry: "静默重试",
			silentRetryHint:
				"中转站把请求轮流分配到多个上游通道，个别通道会以「请求无效」为由拒绝本可重试的请求。" +
				"开启后这类失败会在插件内部重新发送，不显示给会话；关闭则原样报错。",
			attempts: "最大尝试次数",
			attemptsHint: "开启静默重试时，单次请求最多发送几次。",
			quotaHint: "额度耗尽提示",
			quotaHintHint: "附加到 402 额度耗尽错误后面的说明文字；留空则不附加。",
			opsTitle: "运营数据",
			opsHint: "以下四项是中转站管控面的预留接缝：站点接口确定后接入，此处不需要改结构。",
			opsBalance: "余额",
			opsUsage: "用量",
			opsBilling: "计费",
			opsHealth: "健康探测",
			opsNotWired: "未接入",
			readOnly: "当前部署不允许写入设置。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			loading: "正在读取设置…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			save: "保存",
			saving: "保存中…",
			wizardTitle: "接入 API3D",
			wizardKeyStep: "第 1 步 · 填写 API Key",
			wizardKeyHint: "密钥只存在本机，不会上传。确认后由 DSH 代你连接站点，列出账号可用的模型。",
			wizardBaseLabel: "站点基础地址",
			wizardApiKeyLabel: "API Key",
			wizardNoKey: "还没有 API Key？",
			wizardGetKey: "前往 api3d.cn 获取",
			wizardGetKeyTitle: "在浏览器中打开 api3d.cn",
			wizardConfirm: "确认并查询模型",
			wizardQuerying: "正在查询模型…",
			wizardModelsStep: "第 2 步 · 勾选要导入的模型",
			wizardModelsHint: "下面是站点报出的全部模型。取消勾选不需要的，再点导入。",
			wizardCount: "共 {count} 个",
			wizardSelectAll: "全选",
			wizardSelectNone: "全不选",
			wizardImport: "导入所选模型",
			wizardImporting: "正在导入…",
			wizardBack: "上一步",
			wizardDoneTitle: "导入完成",
			wizardDoneHint: "已导入模型，现在可以在模型选择器里选它们了。",
			wizardClose: "关闭",
			wizardEmpty: "站点没有返回任何模型",
			wizardPickOne: "至少勾选一个模型",
			wizardKeySaveFailed: "密钥保存失败",
			wizardUnavailable: "设置还没就绪，暂时无法打开向导。",
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			title: "API3D",
			panel: "API3D",
			panelTitle: "API3D setup",
			panelHint: "Open the wizard on the right: enter the API key, confirm, then pick the models the site reports and import them.",
			panelConfigure: "Open setup wizard",
			panelReconfigure: "Pick models again",
			panelNoModels: "No models imported yet. Open the setup wizard, enter an API key, and DSH will list the models the site offers.",
			panelModelsTitle: "Imported models",
			description: "Connect API3D (api3d.cn) as a DeepSeek Harness model route: base address, API key and outbound compatibility switches. The API3D panel in the sidebar imports the site's models in one step. A saved change applies from the next request; the model list is unaffected.",
			baseUrl: "Base address",
			baseUrlHint: "Defaults to https://api3d.cn/v1. The route only carries a sentinel host; this field rewrites it on the way out.",
			baseUrlPlaceholder: "https://api3d.cn/v1",
			apiKey: "API key",
			apiKeyHint: "The key is stored in ~/.dsh/.credentials.yaml and is never sent back to this page. The reference name comes from the field below.",
			apiKeyPlaceholder: "sk-…",
			apiKeyConfigured: "Configured",
			apiKeyMissing: "Not configured",
			apiKeySave: "Save key",
			apiKeySaving: "Saving…",
			apiKeySaved: "Saved",
			apiKeyFailed: "The deployment rejected that key.",
			apiKeyClear: "Clear key",
			apiKeyCleared: "Cleared",
			apiKeyEnv: "Credential reference",
			apiKeyEnvHint: "The key name the secret is stored under; it must match the route's apiKeyEnv. Changing it does not move a stored secret.",
			userAgent: "User-Agent",
			userAgentHint: "Leave empty to keep the harness attribution header. Set it only when the relay distinguishes clients by User-Agent.",
			directMode: "Direct transport",
			directModeHint:
				"Some relay WAFs answer requests from datacenter egress IPs (the proxy hop) with an HTML challenge instead of an SSE stream. " +
				"Direct transport bypasses the process proxy; auto only does so when proxy variables are actually set.",
			directAuto: "Auto",
			directAlways: "Always",
			directNever: "Never",
			patchToolSchema: "Tool schema compatibility",
			patchToolSchemaHint: "Adds required: [] to object nodes of outbound tool schemas, for upstreams that reject an omitted one.",
			silentRetry: "Silent retry",
			silentRetryHint:
				"The relay load-balances across several upstream pools, and individual pools reject retryable requests as invalid. " +
				"With this on, the plugin re-sends those failures internally instead of showing them to the session; off reports them as they arrive.",
			attempts: "Maximum attempts",
			attemptsHint: "Total sends one request may make while silent retry is on.",
			quotaHint: "Quota-exhausted note",
			quotaHintHint: "Text appended to a 402 quota error; empty leaves it untouched.",
			opsTitle: "Operations",
			opsHint: "These four are the reserved seam for the relay's control plane: wire them once the site's endpoints are fixed, no structural change needed.",
			opsBalance: "Balance",
			opsUsage: "Usage",
			opsBilling: "Billing",
			opsHealth: "Health",
			opsNotWired: "Not wired",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			loading: "Reading settings…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			save: "Save",
			saving: "Saving…",
			wizardTitle: "Connect API3D",
			wizardKeyStep: "Step 1 · Enter the API key",
			wizardKeyHint: "The key never leaves this machine. On confirm, DSH queries the site for you and lists the models your account can use.",
			wizardBaseLabel: "Site base address",
			wizardApiKeyLabel: "API key",
			wizardNoKey: "No API key yet?",
			wizardGetKey: "Get one at api3d.cn",
			wizardGetKeyTitle: "Open api3d.cn in your browser",
			wizardConfirm: "Confirm and query models",
			wizardQuerying: "Querying models…",
			wizardModelsStep: "Step 2 · Pick the models to import",
			wizardModelsHint: "Below are all the models the site reported. Uncheck the ones you do not want, then import.",
			wizardCount: "{count} total",
			wizardSelectAll: "Select all",
			wizardSelectNone: "Select none",
			wizardImport: "Import selected models",
			wizardImporting: "Importing…",
			wizardBack: "Back",
			wizardDoneTitle: "Import complete",
			wizardDoneHint: "Models imported — you can now pick them in the model selector.",
			wizardClose: "Close",
			wizardEmpty: "The site reported no models",
			wizardPickOne: "Select at least one model",
			wizardKeySaveFailed: "Could not save the key",
			wizardUnavailable: "Settings are not ready yet; the wizard cannot open right now.",
		};
		/** The form frame's copy, read from this page's dictionary. */
		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving"),
			};
		}
		//#endregion

		//#region styles
		/*
		 * 手写而非由 CSS module 产出：生成那些带哈希类名的 `clientBundle` tsdown
		 * 预设并未发布，所以本 bundle 自带一套带前缀的类名并只注入一次。配色用的是
		 * shell 设计 token，因此页面会跟随当前主题。
		 */
		const CSS = [
			".dshA3d_row{display:flex;flex-direction:column;gap:6px;margin:0 0 18px}",
			".dshA3d_label{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}",
			".dshA3d_hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dshA3d_toggle{display:flex;align-items:center;gap:10px}",
			".dshA3d_inline{display:flex;align-items:center;gap:10px}",
			".dshA3d_text{width:100%;box-sizing:border-box;padding:6px 10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px}",
			".dshA3d_text:disabled{opacity:.55}",
			".dshA3d_number{width:72px;box-sizing:border-box;padding:5px 9px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px}",
			".dshA3d_number:disabled{opacity:.55}",
			".dshA3d_button{flex:none;padding:5px 12px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;cursor:pointer}",
			".dshA3d_button:disabled{opacity:.55;cursor:default}",
			".dshA3d_state{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dshA3d_ops{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0 0 6px}",
			".dshA3d_op{padding:10px 12px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px}",
			".dshA3d_opName{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dshA3d_opValue{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}",
			".dshA3d_panel{display:flex;flex-direction:column;gap:8px;max-width:640px;margin:0 auto;padding:40px 28px;color:var(--dsw-alias-label-primary)}",
			".dshA3d_panelTitle{margin:0;font-size:20px;font-weight:650;line-height:28px}",
			".dshA3d_panelText{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}",
			".dshA3d_panelHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}",
			".dshA3d_panelHeadText{display:flex;flex-direction:column;gap:6px;min-width:0}",
			".dshA3d_panelModels{display:flex;flex-direction:column;gap:8px;margin-top:12px}",
			".dshA3d_buttonPrimary{color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-button-primary-fill,#3b6ef0);border-color:transparent}",
			".dshA3d_buttonPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#3471f5)}",
			".dshA3d_modelList{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}",
			".dshA3d_modelRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px}",
			".dshA3d_modelRow code{color:var(--dsw-alias-label-tertiary);font-size:12px}",
			".dshA3d_panelHead .dshA3d_button{flex:none;align-self:flex-start}",
			".dshA3d_dialog.dshA3d_dialog{width:min(560px,100%);max-height:calc(100vh - 48px);overflow:auto}",
			".dshA3d_wizard{display:flex;flex-direction:column;gap:14px;width:100%;min-width:0;max-width:100%;box-sizing:border-box}",
			".dshA3d_wizardStep{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px}",
			".dshA3d_wizardTools{display:flex;gap:8px}",
			".dshA3d_wizardFooter{display:flex;justify-content:flex-end;gap:8px}",
			".dshA3d_keyHelp{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;margin:-24px 0 0}",
			".dshA3d_link{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;text-decoration:underline;text-underline-offset:2px;cursor:pointer}",
			".dshA3d_link:hover{opacity:.75}",
			".dshA3d_modelPick{display:flex;flex-direction:column;gap:6px;max-height:min(320px,34vh);margin:0;padding:0;overflow:auto;list-style:none}",
			".dshA3d_modelPickRow{display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:7px}",
			".dshA3d_modelPickName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}",
			".dshA3d_modelPickId{color:var(--dsw-alias-label-tertiary);font-size:12px}",
			".dshA3d_error{margin:0;color:var(--dsw-alias-label-error,#d94848);font-size:12px;line-height:18px}",
		].join("");
		const CSS_TAG_ID = "dsh-api3d/RelayPage.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null) {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", CSS_TAG_ID);
			tag.textContent = CSS;
			document.head.append(tag);
		}
		//#endregion

		//#region relay page
		/** 本页提供的直连策略，按显示顺序。 */
		const DIRECT_MODES = ["auto", "always", "never"];
		/** 设置分节里承载中转站基础地址的字段。 */
		const FIELD_BASE_URL = "baseURL";
		/** 设置分节里承载凭据引用名的字段。 */
		const FIELD_KEY_ENV = "apiKeyEnv";
		/** 设置分节里承载出站 User-Agent 覆盖值的字段。 */
		const FIELD_USER_AGENT = "userAgent";
		/** 设置分节里承载直连策略的字段。 */
		const FIELD_DIRECT = "directMode";
		/** 设置分节里承载工具 schema 兼容开关的字段。 */
		const FIELD_PATCH_SCHEMA = "patchToolSchema";
		/** 设置分节里承载静默重试开关的字段。 */
		const FIELD_RETRY = "silentRetry";
		/** 设置分节里承载重试次数上限的字段。 */
		const FIELD_ATTEMPTS = "silentRetryAttempts";
		/** 设置分节里承载配额耗尽提示的字段。 */
		const FIELD_QUOTA_HINT = "quotaHint";
		/** 设置分节里承载「从站点导入的模型目录」的字段（JSON 字符串）。 */
		const FIELD_MODELS = "models";
		/** 分节还没被宿主服务时使用的凭据引用。 */
		const FALLBACK_KEY_ENV = "API3D_API_KEY";
		/** 凭据引用必须符合凭据服务自己的文法。 */
		const KEY_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

		/**
		 * 本卡预留的运维行。每一行在中转站的管控面接口接上之前都是占位；接缝的粒度
		 * 是**行**而不是数字，所以新增一个数据源只改 `opValue`，别的都不动。
		 */
		const OPS_ROWS = ["opsBalance", "opsUsage", "opsBilling", "opsHealth"];

		/**
		 * 从一个分节值里读字段，容忍「分节还没被服务」的情况（首次渲染发生在宿主
		 * 的 describe 应答落地之前，那时 `value` 是 undefined）。
		 * @param value - 快照里解出的分节。
		 * @param field - 要读的字段名。
		 * @returns 存下来的值，或 undefined。
		 */
		function fieldOf(value, field) {
			return typeof value === "object" && value !== null ? value[field] : undefined;
		}

		/**
		 * 本卡把密钥写在其下的凭据引用名。
		 * @param value - 快照里解出的分节。
		 * @returns 引用名，永不为空。
		 */
		function keyRefOf(value) {
			const declared = fieldOf(value, FIELD_KEY_ENV);
			const ref = typeof declared === "string" ? declared.trim() : "";
			return KEY_ENV_PATTERN.test(ref) ? ref : FALLBACK_KEY_ENV;
		}

		/**
		 * 解开一个 `RemoteResult`，同时不丢掉失败：网关把传输问题折进 error 分支
		 * 而不是 reject，所以只检查「有没有抛」的调用方会把失败读成成功。
		 * @param result - 已落定的 `RemoteResult`。
		 * @returns 值；失败时返回 undefined。
		 */
		function remoteValue(result) {
			return result !== null && typeof result === "object" && result.ok === true ? result.value : undefined;
		}

		/**
		 * 中转站设置页。
		 *
		 * 它自己不暂存任何东西，保存统一走 shell 的共享设置表单：本节只有几个小标量，
		 * 而 shell 的保存是「草稿变成文档改动」的唯一入口。API Key 是例外，它由单独的
		 * 按钮写入：它根本不是设置值而是一条凭据，凭据服务只接受单向写入、从不交还。
		 *
		 * 表单控制器以注入的 `relayForm` prop 到达，而不是从 Plugins 页面拿：三个槽位
		 * 里只有两个会带 `form` 参数，而直接从 `configForms` 取控制器能让页面挂在哪里
		 * 都走同一条代码路径。
		 *
		 * @param {object} props - 槽位的 kit：注入的 `relayForm`、绑定的翻译函数 `t`，
		 *   以及 Plugins 页面要求的那种视图。
		 * @returns {object} 一行摘要，或设置表单。
		 */
		function RelayPage(props) {
			const { t, relayForm } = props;

			const state = react.useSyncExternalStore(
				react.useCallback((listener) => relayForm.subscribe(listener), [relayForm]),
				() => relayForm.getSnapshot(),
			);

			// 草稿是本地状态：一次保存到底接受了什么，唯一的权威是宿主，所以暂存的
			// 值留在这里，直到 `mutate` 给出应答。
			const [draft, setDraft] = react.useState(null);
			const [saving, setSaving] = react.useState(false);
			const [failed, setFailed] = react.useState(false);

			// 凭据状态刻意与设置草稿分开：它住在凭据服务里，不在本命名空间。
			const keyRef = keyRefOf(state.value);
			const [credential, setCredential] = react.useState(null);
			const [keyDraft, setKeyDraft] = react.useState("");
			const [keyBusy, setKeyBusy] = react.useState(false);
			const [keyNote, setKeyNote] = react.useState(null);

			const credentials = props.ctx?.remote?.credentials;

			react.useEffect(() => {
				if (!credentials || state.status === "loading" || state.status === "unavailable") return undefined;
				let live = true;
				credentials.describe([keyRef]).then(
					(result) => {
						if (!live) return;
						const view = remoteValue(result)?.[keyRef];
						if (view !== undefined) setCredential(view);
					},
					() => {
						if (live) setCredential(null);
					},
				);
				return () => {
					live = false;
				};
			}, [credentials, keyRef, state.status, state.revision]);

			// Hook 必须在本组件的每次渲染都跑到，所以摘要的 return 放在它们下面，
			// 而不是提前短路掉这次调用。`summary` 视图画的是组合包卡片那一行摘要，
			// 它没有表单。
			if (props.view === "summary") return t("description");
			// 宿主还没答 `settings.describe` 之前，分节是未知的：表单没有东西可显示，
			// 也绝不能渲染出会从一个 undefined 值里读字段的控件。
			if (state.status === "loading") return t("loading");
			if (state.status === "unavailable") return t("unavailable");

			const baseURL = draft?.baseURL ?? String(fieldOf(state.value, FIELD_BASE_URL) ?? "");
			const keyEnv = draft?.keyEnv ?? String(fieldOf(state.value, FIELD_KEY_ENV) ?? FALLBACK_KEY_ENV);
			const userAgent = draft?.userAgent ?? String(fieldOf(state.value, FIELD_USER_AGENT) ?? "");
			const directMode = draft?.directMode ?? String(fieldOf(state.value, FIELD_DIRECT) ?? "auto");
			const patchSchema = draft?.patchSchema ?? fieldOf(state.value, FIELD_PATCH_SCHEMA) !== false;
			const silentRetry = draft?.silentRetry ?? fieldOf(state.value, FIELD_RETRY) === true;
			const attempts = draft?.attempts ?? String(fieldOf(state.value, FIELD_ATTEMPTS) ?? 3);
			const quotaHint = draft?.quotaHint ?? String(fieldOf(state.value, FIELD_QUOTA_HINT) ?? "");

			const writable = state.writable !== false;
			const dirty = draft !== null;

			const stage = (patch) => {
				setFailed(false);
				setDraft((current) => ({
					baseURL,
					keyEnv,
					userAgent,
					directMode,
					patchSchema,
					silentRetry,
					attempts,
					quotaHint,
					...current,
					...patch,
				}));
			};

			const save = async () => {
				if (!dirty || saving) return;
				const parsedAttempts = Number.parseInt(attempts, 10);
				const ops = [];
				const setIfChanged = (field, next, previous) => {
					if (next !== previous) ops.push({ op: "set", path: [field], value: next });
				};
				setIfChanged(FIELD_BASE_URL, baseURL.trim(), fieldOf(state.value, FIELD_BASE_URL) ?? "");
				setIfChanged(FIELD_KEY_ENV, keyEnv.trim(), fieldOf(state.value, FIELD_KEY_ENV) ?? FALLBACK_KEY_ENV);
				setIfChanged(FIELD_USER_AGENT, userAgent.trim(), fieldOf(state.value, FIELD_USER_AGENT) ?? "");
				setIfChanged(FIELD_DIRECT, directMode, fieldOf(state.value, FIELD_DIRECT) ?? "auto");
				setIfChanged(
					FIELD_PATCH_SCHEMA,
					patchSchema,
					fieldOf(state.value, FIELD_PATCH_SCHEMA) !== false,
				);
				setIfChanged(FIELD_RETRY, silentRetry, fieldOf(state.value, FIELD_RETRY) === true);
				if (Number.isInteger(parsedAttempts) && parsedAttempts !== fieldOf(state.value, FIELD_ATTEMPTS)) {
					ops.push({ op: "set", path: [FIELD_ATTEMPTS], value: parsedAttempts });
				}
				setIfChanged(FIELD_QUOTA_HINT, quotaHint, fieldOf(state.value, FIELD_QUOTA_HINT) ?? "");
				setSaving(true);
				try {
					const landed = ops.length === 0 || (await relayForm.mutate(ops, state.revision));
					if (landed) setDraft(null);
					else setFailed(true);
				} catch {
					setFailed(true);
				} finally {
					setSaving(false);
				}
			};

			const saveKey = async () => {
				if (!credentials || keyBusy) return;
				const value = keyDraft.trim();
				if (value.length === 0) return;
				setKeyBusy(true);
				setKeyNote(null);
				try {
					const result = await credentials.set(keyRef, value);
					if (result !== null && typeof result === "object" && result.ok === true) {
						setKeyDraft("");
						setCredential({ configured: true, writable: true });
						setKeyNote(t("apiKeySaved"));
					} else {
						setKeyNote(t("apiKeyFailed"));
					}
				} catch {
					setKeyNote(t("apiKeyFailed"));
				} finally {
					setKeyBusy(false);
				}
			};

			const clearKey = async () => {
				if (!credentials || keyBusy) return;
				setKeyBusy(true);
				setKeyNote(null);
				try {
					await credentials.unset(keyRef);
					setKeyDraft("");
					setCredential({ configured: false, writable: true });
					setKeyNote(t("apiKeyCleared"));
				} catch {
					setKeyNote(t("apiKeyFailed"));
				} finally {
					setKeyBusy(false);
				}
			};

			const row = (labelKey, hintKey, children) =>
				react.createElement(
					"div",
					{ className: "dshA3d_row" },
					react.createElement("span", { className: "dshA3d_label" }, t(labelKey)),
					children,
					react.createElement("p", { className: "dshA3d_hint" }, t(hintKey)),
				);

			const textInput = (field, value, options = {}) =>
				react.createElement("input", {
					className: "dshA3d_text",
					type: options.type ?? "text",
					value,
					placeholder: options.placeholder === undefined ? undefined : t(options.placeholder),
					autoComplete: options.autoComplete ?? "off",
					spellCheck: false,
					disabled: !writable,
					"aria-label": t(options.labelKey ?? field),
					onChange: (event) => stage({ [field]: event.target.value }),
				});

			const opsGrid = react.createElement(
				"div",
				{ className: "dshA3d_row" },
				react.createElement("span", { className: "dshA3d_label" }, t("opsTitle")),
				react.createElement(
					"div",
					{ className: "dshA3d_ops" },
					OPS_ROWS.map((key) =>
						react.createElement(
							"div",
							{ className: "dshA3d_op", key },
							react.createElement("div", { className: "dshA3d_opName" }, t(key)),
							react.createElement("div", { className: "dshA3d_opValue" }, t("opsNotWired")),
						),
					),
				),
				react.createElement("p", { className: "dshA3d_hint" }, t("opsHint")),
			);

			const keyConfigured = credential?.configured === true;
			const keyRow = react.createElement(
				"div",
				{ className: "dshA3d_row" },
				react.createElement(
					"span",
					{ className: "dshA3d_label" },
					t("apiKey") + " — " + (keyConfigured ? t("apiKeyConfigured") : t("apiKeyMissing")),
				),
				react.createElement(
					"div",
					{ className: "dshA3d_inline" },
					react.createElement("input", {
						className: "dshA3d_text",
						type: "password",
						value: keyDraft,
						placeholder: t("apiKeyPlaceholder"),
						autoComplete: "off",
						spellCheck: false,
						disabled: !writable || credentials === undefined || keyBusy,
						"aria-label": t("apiKey"),
						onChange: (event) => {
							setKeyNote(null);
							setKeyDraft(event.target.value);
						},
					}),
					react.createElement(
						"button",
						{
							className: "dshA3d_button",
							type: "button",
							disabled: !writable || credentials === undefined || keyBusy || keyDraft.trim().length === 0,
							onClick: saveKey,
						},
						keyBusy ? t("apiKeySaving") : t("apiKeySave"),
					),
					keyConfigured
						? react.createElement(
								"button",
								{
									className: "dshA3d_button",
									type: "button",
									disabled: !writable || keyBusy,
									onClick: clearKey,
								},
								t("apiKeyClear"),
							)
						: null,
				),
				react.createElement("p", { className: "dshA3d_hint" }, t("apiKeyHint")),
				keyNote === null ? null : react.createElement("p", { className: "dshA3d_state" }, keyNote),
			);

			return react.createElement(
				primitives.SettingsForm,
				{
					labels: formLabels(t),
					state: {
						available: state.status !== "unavailable",
						writable,
						dirty,
						invalid: !Number.isInteger(Number.parseInt(attempts, 10)),
						saving,
						failed,
					},
					onSave: save,
					onDiscard: () => {
						setDraft(null);
						setFailed(false);
					},
				},
				row(
					"baseUrl",
					"baseUrlHint",
					textInput(FIELD_BASE_URL, baseURL, { type: "url", placeholder: "baseUrlPlaceholder" }),
				),
				keyRow,
				row(
					"apiKeyEnv",
					"apiKeyEnvHint",
					textInput(FIELD_KEY_ENV, keyEnv, { labelKey: "apiKeyEnv" }),
				),
				row(
					"directMode",
					"directModeHint",
					react.createElement(primitives.SegmentedControl, {
						id: "dshLr-direct",
						value: directMode,
						options: DIRECT_MODES.map((key) => ({
							value: key,
							label: t(key === "auto" ? "directAuto" : key === "always" ? "directAlways" : "directNever"),
						})),
						onChange: (next) => stage({ directMode: next }),
						label: t("directMode"),
						disabled: !writable,
					}),
				),
				row(
					"patchToolSchema",
					"patchToolSchemaHint",
					react.createElement(
						"div",
						{ className: "dshA3d_toggle" },
						react.createElement(primitives.Switch, {
							checked: patchSchema,
							onChange: (next) => stage({ patchSchema: next }),
							label: t("patchToolSchema"),
							disabled: !writable,
						}),
						react.createElement("span", { className: "dshA3d_label" }, t("patchToolSchema")),
					),
				),
				row(
					"silentRetry",
					"silentRetryHint",
					react.createElement(
						"div",
						null,
						react.createElement(
							"div",
							{ className: "dshA3d_toggle" },
							react.createElement(primitives.Switch, {
								checked: silentRetry,
								onChange: (next) => stage({ silentRetry: next }),
								label: t("silentRetry"),
								disabled: !writable,
							}),
							react.createElement("span", { className: "dshA3d_label" }, t("silentRetry")),
						),
						react.createElement(
							"div",
							{ className: "dshA3d_inline", style: { marginTop: 2 } },
							react.createElement("span", { className: "dshA3d_hint" }, t("attempts")),
							react.createElement("input", {
								className: "dshA3d_number",
								type: "number",
								min: 1,
								max: 10,
								value: attempts,
								disabled: !writable || !silentRetry,
								"aria-label": t("attempts"),
								onChange: (event) => stage({ attempts: event.target.value }),
							}),
						),
					),
				),
				row("quotaHint", "quotaHintHint", textInput(FIELD_QUOTA_HINT, quotaHint, { labelKey: "quotaHint" })),
				row("userAgent", "userAgentHint", textInput(FIELD_USER_AGENT, userAgent, { labelKey: "userAgent" })),
				opsGrid,
			);
		}
		//#endregion

		//#region wizard
		/**
		 * 宿主半注册的两条精确 Fetch 路由。
		 *
		 * 它们挂在 `connection.fetch` 上，所以自动带 Host/Origin 围栏与浏览器会话
		 * 鉴权；相对路径 + 同源 fetch 在桌面与 web 两种宿主里都成立。
		 */
		const HOST_MODELS_PATH = "/api/api3d.models";
		const HOST_APPLY_PATH = "/api/api3d.apply";

		/** 向导开关的订阅者；入口按钮与弹窗分处两个槽位，所以状态放在模块级。 */
		const wizardListeners = new Set();
		let wizardOpen = false;
		/** 某个面板第一次打开时自动引导一次；只在本进程里生效一次。 */
		let wizardAutoOpened = false;

		/** @returns 向导是否打开。 */
		function wizardSnapshot() {
			return wizardOpen;
		}

		/** @returns 订阅函数。 */
		function subscribeWizard(listener) {
			wizardListeners.add(listener);
			return () => wizardListeners.delete(listener);
		}

		/** 打开向导。 */
		function openWizard() {
			if (wizardOpen) return;
			wizardOpen = true;
			for (const listener of wizardListeners) listener();
		}

		/** 关闭向导。 */
		function closeWizard() {
			if (!wizardOpen) return;
			wizardOpen = false;
			for (const listener of wizardListeners) listener();
		}

		/**
		 * 把字典里的 `{count}` 占位换掉。字典服务只做取词，不做插值。
		 * @param t - 本页翻译函数。
		 * @param key - 字典键。
		 * @param count - 要填的数字。
		 * @returns 填好的文案。
		 */
		function withCount(t, key, count) {
			return String(t(key)).replace("{count}", String(count));
		}

		/**
		 * 往宿主路由 POST 一段 JSON。
		 * @param path - 精确 Fetch 路由路径（以 /api/ 开头）。
		 * @param payload - 请求体。
		 * @returns 解析后的响应体；`ok !== true` 时抛出带站点消息的 Error。
		 */
		async function postJson(path, payload) {
			const response = await fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload !== null && typeof payload === "object" ? payload : {}),
			});
			let body;
			try {
				body = await response.json();
			} catch {
				body = undefined;
			}
			if (!response.ok || body === null || typeof body !== "object" || body.ok !== true) {
				const message =
					body !== null && typeof body === "object" && typeof body.message === "string"
						? body.message
						: "HTTP " + response.status;
				throw new Error(message);
			}
			return body;
		}

		/**
		 * 读设置里导入的模型目录。
		 * @param raw - 设置快照里的 `models` 字段值（JSON 字符串）。
		 * @returns 模型列表；没导入或数据坏了时为空数组。
		 */
		function modelsOf(raw) {
			if (typeof raw !== "string" || raw.trim() === "") return [];
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return [];
			}
			if (!Array.isArray(parsed)) return [];
			const models = [];
			const seen = new Set();
			for (const row of parsed) {
				if (row === null || typeof row !== "object") continue;
				const id = typeof row.id === "string" ? row.id.trim() : "";
				if (id === "" || seen.has(id)) continue;
				seen.add(id);
				const displayName =
					typeof row.displayName === "string" && row.displayName.trim() !== "" ? row.displayName.trim() : id;
				models.push({ id, displayName });
			}
			return models;
		}

		/**
		 * 密钥与模型选择向导。
		 *
		 * 两步：填 key → 宿主查模型 → 勾选 → 导入。导入时先写凭据与设置，再让宿主把
		 * 选中的目录装回 llm-pi-ai 路由；设置那一格是 volatile 字段，所以这条路不
		 * 重载任何 fiber，模型选择器立刻能看到新模型。
		 *
		 * 模型查询必须走宿主：api3d.cn 的 `/v1/models` 不返回任何 `access-control-*`
		 * 头，浏览器直接请求会被跨域策略拦掉。
		 *
		 * @param props - 槽位注入的 `{ ctx, t }`。
		 * @returns 弹窗元素；未打开时返回 null。
		 */
		/**
		 * 订阅共享设置表单。
		 *
		 * `ConfigFormController` 的 `getSnapshot` / `subscribe` 是**原型方法**：React 以裸函数
		 * 调用 `useSyncExternalStore` 的两个参数，直接传 `form.getSnapshot` 会丢 `this`
		 * （表现为 `Cannot read properties of undefined (reading 'store')`）。这里用
		 * `useCallback` 绑住控制器，顺带让「控制器还没拿到」时也能安全渲染。
		 *
		 * @param {object|undefined} form - 注入的共享表单控制器。
		 * @returns {object|undefined} 表单快照，或 undefined。
		 */
		function useRelayFormState(form) {
			const subscribe = react.useCallback(
				(listener) => (form === undefined || form === null ? () => {} : form.subscribe(listener)),
				[form],
			);
			const getSnapshot = react.useCallback(
				() => (form === undefined || form === null ? undefined : form.getSnapshot()),
				[form],
			);
			return react.useSyncExternalStore(subscribe, getSnapshot);
		}

		function Api3dWizard(props) {
			const ctx = props.ctx;
			const t = typeof props.t === "function" ? props.t : (key) => key;
			const open = react.useSyncExternalStore(subscribeWizard, wizardSnapshot);
			const form = ctx !== undefined && ctx.configForms !== undefined ? ctx.configForms.get(SETTINGS_NS) : undefined;
			const state = useRelayFormState(form);
			const [step, setStep] = react.useState("key");
			const [baseURL, setBaseURL] = react.useState("");
			const [apiKey, setApiKey] = react.useState("");
			const [catalog, setCatalog] = react.useState([]);
			const [picked, setPicked] = react.useState({});
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const [imported, setImported] = react.useState(0);

			const live =
				state !== undefined && state !== null && typeof state.value === "object" && state.value !== null
					? state.value
					: {};
			const keyRef = keyRefOf(live);
			const fallbackBase = fieldOf(live, FIELD_BASE_URL) || "https://api3d.cn/v1";

			react.useEffect(() => {
				if (!open) return;
				setStep("key");
				setApiKey("");
				setCatalog([]);
				setPicked({});
				setBusy(false);
				setError("");
				setImported(0);
				setBaseURL(fallbackBase);
			}, [open]);

			if (!open) return null;
			if (form === undefined) {
				return react.createElement(
					primitives.Modal,
					{ open: true, onClose: closeWizard, title: t("wizardTitle"), className: "dshA3d_dialog" },
					react.createElement("p", { className: "dshA3d_hint" }, t("wizardUnavailable")),
				);
			}

			const chosen = catalog.filter((model) => picked[model.id] === true);

			const confirmKey = async () => {
				setBusy(true);
				setError("");
				try {
					const result = await postJson(HOST_MODELS_PATH, { apiKey: apiKey.trim(), baseURL: baseURL.trim() });
					const models = Array.isArray(result.models) ? result.models : [];
					if (models.length === 0) throw new Error(t("wizardEmpty"));
					const next = {};
					for (const model of models) next[model.id] = true;
					setCatalog(models);
					setPicked(next);
					setStep("models");
				} catch (failure) {
					setError(failureText(failure));
				} finally {
					setBusy(false);
				}
			};

			const importChosen = async () => {
				if (chosen.length === 0) {
					setError(t("wizardPickOne"));
					return;
				}
				setBusy(true);
				setError("");
				try {
					const credentials = ctx.remote !== undefined ? ctx.remote.credentials : undefined;
					if (credentials !== undefined) {
						const saved = await credentials.set(keyRef, apiKey.trim());
						if (saved === null || typeof saved !== "object" || saved.ok !== true) {
							throw new Error(t("wizardKeySaveFailed"));
						}
					}
					const snapshot = form.getSnapshot !== undefined ? form.getSnapshot() : undefined;
					const revision = snapshot !== undefined && snapshot !== null ? snapshot.revision : undefined;
					await form.mutate(
						[
							{ op: "set", path: [FIELD_BASE_URL], value: baseURL.trim() },
							{ op: "set", path: [FIELD_MODELS], value: JSON.stringify(chosen) },
						],
						revision,
					);
					const applied = await postJson(HOST_APPLY_PATH, {});
					setImported(Array.isArray(applied.models) ? applied.models.length : chosen.length);
					setStep("done");
				} catch (failure) {
					setError(failureText(failure));
				} finally {
					setBusy(false);
				}
			};

			const keyStep = [
				react.createElement("p", { className: "dshA3d_wizardStep", key: "step" }, t("wizardKeyStep")),
				react.createElement("p", { className: "dshA3d_hint", key: "hint" }, t("wizardKeyHint")),
				react.createElement(
					"label",
					{ className: "dshA3d_row", key: "base" },
					react.createElement("span", { className: "dshA3d_label" }, t("wizardBaseLabel")),
					react.createElement("input", {
						className: "dshA3d_text",
						type: "url",
						value: baseURL,
						disabled: busy,
						placeholder: t("baseUrlPlaceholder"),
						onChange: (event) => setBaseURL(event.target.value),
					}),
				),
				react.createElement(
					"label",
					{ className: "dshA3d_row", key: "key" },
					react.createElement("span", { className: "dshA3d_label" }, t("wizardApiKeyLabel")),
					react.createElement("input", {
						className: "dshA3d_text",
						type: "password",
						value: apiKey,
						disabled: busy,
						placeholder: t("apiKeyPlaceholder"),
						autoFocus: true,
						onChange: (event) => setApiKey(event.target.value),
					}),
				),
				react.createElement(
					"p",
					{ className: "dshA3d_keyHelp", key: "keyHelp" },
					react.createElement("span", { className: "dshA3d_hint" }, t("wizardNoKey")),
					react.createElement(
						"a",
						{
							className: "dshA3d_link",
							href: SITE_HOME,
							target: "_blank",
							rel: "noopener noreferrer",
							title: t("wizardGetKeyTitle"),
						},
						t("wizardGetKey"),
					),
				),
			];

			const modelStep = [
				react.createElement("p", { className: "dshA3d_wizardStep", key: "step" }, t("wizardModelsStep")),
				react.createElement(
					"p",
					{ className: "dshA3d_hint", key: "hint" },
					t("wizardModelsHint") + " " + withCount(t, "wizardCount", catalog.length),
				),
				react.createElement(
					"div",
					{ className: "dshA3d_wizardTools", key: "tools" },
					react.createElement(
						"button",
						{ className: "dshA3d_button", type: "button", disabled: busy, onClick: selectAllModels },
						t("wizardSelectAll"),
					),
					react.createElement(
						"button",
						{ className: "dshA3d_button", type: "button", disabled: busy, onClick: () => setPicked({}) },
						t("wizardSelectNone"),
					),
				),
				react.createElement(
					"ul",
					{ className: "dshA3d_modelPick", key: "list" },
					catalog.map((model) =>
						react.createElement(
							"li",
							{ className: "dshA3d_modelPickRow", key: model.id },
							react.createElement("input", {
								type: "checkbox",
								checked: picked[model.id] === true,
								disabled: busy,
								"aria-label": model.displayName,
								onChange: (event) => setPicked({ ...picked, [model.id]: event.target.checked }),
							}),
							react.createElement("span", { className: "dshA3d_modelPickName" }, model.displayName),
							react.createElement("code", { className: "dshA3d_modelPickId" }, model.id),
						),
					),
				),
			];

			const doneStep = [
				react.createElement("p", { className: "dshA3d_wizardStep", key: "step" }, t("wizardDoneTitle")),
				react.createElement("p", { className: "dshA3d_hint", key: "hint" }, t("wizardDoneHint")),
				react.createElement("p", { className: "dshA3d_panelText", key: "count" }, withCount(t, "wizardCount", imported)),
			];

			const body = step === "models" ? modelStep : step === "done" ? doneStep : keyStep;
			if (error !== "") body.push(react.createElement("p", { className: "dshA3d_error", key: "error" }, error));

			const footer = react.createElement(
				"div",
				{ className: "dshA3d_wizardFooter" },
				step === "models"
					? react.createElement(
							"button",
							{
								className: "dshA3d_button",
								type: "button",
								disabled: busy,
								onClick: () => {
									setStep("key");
									setError("");
								},
							},
							t("wizardBack"),
						)
					: null,
				react.createElement(
					"button",
					{ className: "dshA3d_button", type: "button", disabled: busy, onClick: closeWizard },
					t("wizardClose"),
				),
				step === "key"
					? react.createElement(
							"button",
							{
								className: "dshA3d_button dshA3d_buttonPrimary",
								type: "button",
								disabled: busy || apiKey.trim() === "",
								onClick: confirmKey,
							},
							busy ? t("wizardQuerying") : t("wizardConfirm"),
						)
					: null,
				step === "models"
					? react.createElement(
							"button",
							{
								className: "dshA3d_button dshA3d_buttonPrimary",
								type: "button",
								disabled: busy,
								onClick: importChosen,
							},
							busy ? t("wizardImporting") : t("wizardImport") + "（" + chosen.length + "）",
						)
					: null,
			);

			function selectAllModels() {
				const next = {};
				for (const model of catalog) next[model.id] = true;
				setPicked(next);
			}

			return react.createElement(
				primitives.Modal,
				{ open: true, onClose: busy ? () => {} : closeWizard, title: t("wizardTitle"), className: "dshA3d_dialog", footer },
				react.createElement("div", { className: "dshA3d_wizard" }, body),
			);
		}

		/**
		 * 把一次失败转成可显示的文字。
		 * @param failure - 捕获到的错误。
		 * @returns 文案。
		 */
		function failureText(failure) {
			return failure !== null && typeof failure === "object" && typeof failure.message === "string"
				? failure.message
				: String(failure);
		}
		//#endregion

		//#region sidebar entry
		/**
		 * 侧边栏入口与它打开的主面板共用的 id。
		 *
		 * 侧边栏那一行由 `sidebar.panellist` 槽位渲染（`id` 就是面板 id，点它等于
		 * `layout.selectPanel(id)`）；主面板由 `main` 槽位按同一个 id 作为 `key`
		 * 渲染（`ui-layout` 用 `activePanelId ?? "conversation"` 去匹配 `main` 的
		 * 条目键）。两处必须写同一个字符串。
		 */
		const PANEL_ID = "api3d";
		/**
		 * 侧边栏那一行的图标。
		 *
		 * `sidebar.panellist` 把图标自己作为槽位组件渲染，并传入 `size`（宽侧边栏
		 * 16、折叠 18）与 `active`；图标只读这两个属性。颜色用 `currentColor`，
		 * 由行的样式决定，因此选中态和主题都不用自己处理。
		 *
		 * @param props - 槽位属性：`size` 与 `active`。
		 * @returns 一个等轴测立方体轮廓的 svg 元素。
		 */
		function Api3dIcon(props) {
			const size = props && typeof props.size === "number" ? props.size : 16;
			return react.createElement(
				"svg",
				{ width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
				react.createElement("path", {
					d: "M12 2.6 20.4 7.3v9.4L12 21.4 3.6 16.7V7.3Z",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinejoin: "round",
				}),
				react.createElement("path", {
					d: "M3.6 7.3 12 12l8.4-4.7M12 12v9.4",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinejoin: "round",
				}),
			);
		}
		/**
		 * 侧边栏入口打开的主面板。
		 *
		 * 第一次打开且还没有导入模型时自动弹出向导一次；之后这里显示已导入的模型
		 * 清单和「打开配置向导」按钮。
		 *
		 * @param props - 槽位属性：注入的翻译函数与设置表单控制器。
		 * @returns 面板内容。
		 */
		function Api3dPanel(props) {
			const t = props && typeof props.t === "function" ? props.t : (key) => key;
			const form = props && props.relayForm !== undefined ? props.relayForm : undefined;
			const state = useRelayFormState(form);
			const models = modelsOf(fieldOf(state !== undefined && state !== null ? state.value : undefined, FIELD_MODELS));

			react.useEffect(() => {
				if (wizardAutoOpened || models.length > 0) return;
				wizardAutoOpened = true;
				openWizard();
			}, []);

			return react.createElement(
				"section",
				{ className: "dshA3d_panel" },
				react.createElement(
					"div",
					{ className: "dshA3d_panelHead" },
					react.createElement(
						"div",
						{ className: "dshA3d_panelHeadText" },
						react.createElement("h1", { className: "dshA3d_panelTitle" }, t("panelTitle")),
						react.createElement("p", { className: "dshA3d_panelText" }, t("panelHint")),
					),
					react.createElement(
						"button",
						{ className: "dshA3d_button dshA3d_buttonPrimary", type: "button", onClick: openWizard },
						models.length > 0 ? t("panelReconfigure") : t("panelConfigure"),
					),
				),
				models.length === 0
					? react.createElement("p", { className: "dshA3d_panelText" }, t("panelNoModels"))
					: react.createElement(
							"div",
							{ className: "dshA3d_panelModels" },
							react.createElement("span", { className: "dshA3d_label" }, t("panelModelsTitle")),
							react.createElement(
								"ul",
								{ className: "dshA3d_modelList" },
								models.map((model) =>
									react.createElement(
										"li",
										{ className: "dshA3d_modelRow", key: model.id },
										react.createElement("span", null, model.displayName),
										model.displayName === model.id ? null : react.createElement("code", null, model.id),
									),
								),
							),
						),
			);
		}
		//#endregion

		//#region plugin
		/** 本插件拥有的字典命名空间。 */
		const NS = "settings.api3d";
		/**
		 * 宿主半注册的设置命名空间。这里是**手写字面量**而不是 import：浏览器 bundle
		 * 不得依赖宿主包，所以两半各自声明同一个字面量（宿主那份是
		 * `SETTINGS_NAMESPACE`）。
		 */
		const SETTINGS_NS = "api3d";
		/** 本插件向浏览器运行时申请的服务。 */
		const inject = ["slots", "locale", "remote", "remote.credentials", "configForms"];
		/**
		 * 本插件作为哪个组合包发行。Plugins 页按组合包的包名给它的配置槽位加键，
		 * 所以这里必须写 profile 安装时用的同一个字符串（`pluginManager.listBundles`
		 * 报出来的那个）。
		 */
		const BUNDLE_NAME = "dsh-api3d";
		/** 该组合包里的行 id，与补丁层声明的保持一致。 */
		const ROW_ID = "api3d";
		/**
		 * 站点首页。只用于向导里「还没有 API Key？前往获取」的外链 —— 出站请求打到哪里
		 * 仍由设置里的 `baseURL` 决定，两者互不影响（这里写死是因为浏览器 bundle 不能
		 * import 宿主半的 `SITE_DEFAULT_BASE_URL`）。
		 */
		const SITE_HOME = "https://api3d.cn";

		/**
		 * 把设置页注册进 Plugins 页。
		 *
		 * 承载一个组合包配置的槽位有三个，用哪个取决于用户站在哪里：
		 *
		 * - `plugins.bundle.config`，以组合包名为键，是组合包自己详情页上的表单 ——
		 *   用户点组合包卡片到达的那个页面，也是之前什么都不显示的页面。
		 * - `plugins.row.config`，以 `<bundle>#<rowId>` 为键，是组件行详情页上的表单。
		 * - `plugins.item` 是个列表槽位，会在 Official 分组里生成一张独立卡片；
		 *   它不是组合包页面，也不会出现在那里。
		 *
		 * 三个都注册，这样用户不管从哪里看都能摸到设置。它们骑在
		 * `configForms.whileServed` 上，所以一个从未挂载宿主半的部署看不到它们的
		 * 任何痕迹。
		 *
		 * 表单控制器是注入进来的，而不是从页面自己的 `form` 参数读：
		 * `plugins.bundle.config` 根本收不到那个参数，而统一注入一个控制器能让每个
		 * 挂载点走同一条代码路径。
		 *
		 * @param {object} ctx - 浏览器插件上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "api3d: dictionaries");
			const t = ctx.locale.bind(NS);
			const form = ctx.configForms.get(SETTINGS_NS);
			const injectForm = () => ({ relayForm: form, ctx });

			/** Register the page into one slot, while the Host serves the namespace. */
			const mount = (slot, options, label) => {
				ctx.effect(
					() =>
						ctx.configForms.whileServed([SETTINGS_NS], () =>
							ctx.slots.inject(slot, () =>
								ctx.slots.register({ ...options, name: slot, locale: NS, inject: injectForm }, RelayPage),
							),
						),
					label,
				);
			};

			mount("plugins.bundle.config", { key: BUNDLE_NAME }, "api3d: bundle settings page");
			mount("plugins.row.config", { key: `${BUNDLE_NAME}#${ROW_ID}` }, "api3d: row settings page");
			mount("plugins.item", { id: SETTINGS_NS, order: 30, label: () => t("title") }, "api3d: settings card");

			// 侧边栏入口挨着「插件」放：plugin-manager 那一行 order 0、日程 order 10，
			// 取 1 正好落在「插件」下面。它不骑 `whileServed`——这是导航入口，不是一个
			// 需要宿主应答才成立的表单；宿主半没装载时点进去，面板会说明当前不可配置。
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.panellist", () =>
						ctx.slots.register(
							{ name: "sidebar.panellist", id: PANEL_ID, order: 1, locale: NS, label: () => t("panel") },
							Api3dIcon,
						),
					),
				"api3d: sidebar entry",
			);
			ctx.effect(
				() =>
					ctx.slots.inject("main", () =>
						ctx.slots.register(
							{ name: "main", key: PANEL_ID, locale: NS, inject: () => ({ t, relayForm: form }) },
							Api3dPanel,
						),
					),
				"api3d: panel page",
			);

			// 向导弹窗挂在帧级 overlay 槽位：它不属于任何面板，开在哪里都能盖住整页。
			// 打开状态在模块级，所以侧边栏按钮、面板里的按钮都能把它叫出来。
			ctx.effect(
				() =>
					ctx.slots.inject("shell.overlay", () =>
						ctx.slots.register(
							{
								name: "shell.overlay",
								id: `${BUNDLE_NAME}#wizard`,
								order: 40,
								locale: NS,
								inject: () => ({ ctx, t }),
							},
							Api3dWizard,
						),
					),
				"api3d: key wizard",
			);
		}
		//#endregion

		exports.SETTINGS_NS = SETTINGS_NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
