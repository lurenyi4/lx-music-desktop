# Fork 审查问题修复（2026-09-22）

## 三端 CI 与原生依赖（2026-10-05）

`validate.yml` 作为 PR、分支构建和 release/beta 的共同验证入口，在 Windows、Linux、macOS
分别运行 lint、typecheck、单测、生产构建和当前四条 Electron E2E。
另在对应系统 runner 上打包 Windows/macOS x64 与 arm64、Linux x64/arm64/armv7l，显式禁止发布。
打包后读取实际 ASAR 中的 SQLite 二进制及 Electron 可执行文件，验证二者目标架构；不以产物文件名作为架构证据。
跨架构包生成与目标架构实机测试是不同验证范围；Windows 7 兼容产物仍不代表 Windows 7 实机通过。
聚合门禁只接受测试矩阵和打包矩阵同时成功，失败、取消或跳过均阻断，release/beta 的发布和上传 job
依赖同一次运行的共同门禁，因此不能绕过当前提交的三端检查。

现代 Electron 的 SQLite 不再复制仓库中的无版本历史二进制，而由 postinstall 和打包前 hook
复制当前锁定包对应目标架构的 N-API 预编译绑定至应用固定加载路径；缺少预编译时按 Electron 版本及目标架构重建，失败会直接失败。
Windows 7 的 Electron 22 保留显式的历史兼容绑定。`npm run test:ci` 检查 workflow 依赖关系，
并用真实 Electron 执行 SQLite 内存数据库的建表、插入和查询，以检测 ABI 错配。
Linux ARM 打包需要 GNU 交叉编译器；Windows 源码编译需要 C++ Build Tools，macOS 需要 Xcode 命令行工具。
外部音源网络错误仍会令 E2E 门禁失败，不能以单测或打包成功替代三端真实运行结果。

本轮本机 Windows 验证已通过 65 文件/901 单测、lint、typecheck、生产构建、十一项 CI/原生准备回归和
Electron 42.11.6（ABI 146、x64）SQLite 实际读写。尚未在 GitHub Actions 运行 Linux/macOS 与跨架构矩阵，
因此以上配置不构成三端已测试通过的声明。
修复固定绑定路径后，真实 Electron E2E 通过平台 8/8、电台 12/12、歌单同步 7/7、多活音源 8/8。
Windows x64 Setup 无发布打包完成；实际 ASAR 的 SQLite 与 Electron 可执行文件均为 x64。
将同一包故意按 arm64 检查会明确失败，确认架构门禁能拒绝宿主架构误装。
审核发现 Windows PowerShell 连续原生命令可能由后续成功覆盖先前失败退出码。
四条 E2E 已拆成独立 step；release/beta 的 Windows 多命令 step 在每次 npm、pip、git 命令后立即检查退出码，
缓存目录查询失败也会直接退出。配置回归在真实 Windows PowerShell 中模拟前项失败、后项成功，验证门禁保留失败。
后续审核发现干净 Windows runner 不能依赖本机 Miniconda 提供的 `sqlite3` CLI。
CI 已补齐 Linux apt 安装、Windows Chocolatey 官方社区源安装与显式 PATH 设置，并在三端 E2E 前检查 CLI；
macOS 使用系统 SQLite。新增回归验证安装/检查顺序、Linux 包清单、Windows 来源和安装失败传播。
本机 CLI 可执行性已检查，Chocolatey 安装过程与干净 runner 行为仍待 GitHub Actions 实测。

针对 `1b4e09c9` 的六项审查发现，补齐音源隔离、初始化、播放入口和推荐数据传递的边界。

| 问题 | 修复后的行为 | 回归覆盖 |
| --- | --- | --- |
| 多窗口共享 Session | 每个 apiId 使用独立内存分区，权限检查和申请均拒绝；卸载只清理对应音源 | `main.test.ts` 模拟真实分区共享语义；多音源 E2E 验证窗口分区与 Cookie 保留 |
| 主源初始化挂起 | 10 秒后释放等待，已就绪备源可接管；后续不重复等待，迟到成功可恢复主源 | `apiSource.test.ts` 覆盖超时接管、迟到成功及初始化期间切源 |
| 搜索页仅检查主源能力 | 播放按钮与取流链共用启用、就绪及提供方能力判断；下载仍使用自身能力规则 | 搜索页 `useList.test.ts` 覆盖仅备源支持的平台 |
| 已缓存推荐仍需重搜种子 | 缓存已确认的跨平台种子，续补优先读取有效结果；匹配证据变更或 TTL 到期才重新定位 | `platformRecall.test.ts`、`similarCache.test.ts` 覆盖断网续补、用尽、过期、容量和账号隔离 |
| 聚合备选条目在入队时丢失 | 备用 MusicInfo 随队列、路径、当前播放传递；取流失败先尝试已知备选，再走原有搜索回退 | `alternatePlayback.test.ts`、`platformSession.test.ts`、`recommendPlayback.test.ts` |
| 备源升主源出现重复行 | 设置合并时统一保证主备互斥、备源去重；弹窗兼容旧配置并避免重复行 | 多音源 E2E 检查主源切换后的显示与落盘配置 |

