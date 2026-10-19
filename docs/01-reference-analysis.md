# 第一阶段：参考资料盘点与初步分析

> 状态：分析报告，非最终设计。
> 日期：2026-10-19
> 范围：`docs/references/` 下 3 个目录，共 61 个源文件（不含 `.git`）。
> 标注约定：**【事实】** = 有代码或实测证据；**【推测】** = 由代码推断但未在实机验证；**【待确认】** = 信息不足。

---

## 0. 资料索引

| 目录 | 性质 | 规模 | 可读性 | 对本项目的价值 |
|---|---|---|---|---|
| `poi-plugin-drop-expect` | **旧实现**（本人） | 14 文件 / ~1.9k 行，无 git | 完整可读 | 功能最贴近目标；采集链路未接通（见 §3） |
| `poi-plugin-drop-counter` | 参考插件（第三方） | 30+ 文件，含 `.git`、`docs/research.md`、`docs/plan.md`、`TODO.md`、6 个测试文件 | 完整可读 | **工程范式**与点位/掉落建模的最佳样本 |
| `plugin-wheres-my-fuel-gone` | 参考插件（第三方，v0.7.0） | 2.2k 行，含 `.git` | 完整可读 | **每次出击资源计量**的唯一可靠实现 |

三个目录互不重叠，且各自覆盖需求的 1/3：

```
drop-counter      →  点位 / 出击 / 到达 / 掉落  （没有资源）
wheres-my-fuel-gone → 每次出击的油弹钢铝桶      （没有点位/掉落/期望）
旧实现 drop-expect  →  概率表 / 预算 / 曲线 UI  （数据来源全部落空）
```

---

## 1. `plugin-wheres-my-fuel-gone`（下称 WMFG）：资源计量参考

### 1.1 计量方式【事实】

在 `api_req_map/start` 时对**每艘船**做快照（`views/redux/sortie.es:100`）：

```js
{ id, shipId, fuel: api_fuel, bull: api_bull, repair: api_ndock_item, onSlot: api_onslot }
```

在 `api_port/port` 时用 `body.api_ship` + `body.api_deck_port` 与快照逐船差分（`views/redux/records.es:45`）：

| 资源 | 公式 |
|---|---|
| 燃料 | `(start.fuel - now.fuel)`，结婚舰 `×0.85` 向下取整 |
| 弹药 | `(start.bull - now.bull)`，同上 |
| 铝 | `5 × Σ(startSlot - nowSlot)`（每损失 1 架 5 铝） |
| 修理油/钢 | `now.api_ndock_item[0/1] - start.repair[0/1]`（当前状态下的入渠估价差） |
| 桶 | 由 `api_req_nyukyo/start`（`api_highspeed==1`）与 `speedchange` 回查最近一条出击记录打标 |
| 喷式强袭钢 | 按装备 199/200 的 `0.2 × count` 估算 |
| 支援舰队 | 按远征满补给估算（`shipExpeditionConsumption`） |
| 陆航 | 按 NGA 公式估算出击/被破坏/补给三项 |

### 1.2 值得直接借用的一点【事实】

`checkConsistent`（`records.es:23`）：出击前后核对舰队编成（`api_deck_port[deckId].api_ship` 与快照的 ship id 序列一致），不一致就**丢弃这条记录**。作用是把"中途关 poi / 换设备 / 任务链变化"造成的脏数据挡在统计之外。这正是本项目的期望计算所依赖的输入质量。

### 1.3 局限

- 只记录"每次出击总消耗"，**不区分点位**，无法回答"到 K 点这一趟花多少"。
- 无掉落、无到达率概念。
- 停更在 0.7.0（poiPlugin.apiVer 上限 8.3.0），代码是 `.cjsx` 时代的写法。

### 1.4 结论

对"资源消耗"这一半需求，**WMFG 的逐船差分法是唯一被证实可用的口径**（原因见 §5.2）。它的逻辑约 150 行纯函数，可以直接移植，而不必依赖它作为外部插件。

---

## 2. `poi-plugin-drop-counter`：点位 / 到达 / 掉落建模参考

### 2.1 最有价值的三个结论【事实，其 `docs/research.md` 有实测记录】

1. **`api_no` 是"边 ID"不是"格子号"**。`fcd.map[mapKey].route[api_no] = [from, to]`，到站格在 `[1]`。边→格是多对一（49-3 有 42 条边 / 28 个格），所以**不能用 `api_no` 判定到达**，必须在记录时归一化成格子字母。
2. **掉落只从 `api_get_ship` 取**。顶层的 `api_ship_id` 是敌舰舰种 ID 数组（1500 番台）；无掉落时 `api_get_ship` **键本身不存在**。
3. **`api_port/port` 的 `api_material` 不能用来算单次出击消耗**：出击消耗在 `api_req_map/start` 之前就已经扣除并反映在**上一个** port 里，port 与 port 的差只剩自然回复。

