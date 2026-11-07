# 加入 Stripe：從測試模式到正式收款

> 狀態：程式已實作。`apps/api/src/billing/` 已有 Checkout、Customer Portal、
> webhook 驗簽與訂閱入帳；`20261109090000_monthly_point_reset.sql` 已在資料庫。
> 你要做的是 **Stripe 帳號設定 ＋ 環境變數 ＋ webhook ＋ 測試**。
> 方案與點數規則見 [SUBSCRIPTION_POINTS.md](./SUBSCRIPTION_POINTS.md)。

## 0. 先看懂整體流程

```
瀏覽器（/#/pricing）
   │ POST /api/billing/checkout（帶 Supabase access token）
   ▼
Cloudflare Worker
   │ 用 STRIPE_SECRET_KEY 建立 Checkout Session
   ▼
Stripe Checkout（託管付款頁）
   │ 付款成功 → 導回 /#/pricing?checkout=success
   │ 同時非同步送出 webhook
   ▼
POST /api/billing/webhook
   │ 驗 Stripe-Signature、事件去重（stripe_events）
   ▼
Supabase RPC billing_set_subscription
   → plan、period_end、monthly_points、points_reset_at
```

重點：

- 瀏覽器**不會**拿到 secret key，也不會自己加點。
- 方案與點數由 webhook 寫入 Supabase；前端只顯示 `/api/billing/me`。
- 價格的「金額」以 `packages/core/src/billing.ts` 為準；Stripe 後台建立的價格
  必須跟它一致（目前 Light $4.99／$49.90、Standard $9.99／$99.90、Pro $19.99／$199.90）。
- 測試模式與正式模式是兩套完全獨立的資料：價格 ID、secret key、webhook secret 都不同。

### 四個容易混淆的值

| 名稱 | 格式 | 用途 | 可放前端？ |
| --- | --- | --- | --- |
| Publishable key | `pk_test_...`／`pk_live_...` | Stripe.js 識別帳號 | 可以 |
| **Secret key** | `sk_test_...`／`sk_live_...` | 伺服器呼叫 Stripe API；本專案的 `STRIPE_SECRET_KEY` | **不可以** |
| Webhook signing secret | `whsec_...` | 驗證 webhook 真的來自 Stripe；`STRIPE_WEBHOOK_SECRET` | **不可以** |
| Price ID | `price_...` | Checkout 要買哪個價格 | 可以（不是機密） |

Secret key 在 Dashboard 的 **API keys** 頁（測試模式
<https://dashboard.stripe.com/test/apikeys>、正式模式
<https://dashboard.stripe.com/apikeys>），不是 Workbench 的 webhook 頁。測試模式的
secret key 可隨時 Reveal；正式模式自行建立的 secret key 只顯示一次，要立刻存好。

## 1. 建立 Stripe 帳號與測試價格

1. 到 <https://dashboard.stripe.com/register> 註冊。
2. 右上角保持 **Test mode**（測試模式）開啟。測試模式不需要銀行帳戶。
3. 左側 **Product catalog → Products → + Add product**，建立三個產品：

| 產品名稱 | 價格 1（Recurring / Monthly） | 價格 2（Recurring / Yearly） |
| --- | ---: | ---: |
| MengYin Light | US$4.99 | US$49.90 |
| MengYin Standard | US$9.99 | US$99.90 |
| MengYin Pro | US$19.99 | US$199.90 |

4. 每個價格建立時：
   - Currency 選 **USD**。
   - Type 選 **Recurring**（訂閱），不是 one-time。
   - Billing period 分別選 **Monthly** 與 **Yearly**。
5. 建立後點進每個價格，複製 **Price ID**（`price_...`）。總共六個：

```text
STRIPE_PRICE_LIGHT_MONTH=price_...
STRIPE_PRICE_LIGHT_YEAR=price_...
STRIPE_PRICE_STANDARD_MONTH=price_...
STRIPE_PRICE_STANDARD_YEAR=price_...
STRIPE_PRICE_PRO_MONTH=price_...
STRIPE_PRICE_PRO_YEAR=price_...
```

### 一鍵建立測試產品（可選）

不想在 Dashboard 手動建三次產品，可以讓工具代建（**只接受 test mode 的 key**）：