备用平台条目参与自动换源前，仍需核对标题、艺人和版本，并保留时长相差不超过 5 秒的限制。禁止自动换源时不尝试备用条目；已知备选全部失败后仍可进入原有搜索回退。备用信息属于播放上下文，普通切歌时清除，不新增歌曲持久化字段。

验证命令：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build`；构建后执行 `test:e2e:platform`、`test:e2e:user-api`、`test:e2e:sync`、`test:e2e:radio`。Electron 测试使用临时 userData 和隔离音源，不读写真实音乐库。

本次结果：42 个测试文件、624 项单测通过（较审查时新增 16 项）；类型检查、ESLint、生产构建通过。四条 E2E 分别为平台推荐 8/8、多音源 9/9、歌单 7/7、电台 12/12，共 36/36。新增主备切换用例最初被上一用例未关闭的弹窗遮挡，测试改为使用实际关闭按钮后重跑通过。

本次运行环境为 macOS；未执行 Windows/Linux 打包运行和真实 LLM 试听。

## 后续审查修复（2026-09-30）

以下记录针对 `fd1af611` 基线，在 `fix/review-followups` 分支完成；上文 2026-09-22 的测试数量和 E2E 结果保留为历史记录，不代表本轮重新验证。

| 问题 | 当前行为 | 回归覆盖 |
| --- | --- | --- |
| 预加载换源后，URL 缓存丢失实际提供方身份 | 播放 URL 缓存一并保存实际取流的 MusicInfo；直接命中和候选回退命中均透传身份。预加载只缓存，正式播放接受 URL 后才按原有列表规则写回。IPC 发送前用 `toRaw` 解开推荐路径中的 Vue 代理 | `recommendPlayback.test.ts`、`rotation.test.ts`、`music_url/index.test.ts`、`e2e/musicUrlCache.test.ts`，含真实 Vue 代理与结构化克隆边界 |
| 卸载/重载后备源仍被视为就绪 | 卸载、已有初始化状态的窗口重建和装载失败均清理就绪状态并通知渲染层；未初始化请求立即拒绝，不进入 20 秒请求队列。首次主源装载仍等待真正的 init 结果 | `rendererEvent.test.ts`、`e2e/userApiReadiness.test.ts`，覆盖禁用/移除/重新启用、旧窗口事件、主备切换及失败恢复 |
| 同曲去重与种子定位归一化不一致 | 两者共享零宽字符、全半角括号、括号周围空白及艺人括号别名处理；收藏排除、融合和提交前过滤使用一致口径。录音室/Live 等实际版本差异保留；种子主艺人、时长门禁及专辑择优不放宽 | `sameSong.test.ts`、`seedMatch.test.ts`、`candidatePool.test.ts`、`similarFusion.test.ts`、`submission.test.ts` |
| 关台期间播放不可观测，重开误结算旧推荐曲 | 真正退订时清空播放累计与上一首身份/推荐归属，不在重开后补记旧曲跳过；同 run 重锚保留订阅与新曲计时 | `session.test.ts`，覆盖关台后听完/切歌再重开和同 run 重锚 |
| 响应式设置无法跨备份 worker 边界 | 复制设置前解开 Vue 代理，默认空备源数组与已配置备源均可导出；`setting_v2`、`allData_v2` 继续清空 API Key，保留其他配置且不改动原设置 | `sensitiveSetting.test.ts` 使用真实 Vue、Comlink 和 MessageChannel，覆盖两种格式 × 默认/已配置设置 |
| 在线列表菜单仍仅按主源禁用播放 | 「播放」「稍后播放」使用主备播放能力判断；下载继续按主源能力判断 | `OnlineList/useMenu.test.ts`，含仅备源可播放、全部不支持与功能开关 |
| 倍速与停止造成听完/跳过误记 | 听完按实际播放分段乘以当段速率累计媒体时长；变速先结清旧速率段，暂停不累计。跳过仍用实际收听的墙钟 30 秒，已听完的短曲不再重复记跳过。profile/session 收到实际 `stop` 均冻结计时，停止本身不结算终曲 | `profile.test.ts`、`session.test.ts`、`listeningSignals.test.ts`，含 0.5–2 倍速、中途变速、暂停、停止空闲、同曲重播与两种订阅顺序 |
| 主艺人别名绕过单批最多两首 | 多样性统计读取展示及备用来源的主艺人别名，晚到的括号别名也能关联本批计数；每条艺人字符串单独提供别名证据，共享合作者或同曲归并本身不合并不同主艺人 | `similarFusion.test.ts`，含双来源顺序、零宽字符、仅备用来源保留别名与合作者反例 |
| 平台推荐只用展示身份排除，备用来源证据丢失 | 先归并整批同曲证据；每个平台仅以最佳排名贡献一次，所有来源身份继续保留。历史、收藏、队列、不再推荐、应用黑名单、路径与背书比较双方已保留来源；既有 ID 规则检查全部来源 ID。平台锚点排除采用含别名的同作品口径，其余同曲排除保留版本区别 | `platformAnchor.test.ts`、`similarFusion.test.ts`、`queue.test.ts`、`submission.test.ts`、`session-core.test.ts`、`session.test.ts`、`platformSession.test.ts` |
| 旧 local/AI 候选池提前丢弃别名来源 | 搜索与本地歌单的原始身份在排除前归组，首选仍为首个通过语言门控的来源；备用身份贯穿历史/黑名单检查、排序和最终视图。全部入口提交前重新核对收藏、黑名单、队列及批内同曲，晚到的别名桥不能漏排或重复入队 | `legacyIdentity.test.ts` 贯通真实召回、转换、排序和提交，local 与模拟 LLM 的 AI 两档均覆盖；另有 `candidatePool.test.ts` |
| 锁文件解析到不可用的 HTTP 镜像 | 89 个 `resolved` 地址改为官方 npm HTTPS；包键、版本、完整性哈希及其他值逐项不变，无依赖升级 | 空目录、全新缓存执行 `npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org` 成功安装 1,221 个包 |

保留行为：在线列表缺少更新记录或 `isAutoUpdate` 字段时，启动自动同步仍默认开启；只有显式 `false` 才关闭（`listAutoUpdate.test.ts`）。本轮不增加旧版本迁移策略。

播放 URL 缓存与推荐候选缓存分开：前者在现有文本列保存换源 URL 及歌曲身份，不变更数据库表结构，也不把成功的音源 id 写入歌曲；后者仍不保存短期播放 URL。队列/路径中的备用条目仍属于播放上下文。

来源身份由 `songIdentity.ts` 统一投影与比较，只使用条目已有的首选/备用记录，不建立全局艺人别名库或新增持久化结构。普通同曲排除仍区分录音室/Live 与无关联艺人的同名翻唱；更宽的同作品判定只用于平台锚点排除，种子定位与自动换源的版本、主艺人及时长门禁保持原口径。

### 本轮验证与边界

- 初轮（`4add96a4`）Linux 云端验证为 47 个文件、675 项测试；主/渲染进程类型检查、全量及改动文件专项 ESLint（含 `e2e/*.test.ts`）、四个生产构建均通过。此数量保留为阶段记录。
- 后续修复的当前结果：`npm test` 为 52 个文件、799 项测试通过；主/渲染进程 `npm run typecheck`、全量 `npm run lint`、`git diff --check` 通过。实现阶段 `npm run build` 四个生产构建通过。最新独立整 fork 审查覆盖 202 个变更路径，两阶段、正确性与简化两轴均通过，并独立重跑 799 项测试、两套类型检查和全量 lint；该次审查未重跑构建，另检查的 13 文件/200 项运行时回归是验证子集，不另加到 799 项中。
- 初轮实现早于可执行测试；依赖安装后，新增回归在原始生产代码上复现 7 个文件中的 14 项失败，再验证修复。后续独立审查发现均先加失败回归，再修复；最后一轮 legacy 来源身份修复先复现 26 项双模式链路失败和 4 项候选池失败，再全部通过。
- `e2e/musicUrlCache.test.ts`、`e2e/userApiReadiness.test.ts` 仍是带 IPC/窗口/数据库替身的 Vitest 跨模块测试。前轮独立审查另外用真实 SQLite 验证 v1/v2/v3 迁移、列表元数据读写、URL 身份往返及文件关闭后重开；另经真实 Vue、Comlink 和生产备份读写函数完成两种格式 × 默认/已配置设置共 4 个实体 `.lxmc` 文件往返。这些额外检查不是 Electron GUI 端到端测试，也未在本次文档更新时重跑。
- 修正后的锁文件经独立临时目录与全新 npm 缓存安装通过；使用 `--ignore-scripts`，验证范围为依赖解析、下载及锁文件一致性，未验证原生 postinstall、应用安装器或发行包。
- 本轮未运行 Electron GUI 的 `test:e2e:platform`、`test:e2e:user-api`、`test:e2e:sync`、`test:e2e:radio`，也未重新访问线上音乐提供方、调用真实 LLM 或试听。此前 GUI 尝试受无图形显示/Xvfb及 Electron 默认缓存目录不可写阻塞；历史 macOS E2E 与线上冒烟结果不能替代当前运行验证。

### 改动量说明

相对 `4add96a4`，本次后续修复在文档更新前共 32 个文件、增加 1,581 行/删除 298 行（含新增文件）：生产代码 14 文件 +302/−197，测试 17 文件 +1,190/−12，锁文件 1 文件 +89/−89。生产增量用于共享身份投影、跨模块证据传递、倍速/停止计时和两个 UI/备份边界；测试增长主要来自真实模块链路与反例覆盖，未引入测试框架或依赖。锁文件增量仅为地址替换。文档修订另计 5 文件 +39/−11，用于当前行为、验证边界与历史说明，不计入上述代码规模。

## 本地未推送修复整合（2026-10-03）

以远端 `824fff04` 为基准，整合本地 `603162e3` 与 `35a2c4b1`；后者的 README 开发命令、pnpm 锁文件与工作区配置保留。远端 npm 锁文件 HTTPS 修复保留，ADR 未修改。

| 本地行为 | 远端原状 | 本次整合 |
| --- | --- | --- |
| 取流请求编号隔离，包括 A→B→A 及旧请求清理 | 尚未覆盖；按歌曲身份判断可让旧请求提交/清理新请求 | 结果、错误、回退、重试和清理均受请求编号保护 |
| 预加载持久化实际取流身份 | 已有直接/候选缓存身份透传及 Vue 代理解包 | 复用远端对象 IPC 与 `musicInfo` 存储字段；补全直接取流身份、等待持久写入、禁换源门禁、旧/损坏缓存重新取流、写入失败仍播放；预加载传递已有备用条目 |
| 只有实际播放后的主动短听跳过才形成口味负反馈 | 已有倍速听完与短曲互斥、stop 冻结和退订清理，但未区分切歌原因 | 携带 user/ended/error/removed 原因；无播放、错误/停止中断、自然播尽、删除切换不回注 skips；恢复播放后允许主动跳过。墙钟指标计时及远端退订/重锚行为保留 |
| 听完/收藏背书的隐式续补 | 正向背书无条件续补；切歌只在安排时检查设置 | 在防抖、发起、重试及提交阶段检查开关和队列阈值，显式反馈/调参优先且仍可主动补歌 |
| CI 与本地开发配置 | 缺少两个本地提交的增量 | 增加类型检查/测试门禁，push 包括 fix 分支；保留本地开发配置 |

远端平台与旧 AI/local 来源身份投影、别名去重、种子定位、主备音源就绪清理、备份代理解包、在线菜单和歌单同步修复均继续保留。

验证先在远端原始生产代码上运行相关 5 文件/57 项用例通过，再加入本地回归复现 3 文件/28 项失败（其中两项是测试 EventEmitter 在缺少 error 订阅时抛错）。另外以延迟写入验证单独复现预加载提前返回失败。整合后全量 `npm.cmd test` 为 53 文件/831 项通过，`npm.cmd run typecheck` 、`npm.cmd run lint` 全量检查、`npm.cmd exec -- eslint e2e/onlineCache.test.ts` 专项检查与 `git diff --check` 通过；`npm.cmd run build` 四个生产构建通过。缓存回归移至 `e2e/onlineCache.test.ts`，因为覆盖真实渲染 IPC 与主进程数据库边界；与本目录其他 `.test.ts` 一样是替换 IPC 传输/数据库读写的 Vitest 跨模块测试，不代表 Electron GUI E2E。

本轮使用 Windows 现有依赖，未重装依赖、运行 GUI E2E、访问真实音乐提供方、调用真实 LLM、试听或生成发行安装包。`pnpm-workspace.yaml` 的 `allowBuilds` 原本为占位字符串，按本地提交保留；未验证 pnpm 安装策略。历史文档中的跨平台/E2E/独立审核结果不能替代此次验证。