> 第 3 点与 WMFG 的做法并不矛盾：WMFG 用的是**船体状态差**，不是全局资源差。这条区分是本项目最关键的技术判断，详见 §5.2。

### 2.2 工程范式【事实】

- 状态在 `store.ext[包名]._`（poi 用 `combineReducers({_: func})` 包了一层），漏掉 `_` 会让 selector 恒取 undefined，且症状与"还没数据"完全一样。
- poi 会给 reducer 传入**第三参数 = root state**；reducer 执行期间 `getStore()` 会被内层 `combineReducers` 的缓存污染，**读 `fcd.map` 必须走第三参数**。
- 副作用（写文件、取 fcd）通过 `setXxxProvider` / `setDumpSink` 从 `index.es` 注入，reducer 保持纯函数 → 可以 `node --test` 跑 109 个测试而不需要 poi。
- 持久化：`APPDATA_PATH/drop-counter/records.json`，`$dataVersion` 版本号、白名单字段、临时文件 + rename、坏文件退避 `.bak`、500ms debounce、`pluginDidLoad` 里**同步**恢复后再挂 observer。

### 2.3 局限

- 完全不做资源（作者判断不可行）。
- 记录粒度是"一次出击"，session 维度是"海域+目标格+目标舰"，**没有"掉落率"这个输入概念**，只有实测到达率/掉落率。

### 2.4 结论

本项目的**记录骨架**（会话 → 出击 → 记录 → 派生指标）与**测试/持久化范式**可以直接沿用；它缺的"资源"和"期望"，正是 WMFG 与旧实现各自补的那块。

---

## 3. 旧实现 `poi-plugin-drop-expect` 分析

### 3.1 原始设计意图（从代码还原）【事实】

- **点位**：手工输入 `海域-图号-格子-难度`（如 `62-1-X 甲`），存为 `points`。
- **目标舰**：名称/ID 手输或搜索，掉落率手输或从 kcwiki 抓取，存为 `targets`（挂在 pointId 下）。
- **计算**：
  - 单舰：`P(n) = 1-(1-p)^n`，`n = ceil(ln(1-t)/ln(1-p))`（`utils.es:64-73`，正确）。
  - 多舰"全获得"：`P_all(n) = ∏(1-(1-p_i)^n)`（`utils.es:77`，近似式）。
  - 资源：平均单次消耗 × n；再与当前资源相减得到"剩余资源"。
- **展示**：概率预设表 + 剩余资源表 + SVG 概率曲线 + kcwiki 采集弹窗。

这套**表意**是合理的，目标用户能看懂；问题几乎全部在"数据从哪来"。

### 3.2 已定位的缺陷（按严重度）

| 编号 | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| **D1** | **自动采集链路从未接通** | 全仓库无人 dispatch `sortieStart`；`sortie` reducer 只处理该自定义 action；`records.es:21` 读 `sortieInfo._ready`，而 `_ready` 在全仓库**只被读、从未被写**（`grep -rn _ready` 仅 1 处命中） | `api_port/port` 分支恒 `return state`，自采记录永远为 0 |
| **D2** | ~~WMFG 数据导入路径必然落空~~ **→ 2026-10-19 复核：路径实际可用** | 旧实现 `path.resolve(__dirname,'../../..','wheres-my-fuel-gone')`；插件装在 `%APPDATA%/poi/plugins/node_modules/poi-plugin-drop-expect`，上三级恰好是 `%APPDATA%/poi`，与 WMFG 的 `APPDATA_PATH/wheres-my-fuel-gone/{id}/sortie_records.json` 一致。本机确认该目录存在（`8025940/sortie_records.json`，11MB） | **不是缺陷**。但代价是：消耗数据依赖 WMFG 同时在跑；插件若换安装位置（如手动放进 `plugins/` 直属目录）就会失效 |
| **D3** | 自采消耗用**全局资源差** | `views/redux/sortie.es:96` `resourceDiff = beforeRes - nowRes` | 与 drop-counter 的实测结论冲突：差值只剩自然回复，会得到 0 甚至正数（`Math.max(0,…)` 把负值抹平，掩盖错误） |