```bash
# 先把 sk_test_... 放進 .dev.vars 的 STRIPE_SECRET_KEY
npm run stripe:seed-test -- --write
npm run stripe:check
```

它會建立三個產品、六個價格，以及一個預設的 Customer Portal configuration，並把
六個 price ID 寫進 `.dev.vars` 的 managed block；原本的 live 值會保留成
`# [live] ...` 註解。可重複執行：產品用 metadata、價格用 lookup key 比對，不會
重複建立。沒有 Stripe CLI 也能測：它會產生一個本機用的 `STRIPE_WEBHOOK_SECRET`，
可用來簽測試事件。

### 哪裏複製 Price ID

**方法 1：Dashboard（最快）**

1. **Product catalog → Products**，點進你的產品（例如 `MengYin Study Light`）。
2. 頁面中間的 **Pricing** 區塊，每一列就是一個價格（$4.99/month、$49.90/year）。
3. 點該列右側的 **⋯ → Copy price ID**；或點進價格詳情頁，標題下方的 ID 就是
   `price_...`，可按複製。
4. 產品網址是 `https://dashboard.stripe.com/test/products/prod_...`；價格詳情頁是
   `https://dashboard.stripe.com/test/prices/price_...`（正式模式去掉 `/test`）。

**方法 2：Stripe CLI**

```bash
# 先找產品
stripe products list --limit 20

# 列出某個產品底下的所有價格（含 id、金額、interval）
stripe prices list --product=prod_VaFiRIQ5xcXh6x
```

**方法 3：curl**

```bash
curl -s "https://api.stripe.com/v1/prices?product=prod_VaFiRIQ5xcXh6x" \
  -u "sk_test_你的key:" \
  | jq -r '.data[] | [.id, .unit_amount, .currency, .recurring.interval] | @tsv'
```

輸出範例（`unit_amount` 是「分」）：

```text
price_1QxAbc...  499   usd  month
price_1QxDef...  4990  usd  year
```

- `price_...` 才是價格 ID；`prod_...` 是產品 ID，不能填進 `STRIPE_PRICE_*`。
- 測試模式與正式模式的 price ID 不同；切換右上角 Test/Live 後要重新複製。
- 如果產品頁的 Pricing 是空的，表示只建了產品、還沒建價格：按 **Add price**，
  選 Recurring、USD、Monthly 或 Yearly。
- 六個 ID 填好後跑 `npm run stripe:check`，它會直接告訴你哪個 ID 不存在或金額不對。

> 六個都要設定。只設部分價格時，方案頁仍會顯示可購買，但按下沒設定的方案會回
> 503「No Stripe price is configured」。
>
> **`prod_...` 是 Product ID，不是 Price ID。** 環境變數要的是 `price_...`。在產品頁的
> Pricing 區塊點開每個價格即可複製；也可以用 API 列出某個產品的所有價格：
>
> ```bash
> curl -s "https://api.stripe.com/v1/prices?product=prod_xxx" \
>   -u "sk_test_你的key:" | jq '.data[] | {id, unit_amount, currency, interval: .recurring.interval}'
> ```
>
> 一個產品可以有兩個價格（monthly／yearly），也可以每個 interval 各建一個產品；
> 程式只認 price ID，不認產品名稱。

### 產品類別（Product category／Tax code）要選什麼？

Stripe 產品頁的 **Product category／Tax code** 是 **product tax code（PTC）**，只給
Stripe Tax 計算稅率用；它**不影響**你的方案、點數、Checkout 或 webhook。沒有啟用
Stripe Tax 的話可以留空或沿用預設值。

這個 app 是 hosted、訂閱制、透過瀏覽器使用、不提供軟體下載的學習服務，最接近的候選是：

| 候選 | 代碼 | 適合 |
| --- | --- | --- |
| Software as a Service (SaaS) - Personal Use | `txcd_10103000` | 主要賣給個人學習者 |
| Software as a Service (SaaS) - Business Use | `txcd_10103001` | 主要賣給學校／補習班／企業 |
| SaaS - electronic download - Personal Use | `txcd_10103100` | 若你認為桌面版下載是主要交付方式 |

- 不要用 **General - Electronically Supplied Services**（`txcd_10000000`）帶過美國銷售；
  Stripe 文件明確建議選更具體的代碼。
