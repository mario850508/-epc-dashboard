# 陽光管理主控台（Sunshine Management Console）

給 Claude Code 的專案說明。這份檔案放在 repo 根目錄，Claude Code 每次啟動都會自動讀取，
不用每次開新 session 再貼一次交接摘要。`epc-backend`、`epc-dashboard` 兩個 repo 都放一份
（內容一樣即可）。

## 專案是什麼

陽光（太陽能 EPC 代管）用的內部管理主控台。協調 12 間 EPC 廠商（三創、尚展、曙光、光鼎、
宇陽達、聚曜、澄品、大昇、展亦、凰太竹、國欽、振庭）的出貨排程、案場進場、掛表、料件庫存，
以及掛表後的現場驗收流程。資料庫是 Airtable，前端純手機也能用。

## 架構（刻意保持極簡，不要引入框架/build step）

- **後端**：`epc-backend` repo，Flask（`app.py`，單一檔案），Render Web Service
  部署，網址 `https://epc-backend-4aj2.onrender.com`。啟動指令
  `gunicorn app:app --workers 1 --threads 4 --timeout 300`，搭配 `gunicorn.conf.py`
  的 `post_fork` hook。
- **前端**：`epc-dashboard` repo，主控台是 `index.html`、業務填單頁是 `book.html`（外加 `book-tutorial.js`）（vanilla JS + 內嵌 CSS，
  沒有框架、沒有 build step），Render Static Site 部署，網址
  `https://epc-dashboard-ee5f.onrender.com`。改完直接整份檔案 push 上去就是部署。
- **資料庫**：Airtable「【電廠】案場管理」Base（`appj1wnO3WnRtIEvg`）。

### 主要 Airtable 表
| 表名 | Table ID | 用途 |
|---|---|---|
| 專案細節 | `tblf6BPFcanBjHbaJ` | 案場主表 |
| 進度管理 | `tblxeiUluMFOBI2ci` | 里程碑日期（併聯審查/同意備案/細部協商/台電購售契約/免雜/掛表等） |
| 採購-逆變器 | `tbl7l7OM63jo3pxDN` | 逆變器規格，一顆實體設備一筆記錄 |
| APP資料 | `tblafnN1qFDoLgTx1` | 萬用表：案件額外狀態同步（完工/異常/撤案/植筋）+ 註記清單（未使用料件/料件使用/電話紀錄） |
| 維運驗收 | `tbl0qVhhjkwj200RP` | 掛表後現場驗收單，跟專案細節雙向連結 |
| 廠商資料 | `tblAbT7VocQUIj3zW` | 12 間廠商簡稱↔公司全名對照 |
| 廠商時段協調 | `tbl4paq7aP2itEOk0` | 已預約的現場時段（含屋主姓名電話、備註、已前日提醒） |
| 廠商時段任務 | `tblgNebQ0zj2Sg2Cy` | 指派給業務的任務（token 連結、回覆期限、安排人員＝建立人、備選時段） |
| 業務LINE綁定 | `tblkTLFeRSvqsVpBi` | 業務／安排人員的名字 → LINE userId |

## ⚠️ 踩過的坑（務必先看）

1. **Airtable Single Select 新增選項要手動加。** APP資料表的「類型」欄位、維運驗收的「狀態」
   欄位等，任何 Single Select 欄位要寫入一個新的選項值之前，一定要先去 Airtable 網頁手動
   新增該選項，不然後端寫入會噴 `INVALID_MULTIPLE_CHOICE_OPTIONS`。這個坑踩過非常多次
   （隱藏型號、電話紀錄、料件使用、廠商欄位…）。
2. **Rollup/公式欄位不能外部寫入。** 電廠模組片數、逆變器數量都是計算欄位，API 寫不進去，
   一律改成寫入子表的個別記錄（`採購-逆變器` 一顆設備一筆記錄，`數量` 都是 1）。
3. **gunicorn master/worker fork 問題。** 背景執行緒（scheduler、開機快取刷新）絕對不能寫在
   `app.py` 模組最外層，一定要放在 `gunicorn.conf.py` 的 `post_fork(server, worker)` hook
   裡才會在真正處理請求的 worker process 裡執行，不然 worker 的快取永遠是空的。