| **D4** | 消耗只按**海域**聚合，不按点位 | `buildSortieKey = area-mapinfo`，`recordsForPointSelector` 只用 wmfg 过滤器，无 cell 维度 | 平均消耗混入了没打到目标点的出击 |
| **D5** | **完全不建模到达率** | 全文无 reach 概念 | 有撤退时严重低估所需次数。以 p=3% 为例：到达率 100% → 76 次；80% → 95 次；60% → 127 次（99% 时差距更大） |
| **D6** | 「自定义出击次数」只改除数 | `effectiveAvg = avg * (count/effectiveCount)` | 分子（总资源）没变，把平均数按比例缩放，数学上无意义，且会给出错误预算 |
| **D7** | 设置落盘路径错 + 无 debounce | `index.es:14` 写到 `__dirname/../../../poi-plugin-drop-expect-settings.json`；`writeFileSync` 在 `componentDidUpdate` 里每次变化同步写 | 设置无法跨版本保留；可能写进 plugins 目录 |
| **D8** | 硬编码深色主题 | `color:'#1e1e1e'`、`#dcdcdc` 等 40+ 处内联样式 | 浅色主题下不可读（poi 支持双主题） |
| **D9** | 单体组件 1263 行、零测试、依赖未声明 | `views/index.es` 1263 行；`package.json.dependencies = {}` 却 import `lodash`/`reselect`/`path-extra` | 不可维护；无回归保护 |
| **D10** | 30 秒轮询读文件代替事件 | `index.es:91` `setInterval(doLoad, 30000)` | 与 poi 生命周期脱节，且掩盖了 D1/D2 |
| **D11** | kcwiki 结果把 `(无)` 当舰船 | 接口含 `"(无)": {rate: 40.19}` 条目（见 §4.2），旧实现只过滤 `totalCount<=0` | 「无掉落」会出现在可选舰船列表里，且名称模糊匹配有误命中风险 |
| **D12** | kcwiki 请求未处理 CORS 与错误分类 | 接口**无** `Access-Control-Allow-Origin`（实测响应头） | 渲染进程 `fetch` 可能被拦（**待实机验证**）；404（该图/难度未收录）与 200+空（无样本）被当成同一类错误 |

### 3.3 数学层面的再审视

- 单舰分位数公式正确，`ceil` 取法正确（"至少 n 次"）。
- **"全获得"用了独立性近似，与真实模型有偏差**。真实约束是"一次到达最多掉一艘"，各舰在同一次内互斥（负相关）。实测对比（精确 DP vs 乘积近似）：

  | 舰数/概率 | n | 精确 | 近似 | 偏差 |
  |---|---|---|---|---|
  | p=[3%,2%] | 50 | 0.4947 | 0.4972 | +0.25pp |
  | p=[10%,3%,2%] | 50 | 0.4919 | 0.4946 | +0.27pp |
  | p=[30%,30%] | 5 | 0.6741 | 0.6921 | **+1.80pp** |
  | p=[20%,20%,20%] | 10 | 0.6959 | 0.7112 | +1.53pp |

  低概率下偏差可忽略，高概率（活动图常见 10~30%）会偏乐观 1~2 个百分点。精确解用 2^k 状态 DP 即可（k≤10 时 1024 状态 × n 步），成本极低。
- 缺少"**期望值**"这一档：`E[次数] = 1/p`（p=3% 时为 33.3 次，而 90% 档是 76 次）。玩家常见的"平均要刷多少次"与"多少能稳"是两个问题，旧实现只回答了后者。
- 缺少"**反算**"：给定现有资源，最多能刷多少次 → 成功率是多少。旧实现只有正向的"剩余资源"。

---

## 4. 实测核验（本次新增的事实）

### 4.1 kcwiki 掉落接口

前端脚本 `https://db.kcwiki.cn/scripts/drop/map2.js` 里可直接读到请求式：

```js
$.getJSON('/api/cache/drop_map_' + id + '_' + point + (level > 0 ? '-' + level : '') + '-' + rank, ...)
```

**实测结论【事实】**：

| 项 | 结果 |
|---|---|
| `id` 编码 | `海域 × 10 + 图号`（2-2 → `22`；E1 → `621`，实测 `drop_map_621_A-1-SAB` 有数据） |
| `point` | 大写格字母（`A`/`B`/`K`…） |
| `level` | 仅活动图追加，`1~4` = 丁/丙/乙/甲；普通图省略 |
| `rank` | 仅支持 `SAB` / `SA` / `S` / `A` / `B`（`AB` 实测 404） |
| 404 | 该图或该难度**不存在**（`drop_map_27_E` → 404） |
| 200 + `data:{}` | 图存在但**无样本**（`drop_map_22_C` → `totalCount:0`） |
| 响应字段 | `totalCount`（该点该评价的**战斗结果总数**）、`timeRange`、`data[舰名] = {rankCount:[S,A,B], totalCount, rate, hqLv, enemy, own}` |