- 稅務分類會依客群與國家而異，這是你的稅務決定；以上只是最接近的候選，請依實際情況
  或會計師確認。
- 同一個產品只能有一個 tax code；如果你的個人版與校園版稅率不同，應拆成兩個產品。

> 年繳已支援「每月發點」：買年繳先拿當月 500 點，之後每月重置，不會一次發 12 個月。

## 2. 設定環境變數

### 本機（`.dev.vars`）

本機 API（`npm run dev`，127.0.0.1:8787）會讀 `.env` 再讀 `.dev.vars`。把以下加進
`.dev.vars`（這個檔案不要提交）：

```dotenv
AUTH_REQUIRED=true
APP_URL=http://127.0.0.1:5173

SUPABASE_SERVICE_KEY=sb_secret_...        # 或沿用 SUPABASE_SECRET_KEY
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...           # 見步驟 3

STRIPE_PRICE_LIGHT_MONTH=price_...
STRIPE_PRICE_LIGHT_YEAR=price_...
STRIPE_PRICE_STANDARD_MONTH=price_...
STRIPE_PRICE_STANDARD_YEAR=price_...
STRIPE_PRICE_PRO_MONTH=price_...
STRIPE_PRICE_PRO_YEAR=price_...
```

- `AUTH_REQUIRED=true` 很重要：本機工具預設會把驗證關掉，沒有登入就沒有
  `auth.userId`，`/api/billing/checkout` 會回 400。
- `APP_URL` 是 Checkout 成功／取消後的導回位址；不設時用請求的 origin。
- 改完 `.dev.vars` 要**重啟** `npm run dev`，Worker 不會熱重載環境變數。
- 絕對不要把 `sk_...`、`whsec_...` 放進任何 `VITE_*` 變數；`VITE_*` 會打包給瀏覽器。

### Cloudflare Workers（正式）

Secret（會加密、不進 git）：

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_LIGHT_MONTH
npx wrangler secret put STRIPE_PRICE_LIGHT_YEAR
npx wrangler secret put STRIPE_PRICE_STANDARD_MONTH
npx wrangler secret put STRIPE_PRICE_STANDARD_YEAR
npx wrangler secret put STRIPE_PRICE_PRO_MONTH
npx wrangler secret put STRIPE_PRICE_PRO_YEAR
npx wrangler secret put SUPABASE_SERVICE_KEY
```

- `APP_URL` 不是機密，可放在 `wrangler.jsonc` 的 `vars`：

```jsonc
"APP_URL": "https://你的網域"
```

- `secret put` 會立即更新已部署的 Worker；改 `wrangler.jsonc` 的 `vars` 則要重新
  `npx wrangler deploy`。
- 本機用測試 key；正式環境才用 `sk_live_...` 與 live 價格 ID。

### 確認設定讀到了

```bash
npm run stripe:check
```

它會用同一組 `.env`／`.dev.vars` 讀 `STRIPE_SECRET_KEY`，逐一檢查六個 price ID
是否存在、金額是否 USD、是否為對應的 monthly／yearly recurring 價格，並標示目前是
TEST 或 LIVE。全部正確才會 exit 0：

```text
[stripe] key mode: TEST
[stripe] light    month price_...                ok  (MengYin Light)
...
[stripe] all six prices match test mode.
```

部署後也可以看 Worker 的設定：

```bash
curl -s https://你的網域/api/billing/config | jq '{configured, stripeReady, enforced}'
# { "configured": true, "stripeReady": true, "enforced": true }
```

`stripeReady` 為 false 代表 secret key、webhook secret 或至少一個價格沒讀到。

## 3. 建立 Webhook

Dashboard → **Developers → Webhooks → Add an endpoint**：

- Endpoint URL：`https://你的網域/api/billing/webhook`
- Preview Worker 要用它自己的完整 URL，例如
  `https://mengyinstudy-preview.libingzham1.workers.dev/api/billing/webhook`；只填 origin
  會收到 404，Checkout 成功但 plan 不會更新。該 endpoint 的 `whsec_...` 也要設進 preview
  Worker 的 `STRIPE_WEBHOOK_SECRET`，不能沿用本機自簽的值。