4. **手機版 CSS 沒有 `<meta name="viewport">` 完全不會生效。** DevTools 手機模擬器不受影響，
   容易忽略，真機測試才會發現。
5. **Airtable MCP／API 要帶 `returnFieldsByFieldId=true`**，不然欄位會用顯示名稱當 key，
   讀出來的值全部是空的。
6. **掛表日期要寫進「進度管理」里程碑表**，不是案場表上那個唯讀 lookup 欄位。
7. **`進度管理` 全表掃描會 timeout**，要用案場記錄上的里程碑連結欄位（拿到 record id）再批次
   查詢，不要整表掃。

## 除錯流程

Airtable 寫入失敗時：瀏覽器 DevTools → Network → 篩選關鍵字 → 找到失敗請求 → Response
分頁 → 看 `detail` 欄位的真實錯誤內容，不要用猜的。

判斷是快取沒刷新還是真的程式錯誤：先看後端根目錄 `/` 的健康檢查頁面（`last_error`、
`cache_updated_at`），用無痕視窗或加隨機 query 參數避免瀏覽器/CDN 快取干擾。

## 前端結構慣例（改 index.html 時照抄這些 pattern）

- **Sidebar 模組**：目前三個一級模組 — PDF 公文更名 / EPC 出貨排程 / 維運團隊，都是
  `data-view="xxx"` + `onclick="toggleNavSection('xxx')"`，對應 `<section class="view" id="view-xxx">`。
  切換邏輯是 `showView(name)`，會記錄到 `localStorage`（`epc_nav_state`），重整不會跳回總覽。
- **模組內分頁**：EPC 模組用 `showEpcTab(tab)`，`.tabs` + `.tab[data-tab=...]` + 對應
  `.tab-content`。PDF 模組有自己獨立一組 `showPdfTab()`。
- **資料流**：`fetch(API_BASE + '/api/...')` → 存進全域陣列（`PENDING_CASES`、`ENTRY_CASES`、
  `COMPLETED_CASES`、`APP_CASE_STATUS`、`APP_NOTES`、`APP_ARCHIVED` 等）→ 呼叫對應的
  `render{X}Table()`/`render{X}List()` 重新組 `innerHTML`。背景每 6 秒自動同步一次
  （`autoSyncTimer`），頁面在背景分頁時降頻。
- **表格排序/篩選**：欄位標題 `onclick="set{X}Sort('key')"`，配 `{x}SortKey`/`{x}SortAsc`
  全域變數，`localeCompare(...,'zh-Hant')` 中文排序；篩選用 input 的 `oninput`/`onchange`
  直接重呼叫 render 函式，在 render 內部先 filter 再 sort。
- **Modal 慣例**：固定結構 `<div class="modal-overlay" id="xxxModalOverlay">` +
  `.modal-box > .modal-header + .modal-body`，用 `.classList.add/remove('show')` 控制顯示
  （CSS `display:none` 預設，`.show{display:flex}`），不是動態插入/移除 DOM。開關函式固定命名
  `openXxxModal()` / `closeXxxModal()`。
- **廠商篩選**：全域廠商篩選存在 `GLOBAL_VENDOR_SCOPE`（localStorage 同步全分頁），不要每頁
  自己重寫一份廠商下拉篩選邏輯。

## 維運團隊模組（最新完成的功能）

掛表安排頁設定「預計掛表日期」成功時（`upsert_case_status()`），背景執行緒自動在「維運驗收」
建立/更新對應記錄。現場人員用手機填 44～50 項檢查清單、設備清單、雙方簽名（Pointer Events
畫布，支援觸控），可產生 PDF（`build_acceptance_pdf()`，用 reportlab）。

PDF 排版經過約 10 輪跟公司實際 Google Sheets 範本比對修正，細節（表頭三格式、checkbox
向量繪製、大類/小項分隔線規則、業主/系統商簽名區緊接在檢查表格下方等）如果要再調整，
直接看 `app.py` 裡 `build_acceptance_pdf()` 這個函式，裡面每一段都有註解說明為什麼這樣排版。