**掉落率的分母已确认**：`data` 里有一个特殊条目 `"(无)"`（= 无掉落），2-2 B 的 `(无)` 占 40.19%；且 `Σ 所有条目 totalCount == totalCount`（186182）。因此

```
p(单次到达某舰) = rate / 100         ← 已经包含「无掉落」的情形，可直接当前提概率用
P(本次无掉落)   = (无).rate / 100
```

**必须显式排除 `"(无)"`**，否则会被当作一艘叫「(无)」的船。

**数据新鲜度的风险【事实】**：三份缓存的 `generateTime` 均为 `2026-09-28`（同一批次），`timeRange` 为滚动 30 天（`2026-08-29 ~ 2026-09-28`），而今天是 `2026-10-19`。即**数据窗口是"截至上次批量重建的 30 天"，可能滞后数周**。→ 必须显示数据窗口与抓取时间，并支持手工覆盖概率。

**CORS 风险【事实 + 待确认】**：响应头无 `Access-Control-Allow-Origin`。渲染进程直接 `fetch` 很可能被拦；备选是 Node 的 `https` 模块（绕过同源策略）。**需在实机验证**，这会决定 `services/` 层怎么写。

### 4.2 舰船 ID ↔ 名称

- poi 自带 `state.const.$ships`（`api_id` / `api_name` / `api_yomi` / `api_aftershipid`），够用，**不需要**额外拉 `kcwikizh.github.io/kcdata/ship/all.json`（3.1MB，旧实现用了）。
- kcwiki 的 `data` 键是**日文舰名**（`村雨`、`祥鳳`、`利根`），与 `$ships.api_name` 基本一致，但仍需处理改名/改装同名/未收录 → **名称匹配必须有"未匹配"状态与手工兜底**，不能静默取近似。

### 4.3 资材可测性对照

| 做法 | 数据来源 | 是否可行 | 证据 |
|---|---|---|---|
| 全局资源差 | `info.resources` 或 `api_port/port.api_material` | ❌ | 消耗在 `start` 前已扣除（drop-counter 5 次出击实测，差值只剩自然回复） |
| 逐船状态差 | `api_ship` 的 `api_fuel/bull/onslot/ndock_item` | ✅ | WMFG 已长期使用；`api_ndock_item` 提供"当前状态入渠价"，无需等实际入渠 |
| 旧实现的选择 | 全局资源差 | ❌ | 即 D3 |

---

## 5. 能力矩阵：需求 vs 三个实现

| 需求项 | WMFG | drop-counter | 旧实现 |
|---|---|---|---|
| 掉落率来源（外部数据） | ✗ | ✗（只有实测） | ◐ kcwiki 抓取，路径正确、解析基本正确 |
| 掉落率手工录入 | ✗ | ✗ | ✓ |
| 目标多舰 | ✗ | ✓ | ✓ |
| 达到概率所需次数（单舰） | ✗ | ✗ | ✓ 正确 |
| "全获得"式期望 | ✗ | ✗ | ◐ 近似，偏乐观 1~2pp |
| 期望值 E[n]=1/p | ✗ | ✗ | ✗ |
| 单次出击资源消耗 | ✓ **可靠** | ✗ | ✗ 链路死 / 口径错 |
| 按点位归集消耗 | ✗（只按海域） | ◐（有格子，无资源） | ✗ |
| 到达率 | ✗ | ✓ | ✗ |
| 反算（资源 → 次数 → 概率） | ✗ | ✗ | ✗ |
| 持久化 | ✓（fs-extra） | ✓ **最完善** | ✗ 路径错 |
| 主题适配 / i18n | ✓ | ✓ | ✗ 硬编码深色 |
| 测试 | ✗ | ✓ 109 个 | ✗ |

**没有任何一个实现同时具备"掉落率输入 + 资源计量 + 到达率"**。三者拼起来才是本项目。

---

## 6. 需求缺口与冲突（需你确认）

按对架构影响从大到小排列。**建议先只回答 Q1**，其余可以后置。

**Q1（最关键）产品形态：纯计算器，还是"采集 + 计算"？**
- A. 纯计算器：掉落率手输/抓取，单次消耗手输（如"约 350/420/120/40/0.3 桶"），只做概率与预算。优点：一天能做完，零风险。缺点：消耗靠估，与"资源消耗计算"的诉求有落差。
- B. 采集 + 计算：自己记录每次出击的资源与到达/掉落，实测平均消耗，再算期望。优点：数字是真的。缺点：需要实机反复验证 API 细节（连合舰队、支援、陆航、入渠口径都要定）。
- C. 分级：先做 A，把采集做成可插拔的数据源（先支持手工输入平均消耗，后续接自采）。我倾向这个，但需要你确认是否接受"先只有估算值"。