- 訂閱這些事件（七個都要）：

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
charge.refund.updated
```

  `charge.refund.updated` 會把非同步退款由 `pending` 變成 `succeeded` 或 `failed` 的結果寫回
  `billing_refunds`；缺少這個事件，Account 頁只會停留在 API 當下看到的狀態。

- 建立後複製 **Signing secret**（`whsec_...`），設成 `STRIPE_WEBHOOK_SECRET`。
- 程式已處理 Stripe 2025-03-31 之後把 `current_period_end` 移到 subscription item
  的格式，也相容舊格式；不需要在 Dashboard 指定 API 版本。
- Webhook 必須用**原始 body** 驗簽；Worker 已經這樣做，不要在中間加會改寫 body 的
  proxy 或 WAF rule。

### 本機 webhook（不用公開網域）

安裝 [Stripe CLI](https://docs.stripe.com/stripe-cli)，登入後：

```bash
stripe login
stripe listen --forward-to http://127.0.0.1:8787/api/billing/webhook
```

CLI 會印出一個**本機專用**的 `whsec_...`，把它貼進 `.dev.vars` 的
`STRIPE_WEBHOOK_SECRET` 並重啟 API。這個值跟 Dashboard 正式 endpoint 的不同。

沒有 CLI 也可以：完成測試 Checkout 後跑

```bash
npm run stripe:replay-test -- --email 你的測試帳號@example.com
```

它會向 Stripe 讀取該客戶的 test 訂閱，用 `.dev.vars` 的 local webhook secret 簽一個
`customer.subscription.updated` 事件送到 `127.0.0.1:8787`，重新整理 Account 頁就會
看到方案與點數。

## 4. 設定 Customer Portal

### 打開 Portal 設定頁

Dashboard → **Settings → Billing → Customer portal**，或直接開：

- 測試模式：<https://dashboard.stripe.com/test/settings/billing/portal>
- 正式模式：<https://dashboard.stripe.com/settings/billing/portal>

第一次打開先按一次 **Save**，建立預設 configuration；沒有預設 configuration 時，
程式建立 portal session 會失敗。用 `stripe:seed-test` 建產品時也會同時建立預設
configuration，可跳過這一步。

開啟：

- **Customers can update their payment method**
- **Customers can cancel subscriptions**
- **Customers can switch plans**，並把三個產品與六個價格加進可選清單
- Return URL 設 `https://你的網域/#/pricing`（程式建立 session 時也會帶 `return_url`）
- **Proration** 選 **按比例收費**（API `create_prorations`），不要用 `none`：升級要
  即時生效並按比例收差額，否則本期等於免費升級。
- **降級排在 period end**：把 `decreasing_item_amount`、`shortening_interval` 設為
  `schedule_at_period_end` 的條件，讓降級到期才生效，避免保留高一級的點數。
  `npm run stripe:seed-test -- --write` 會自動套用這兩項。

> 為什麼要開方案切換：已有有效訂閱的人按下別的方案時，程式會導到 Portal，
> 而不是再開一個 Checkout（避免舊訂閱繼續扣款）。Portal 沒開切換的話，使用者
> 只能取消或改卡，不能直接升級。
>
> 方案和點數是讀 Supabase，不是即時讀 Stripe。Portal 改完方案後，本機要跑
> `npm run stripe:replay-test -- --subscription sub_...` 套用 webhook，再重新整理
> 頁面；沒有 webhook 時，頁面不會自己變。

### 三種「打開 Portal」的方式

1. **從你的網站**：登入 → Account 頁或方案頁的 **Manage billing／管理帳單** →
   後端 `POST /api/billing/portal` 建立 session → 導到 Stripe。前提是該帳號
   `billing_accounts.stripe_customer_id` 已經有值（完成過一次 Checkout）。
2. **用 Stripe CLI（測試最快）**：

   ```bash
   stripe billing_portal sessions create --customer=cus_xxx
   ```

   終端機會印出 `url`，打開就是該客戶的 Portal。
3. **用 API**：

   ```bash
   curl -s https://api.stripe.com/v1/billing_portal/sessions \
     -u "sk_test_你的key:" \
     -d customer=cus_xxx \
     -d "return_url=https://你的網域/#/pricing" | jq -r .url
   ```

   Portal URL 是**單次、短期有效**的，不能固定寫在網站上；每次都要建立新 session。

找不到 `cus_...`：Stripe Dashboard → **Customers** 搜尋測試帳號的 email；或查
Supabase：