7 支相關 API：`GET /api/ops-cases`、`GET/POST /api/ops-acceptance/<id>`、
`DELETE /api/ops-acceptance/<id>`、`POST /api/ops-cases/manual`、
`POST /api/ops-acceptance/<id>/generate-pdf`。

`requirements.txt` 需要 `reportlab`、`Pillow`（已加）。

## 工作習慣

- 溝通偏好簡潔，常用截圖說明問題。
- **每次改動後會實際部署測試、拿真實案場資料驗證，再回報結果**，所以修改後如果有可能
  影響排版/計算邏輯的地方，主動說明「這裡我做了什麼假設、可能要注意什麼」。
- 「先有介面才有方向」——很多設計是漸進式在測試中確認下來的，不用一次到位想完美。
- 大功能通常會開新的交接文件/新 session 處理，避免同一個 context 混雜太多主題；用 Claude
  Code 之後這個限制比較沒那麼必要，但 commit 訊息/PR 描述最好還是把「這次改了什麼」講清楚，
  方便回頭查。

## 2026-10 起新增的長期規則（廠商時段協調／LINE 通知）

**進度與交接**：先讀 `PROGRESS.md`（已完成／待辦／已決定的規則／卡住的問題），做完事情立刻更新它。

**前端不只 index.html 了**：`epc-dashboard` 還有 `book.html`（業務公開填單頁，token 連結、不用登入）
和 `book-tutorial.js`（填單頁圖文教學）。改 `book-tutorial.js` 要同步改 `book.html` 裡
`<script src="book-tutorial.js?v=N">` 的版本號，不然瀏覽器會吃舊快取。

**屋主版頁面 owner.html**：給外部屋主看的頁面，**不可以回傳或顯示任何內部資訊**（案號、別名、廠商、
屋主預設資料、回覆期限）。例外：**施工地址會顯示**（2026-10-08 使用者決定，讓屋主確認是自己的案子）。後端 `/api/owner-booking/*` 只回去識別化欄位；改這些 API 時要守住這條。
屋主版跟業務版用不同 token，不要用網址參數切換版本。

**Airtable 新增選項**：用 Airtable MCP 的 `create_records_for_table` 並設 `typecast: true`，可以直接
新增 Single/Multiple Select 的選項（2026-10-05 用這招新增「進場」）；REST API／`update_field` 做不到。
測試記錄建完要刪掉。

**排程（APScheduler）**
- `CronTrigger(...)` 物件預設用「伺服器時區」（Render＝UTC），**不是** `BackgroundScheduler(timezone=...)`
  的時區 → 新增排程一律明確寫 `timezone="Asia/Taipei"`。
- 新排程一律加 `misfire_grace_time=900, coalesce=True, max_instances=1`，執行緒池忙時才不會被略過。
- 既有的舊排程（每天 7:30 回填場勘日、場勘快取 0/20/40 分）可能仍是 UTC，改動前先確認。
- 「只發一次」類排程的去重標記必須存 Airtable（勾選欄位或「系統狀態」表），不可只放記憶體——Render 閒置重啟會清空，導致重複發送。
- 排程狀態看 `GET /api/line/status`；手動跑用 `POST /api/line/run-job`（需同步密鑰，會處理**真實**資料，會真的發 LINE）。

**LINE 機器人**
- 只用 push（token 在 Render 環境變數），webhook 在別的服務；userId 一律靠 LIFF 綁定取得，存「業務LINE綁定」表。
- LINE 通知一律用卡片（`_card` + `_line_push_card`），不要再直接組純文字；新通知要在卡片標題標明「給誰」並沿用既有色彩。
- 測試時不要在「預覽業務填單畫面」按綁定（會把使用者自己的 LINE 綁到業務名下）。
- 測試會發 LINE 給真人 → 測試案號標「測試…(請忽略)」，測完刪測試任務／預約／綁定紀錄。
- 廠商欄位是 Single Select，測試任務的廠商只能用既有選項（三創／尚展…），否則寫入會失敗。