**Q2 "期望"的语义**
单舰达成 / 目标集合中"至少一艘" / 目标集合"全部收集"（后者需要 2^k DP）。旧实现默认是第三种，但玩家日常问的是第一种。

**Q3 资源口径**
- 入渠修理是否计入？（WMFG 用的是"当前状态入渠价"，含蓄假设"打完就修"）
- 桶是否计入？（需要 `nyukyo` 事件回填）
- 支援舰队 / 陆航是否计入？（WMFG 是估算，误差来源）
- 是否区分"单次出击消耗"与"含入渠的完整成本"

**Q4 掉落率的可信度处理**
kcwiki 数据是 30 天滚动窗口、可能滞后数周、样本量差异极大（2-2 B 有 18 万样本，冷门点可能只有几十）。是否需要：显示样本量 / 样本不足时警示 / 手工覆盖优先级高于抓取 / 抓取结果本地缓存？

**Q5 是否需要反算**
给定现有资源 → 最多刷多少次 → 成功率多少；以及"资源够不够达到 90%"。

**Q6 是否需要实测校准**
用自己刷的数据（到达数、掉落数）反推 p，与 kcwiki 并列显示。这是 drop-counter 的能力，接进本项目成本不高，但会显著增加状态与 UI。

**Q7 其他**
poi 最低版本、i18n 语种（中/日/英）、是否需要独立的"窗口模式"、事件海域 ID 复用如何隔离（drop-counter 用 session 解决）。

---

## 7. 技术雏形（讨论素材，不是最终设计）

若 Q1 选 B/C，建议的最小结构：

```
index.es                 导出 reactClass / reducer / pluginDidLoad / windowMode
                         注入副作用：fcd 表、文件读写、http 客户端
redux/
  index.es               api_req_map/start|next, battleresult, port  → inFlight → record
  sortie.es              纯函数：建 inFlight、累加格子、累加战果、船体快照、收口
  spot.es                边ID → 格子字母（fcd.map，含 "?23" 未解析回退）
  session.es             目标（海域/格子/难度）定义与切换
calc/
  probability.es         单舰分位、E[n]、全收集 DP、任意"至少 k 艘"
  cost.es                次数 × 单次消耗；桶；与现有资源比较；反算最大次数
services/
  kcwiki.es              掉落率抓取（Node https）、缓存、样本量、错误分类
store/
  p-state.es             APPDATA_PATH 下 records.json，$dataVersion + 白名单 + rename
  observer.es            变化即存（debounce）
views/
  panel / point_editor / target_list / probability_table / budget / settings
test/                    node --test，纯计算与记录构建全覆盖
```

**一处三个参考都没有的整合点**：让 `inFlight` 同时携带「格子序列 + 每场战果 + 每船资源快照」，则**一次出击 = 一条记录，消耗与掉落天然对齐**。这样"到达率 × 单次消耗"才有统一的分母，D4/D5 两个缺陷从数据模型层面消失，而不是靠事后过滤。

---

## 8. 待确认事项汇总

| 类型 | 内容 |
|---|---|
| 【待确认】 | Q1~Q7 |
| 【待确认】 | kcwiki 在 poi 渲染进程里能否直接 `fetch`（CORS）。若不能，`services/` 用 Node `https` |
| 【待确认】 | 连合舰队时 `battleresult` 与 `api_ship` 的字段差异（drop-counter 也未验证，需一次连合出击的实测） |
| 【待确认】 | 入渠估价差在"同一出击内多船中破"时是否等于真实花费（WMFG 未说明，属【推测】） |
| 【事实】 | 掉落率分母 = 该点该评价的战斗结果总数，`(无)` 条目占 40% 量级 |
| 【事实】 | kcwiki 缓存非实时，可能滞后数周 |
| 【事实】 | 旧实现的自动采集链路未接通（D1）；WMFG 导入路径经本机复核**可用**（D2 已更正） |

---

## 9. 下一步

1. 你回答 Q1（以及愿意一并定的 Q2/Q3）。
2. 我据此给出 2~3 个可比较的方案（含成本与维护影响），再收敛成正式实现文档。
3. 若 Q1 选 B/C，正式编码前需要一次**实机 API 采样**：一趟普通图 + 一趟连合图，落盘 `start/next/battleresult/port` 原始 body，用来固定字段与口径。这是 drop-counter 走过的路，能省掉大量猜测。