```sql
select user_id, stripe_customer_id, stripe_subscription_id
from public.billing_accounts
where stripe_customer_id is not null;
```

> 如果 `POST /api/billing/portal` 回 503「This account has no Stripe customer yet」，
> 表示這個帳號還沒完成一次 Checkout，先買一次測試訂閱再試。
>
> 另外 Stripe 有一個「no-code portal」公開連結（客戶輸入 email 收一次性登入信）。
> 你的網站已經用 API 建 session，通常不需要；要開的話在 Portal 設定頁啟用
> customer login 即可。

## 5. 本機測試（測試卡）

> 先跑 `npm run stripe:check` 確認 `key mode: TEST`。若顯示 **LIVE**，不要在本機用測試卡
> 結帳：那會建立真的訂閱與扣款。請改用 Stripe sandbox 的 `sk_test_`／`rk_test_` 與
> test mode 的價格；正式 live key 只放 Cloudflare Worker secrets。

1. `.dev.vars` 設好 `AUTH_REQUIRED=true`、測試 key、六個價格、本機 webhook secret。
2. `stripe listen --forward-to http://127.0.0.1:8787/api/billing/webhook`
3. 另一個終端：`npm run dev`
4. 開 <http://127.0.0.1:5173>，登入，進 **方案** 頁，選 Light 月繳。
5. 結帳與 Portal 會另開 Stripe 分頁；原分頁會問「支付成功／失敗」。失敗會恢復方案按鈕；選錯結果也會在下次回到分頁或重新整理時同步。若瀏覽器阻擋彈窗，允許此網站彈出視窗後重試。
6. 測試卡：

| 卡號 | 結果 |
| --- | --- |
| `4242 4242 4242 4242` | 成功 |
| `4000 0025 0000 3155` | 需要 3D Secure 驗證 |
| `4000 0000 0000 9995` | 餘額不足（失敗） |

到期日填未來日期，CVC 任意三碼，郵遞區號任意。

7. 成功後應導回 `/#/pricing?checkout=success`，顯示方案與點數。
8. 到 Supabase SQL Editor 驗證：

```sql
select plan, subscription_status, points, monthly_points, bonus_points,
       points_reset_at, period_end, cancel_at_period_end
from public.billing_accounts
where user_id = '<你的 user id>';

select id, type, processed_at, error
from public.stripe_events
order by id desc
limit 10;
```

預期：`plan='light'`、`points=500`、`monthly_points=500`、`points_reset_at` 約一個月後、
`period_end` 約一個月後、`stripe_events` 有 `checkout.session.completed` 與
`customer.subscription.created`。

### 模擬「過了一個月」的重置

不用真的等一個月，把重置日往回撥，再重新整理帳戶頁（會呼叫 `/api/billing/me`）：

```sql
update public.billing_accounts
set points_reset_at = now() - interval '1 day'
where user_id = '<你的 user id>';
```

重新整理後應變成 500 點（若原本已花掉一些），`points_reset_at` 移到下個月。
年繳也一樣：買年繳當下是 500 點，撥回重置日後再拿 500，不會一次 6000 點。

### 模擬到期

> 以下 SQL 與手動 RPC 只在測試帳號執行，會改寫該帳號的方案與點數。

```sql
update public.billing_accounts
set period_end = now() - interval '1 hour'
where user_id = '<你的 user id>';
```

重新整理後方案回落 free；若重置日也到了，方案點數會清零、`points_reset_at` 變 null。
這時模擬「延遲送達的續訂」：在 SQL Editor 直接呼叫 webhook 用的同一個 RPC，帶一個新的
period key（Supabase SQL Editor 以 postgres 執行，符合 service-role 檢查）：

```sql
select public.billing_set_subscription(
  '<你的 user id>',
  'light',
  'active',
  now() + interval '1 month',
  1000,
  500,
  'manual-renew-' || extract(epoch from now())::bigint,
  null,
  'sub_manual_test',
  false
);
```

回到帳戶頁重新整理，應該補發 500 點、`points_reset_at` 移到一個月後。這正是延遲的
`invoice.paid` 會走的路徑；不能用 `stripe events resend` 測，因為同一個 event id 會被
`stripe_events` 去重，而且舊事件的 period key 已經用過。

### 測取消