**本機工具**
- 這台電腦 `python` 是空殼，要用 `py`；anaconda 的 python 沒有 SSL，要打 HTTPS 用 curl。
- Git Bash 的 curl 參數直接放中文會亂碼 → 用 `--data-binary @檔案`、`--data-urlencode "k@檔案"`。
- 多行修補腳本用 Write 工具寫成檔案再跑，不要在 Bash heredoc 裡放反斜線跳脫（會被吃掉）。
- 沒有 node，前端 JS 用瀏覽器 pane 的 javascript_tool 驗證；瀏覽器有快取時網址加 `?v=N`。

## 2026-10-09 起：多個對話共用 repo、登入保護、名字統一

**多個對話同時改同一個 repo（會發生推送被擋、互相覆蓋）**
- 動手前先 `git pull --rebase origin main`；每個小功能做完就 commit、馬上推，不要累積一大包。
- 推送一律用 `../push-safe.sh`（先 rebase 再推）。被擋時**不要 force push**、不要整檔覆蓋，先看遠端多了什麼（`git log HEAD..origin/main`）。
- 分工：PDF 公文更名／採購專區／本機背景程式（`tools/`）是「PDF 對話」在改；廠商時段協調／LINE 通知／屋主版／登入保護是「預約對話」在改。不要順手重排或搬動對方負責的區塊。
- 廠商時段協調的前端已拆到 `epc-dashboard/slots.js`（原本在 index.html 中間，現在在同一位置用 `<script src="slots.js?v=N">` 載入，執行順序不變）。改 slots.js 後，**index.html 裡的 `?v=N` 要 +1**。以後新的大功能也請獨立成自己的 js 檔，不要再往 index.html 塞。

**登入保護（後端 app.py 最上方的 `_auth_gate`）**
- 後端設了環境變數 `DASHBOARD_PASSWORD` 才會啟用（沒設＝完全關閉，跟以前一樣）。啟用後所有 `/api/*` 預設都要登入（Bearer token），**新增的 API 也一樣預設受保護**。
- 只有「知道連結才能用」的 token 端點才可以公開：加進 `AUTH_PUBLIC_PREFIXES`／`AUTH_PUBLIC_EXACT`。**公開端點不可以回傳個資或內部資訊。**
- 機器呼叫（本機背景程式、Claude 排程、curl 測試）帶 `X-Service-Key: <SERVICE_KEY 或 BIZ_SHEET_SYNC_KEY>`。
- 本機 PDF 背景程式（`tools/pdf_watcher.ps1`、`pdf_learn.py`）目前還沒帶金鑰，那幾支在 `AUTH_MACHINE_*` 名單裡「過渡期放行並記錄」（`GET /api/auth/machine-hits`）。程式更新帶金鑰後，Render 設 `AUTH_ENFORCE_MACHINE=1` 才會一起鎖上。**改 watcher 時請讓它送 `X-Service-Key` 標頭。**
- 主控台前端靠 `auth.js` 包住 `fetch` 自動帶 token；`<a href>` 下載連結要用 `epcAuthUrl(url)` 加 `?access_token=`。
- CORS 只允許主控台網址（`CORS_ORIGINS` 可覆蓋）。

**業務名字統一**
- Airtable「業務名單」表（姓名＋別名）是唯一標準。後端寫入業務姓名前一律過 `_canon_rep()`（任務指派對象、預約登記人、LINE 綁定）；前端用 `canonRep()`。新增／離職的業務直接在 Airtable 表改。
- 指派視窗的「指派給」是下拉＋可自己打；打的名字不在名單上就維持原樣、不會被合併，所以要提醒使用者先把新業務加進名單。

**排程與重啟**
- 所有 `CronTrigger` 的時間都要寫 `timezone="Asia/Taipei"`（物件預設吃 UTC）；`GET /api/line/status` 的 `scheduler_jobs` 看得到下次執行時間可以驗證。
- 任何「只存在記憶體、來源是外部推送」的資料（業務自治區的已公證案件、取消案號、座標、公證書屋主資料）都要存快照：Airtable「系統狀態」表（分段 `key#0…`＋`key#n`），用前先 `_ensure_biz_snapshots_loaded()`。Render 閒置會重啟，記憶體會清空。