Portal → 取消訂閱 → webhook `customer.subscription.updated` 會把
`cancel_at_period_end` 設 true；到期後 `customer.subscription.deleted` 讓方案回落 free。

### 5.5 Alipay／WeChat Pay 與港幣（HKD）

**為什麼 Checkout 沒看到 Alipay／WeChat Pay？**

- 本專案只開 **subscription mode**（`mode: 'subscription'`）。Alipay 與 WeChat Pay 都是
  **single-use（單次付款）**錢包：Alipay 的 recurring 是邀請制 private preview；
  WeChat Pay 的 recurring 是 private preview 且只支援 off-session。Stripe 的 Checkout
  在 subscription mode **不支援**這兩個錢包，所以不會出現，這不是設定漏了。
- Checkout 沒有手動指定 `payment_method_types`，用的是 dynamic payment methods；
  Stripe 會依「訂閱模式＋幣別＋帳號資格」自動過濾。

**為什麼沒有港幣？**

- 你的 Price 是 **USD**。Stripe 的 HKD presentment 需要：
  1. 帳號是香港商業實體，且有 **HKD 結算銀行帳戶**（Dashboard → Settings → Bank accounts
     加 HKD）；或
  2. 建立 **HKD 價格**並在程式使用該 price ID；或
  3. 用 **Adaptive Pricing**（程式已在每個 Checkout Session 啟用），讓 Stripe 把 USD
   價格即時轉成 HKD 顯示與收取。
- 但 Adaptive Pricing 對 **cross-border subscriptions 只支援 card、Link、Apple Pay、
  Google Pay**；Alipay／WeChat Pay 仍然不會出現在訂閱 Checkout。

**要收 Alipay／WeChat Pay，實務上的做法**

最乾淨的是賣 **單次加購點數包**（`mode: 'payment'`、HKD 價格）：

- 三個錢包（Alipay、WeChat Pay、card）在單次付款都可用（需在
  Settings → Payment methods 開啟，並符合帳號國家／類別／網站審核）。
- 點數進 `bonus_points` bucket，不隨每月重置歸零；資料庫與扣點順序已支援。
- 目前**還沒有**加購入口：`checkout` 只建訂閱、webhook 的
  `checkout.session.completed` 只處理 `object.subscription`。要做這個功能需要另開
  一次性的 Checkout Session，並在 webhook 用 session metadata 入帳 bonus points。

其他選項：

- **HKD 訂閱**：建立 HKD 月繳／年繳價格，改成用 HKD price ID；卡片可用 HKD，
  但 Alipay／WeChat 依然不支援訂閱。
- **Adaptive Pricing**：訂閱仍以 USD 計價，客戶用卡片看到 HKD 在地價格；
  客戶負擔 2–4% 換匯費，Alipay／WeChat 仍不適用。
- 用 **Stripe Invoicing** 開單收 Alipay 單次付款（手動續訂，不建議當主力）。

### 5.6 幣別：Checkout 用 Adaptive Pricing，方案頁維持 USD

目前的做法是 **per-session Adaptive Pricing**，不是為每個幣別建固定價格：

- `createCheckoutSession` 帶 `adaptive_pricing[enabled]=true`；Stripe 依客戶所在地把
  USD 價格轉成當地貨幣（150+ 個市場），你以 USD 結算。
- 客戶負擔 2–4% 換匯費。
- 跨國訂閱只支援 card、Link、Apple Pay、Google Pay；Alipay／WeChat 仍不能用於訂閱。
- **方案頁（截圖那一頁）維持 USD。** Stripe 沒有公開「先取得 Adaptive Pricing 報價」
  的 API，所以頁面不可能顯示各國精確金額；只有進 Checkout 才看得到當地貨幣。
- 不需要 `currency_options`，也不需要 `GET /api/billing/prices`；先前「HK IP 顯示 HK$」
  的分支已移除。

> 若之後真的要方案頁顯示精確 HK$，那是另一條路：建立新的 price 加 HKD currency
> option（已用過的 price 不能加），頁面顯示固定 HK$，該幣別就不會跟隨美元浮動。
> 「頁面精確顯示」與「跟隨美元」只能二選一。

> **已 archive 的 price 不會被 Adaptive Pricing 救回來。** 如果某個 price
> `active=false`，Checkout 會直接拒絕；先 unarchive，或用 **+ Add another price**
> 建一個新的。

### 5.7 退款預覽測試

先確認 `.dev.vars` 是 **test mode** key，並啟動本機 API：

```bash
npm run dev:api
```

另一個終端機執行：

```bash
npm run stripe:refund-check          # 月繳：用 500 點、已用 100 點，退 US$3.99
npm run stripe:refund-check -- --year # 年繳：退 US$49.06（11.8/12）

# 已部署的 preview Worker（測試模式）
REFUND_API_BASE=https://mengyinstudy-preview.libingzham1.workers.dev npm run stripe:refund-check
```

腳本會建立一個 Stripe test 訂閱與一個即棄 Supabase 使用者、扣 100 點、呼叫真正的
`GET/POST /api/billing/refund`，再確認 Stripe refund 成功、訂閱已取消、帳戶回落 Free，
並模擬延遲 webhook 確認不會重新發點。最後會刪除 test 使用者與 Stripe customer。
它會拒絕 live key；不要用正式卡或 live secret 執行。

手動流程：登入本機預覽 → 方案頁買 Light（測試卡 `4242 4242 4242 4242`）→
帳戶頁按「申請退款」→ 看到「400 / 500 點、可退 US$3.99」→ 確認 → Stripe Dashboard
的 Refunds 應見到 `re_...`，Subscriptions 應見 `canceled`，Account 應回到 Free。

## 6. 正式上線

1. **啟用 Stripe 帳號**：Dashboard 依指示填公司／個人資料、銀行帳戶、稅務資訊。
2. 關閉 Test mode，切到 **Live mode**，**重新建立**三個產品與六個價格。
   測試模式的 `price_...` 不能在正式模式使用。
3. 建立 live webhook endpoint（同樣七個事件，包括 `charge.refund.updated`），複製 live 的 `whsec_...`。
4. 更新 Cloudflare secrets：

```bash
npx wrangler secret put STRIPE_SECRET_KEY        # sk_live_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # live whsec_...
npx wrangler secret put STRIPE_PRICE_LIGHT_MONTH # live price_...
# ...其餘五個價格
```

5. 設定 `APP_URL=https://你的網域`，重新部署：

```bash
npm run build
npx wrangler deploy
```

6. 上線後用真卡做一次小額測試（或建立 100% 折扣碼走完整流程），確認：
   - 付款成功導回方案頁
   - `/api/billing/me` 顯示正確方案與點數
   - Stripe → Webhooks 的 delivery 是 2xx
   - 退款／取消流程符合你的退款政策

## 7. 常見錯誤

| 症狀 | 原因 | 修法 |
| --- | --- | --- |
| 方案頁顯示「訂閱尚未開放購買」 | `stripeReady=false` | 檢查 secret key、webhook secret、至少一個價格；看 `/api/billing/config` |
| 按下方案回 503「No Stripe price is configured for pro (year)」 | 該價格變數沒設 | 補 `STRIPE_PRICE_PRO_YEAR`，重啟／重新 deploy |
| `stripe:check` 顯示「No such price」 | 把 `prod_...`（Product ID）放進 `STRIPE_PRICE_*` | 改放 `price_...`；用產品頁或 `/v1/prices?product=prod_...` 查 |
| Portal 回「No configuration provided」 | Portal 沒有預設 configuration | 開 Portal 設定頁按一次 Save |
| `/api/billing/portal` 回 503「no Stripe customer yet」 | 帳號還沒完成過 Checkout | 先買一次測試訂閱，讓 `stripe_customer_id` 寫入 |
| Webhook 回 400「signature does not match」 | `whsec_` 用錯（本機 vs Dashboard）、或 body 被改寫 | 用正確環境的 signing secret；確認沒有 proxy 改 body |
| Webhook 回 400「signature has expired」 | 重放舊事件或伺服器時間偏差 | 確認系統時間；Stripe 容忍 5 分鐘 |
| 付款成功但方案沒更新 | webhook 沒到、URL 少了 `/api/billing/webhook`、`whsec_` 不對、事件沒訂閱、或 `SUPABASE_SERVICE_KEY` 缺失 | 看 Stripe Webhooks delivery；修正完整 URL 與 signing secret；補 service key；重送事件 |
| Webhook 回 503「SUPABASE_SERVICE_KEY is required」 | 缺 service key | `wrangler secret put SUPABASE_SERVICE_KEY` |
| 已有訂閱的人按別的方案被導到 Portal | 正常行為（避免第二個訂閱） | 在 Portal 開啟方案切換 |
| 按方案回 400「already has a subscription but no billing customer」 | 資料不一致（有訂閱 id 但沒 customer id） | 用 Stripe Dashboard 或 SQL 修正該帳號 |
| 測試卡被拒 | 用到 live key 或測試卡號錯 | 確認 `sk_test_`；用 `4242 4242 4242 4242` |
| 年繳只拿到 500 點 | 正常：年繳是每月發點，不是一次 6000 | 用上面的 `points_reset_at` 測試法驗證每月重置 |

## 8. 安全與法務

- `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`SUPABASE_SERVICE_KEY` **只能**放在
  Worker secrets 或本機 `.dev.vars`；不要進 git、不要放 `VITE_*`。
- Webhook 一定要驗簽（程式已做），並用 `stripe_events` 去重，避免重送造成重複發點。
- 對外公告退款政策、服務條款與隱私政策；台灣營業稅／EU VAT／Stripe Tax 需另行確認。
- 定期在 Stripe Dashboard 檢查 failed payments 與 dispute；必要時用 webhook
  `invoice.payment_failed` 的通知流程（目前只更新訂閱狀態）。
- 若 key 外洩：立刻在 Stripe Dashboard roll key，再 `wrangler secret put` 更新。
- 若 **webhook signing secret** 曾貼到聊天、issue 或截圖，請在 Dashboard → Workbench →
  Webhooks → 該 endpoint → **Roll secret**，再更新 `.dev.vars`／Worker secret。
  拿到 secret 的人可以偽造訂閱事件，不能只當成一般設定值。

## 9. 程式對照

| 位置 | 作用 |
| --- | --- |
| `packages/core/src/billing.ts` | 方案、價格、每題點數、素材級距（金額的唯一來源） |
| `apps/api/src/billing/routes.ts` | `/api/billing/config\|me\|checkout\|portal\|cancel\|refund\|webhook` |
| `apps/api/src/billing/refund.ts` | 未使用點數比例、7 天窗口、月繳／年繳退款公式 |
| `apps/api/src/billing/stripe.ts` | Checkout／Portal／訂閱讀取、退款、webhook 驗簽 |
| `apps/api/src/billing/store.ts` | Supabase RPC 呼叫、退款記錄與 snapshot 正規化 |
| `supabase/migrations/20261109090000_monthly_point_reset.sql` | 每月重置、加購點數 bucket |
| `supabase/migrations/20261111090000_billing_refunds.sql` | 退款記錄、帳戶降級、延遲 webhook 防護 |
| `apps/web/src/pages/Pricing.tsx` | 方案頁、Checkout／Portal 入口 |
| `apps/web/src/pages/Account.tsx` | 方案、點數、下次重置日、退款報價與確認 |
| `apps/web/src/pages/Docs.tsx` | `#/docs` 獨立說明文件站（側欄、右側目錄、新分頁） |
| `apps/web/src/components/BillingReference.tsx` | 說明文件站內的方案、價目與素材費用表 |
| `tools/refund-preview-check.mjs` | 本機 test-mode 退款端到端檢查 |
| `docs/SUBSCRIPTION_POINTS.md` | 定價、規則與經濟計算 |

## 10. 最短檢查清單

- [ ] Stripe 測試模式建立 3 個產品 × 6 個 recurring 價格（USD）
- [ ] 本機 `.dev.vars`：`AUTH_REQUIRED=true`、`STRIPE_SECRET_KEY`、六個價格、
      `SUPABASE_SERVICE_KEY`
- [ ] `stripe listen` 取得本機 `whsec_`，設進 `.dev.vars`
- [ ] 測試卡 `4242` 完成一次 Light 月繳，Supabase 看到 500 點
- [ ] 用 `points_reset_at` 撥回測試每月重置
- [ ] `npm run stripe:refund-check` 通過（月繳 US$3.99、年繳 US$49.06）
- [ ] Portal 開啟取消、改卡、方案切換
- [ ] 正式模式：live 價格、live key、live webhook、`APP_URL`、`wrangler deploy`
- [ ] 真卡小額測試與退款流程
