/**
 * The Privacy Policy and the Terms of Service, in one place.
 *
 * Both documents are rendered by two front ends — the React page at
 * `#/privacy` and `#/terms`, and the standalone HTML that `vite.config.ts`
 * emits at `/privacy/` and `/terms/` for app-store review. Keeping the wording
 * here is what stops the two copies from drifting apart.
 *
 * Style rules for edits:
 * - Traditional Chinese first, English second, same meaning in both.
 * - Say what the app actually does. No invented processors, no invented
 *   retention periods, no promises the code does not keep.
 * - Contact details come from `config.ts`; never hard-code an address here.
 */

export interface Bi {
  zh: string;
  en: string;
}

export type Block =
  | { kind: 'p'; text: Bi }
  | { kind: 'ul'; items: Bi[] }
  | { kind: 'ol'; items: Bi[] }
  | { kind: 'note'; text: Bi }
  | { kind: 'table'; head: Bi[]; rows: Bi[][] }
  | { kind: 'links'; items: { label: Bi; href: string }[] }
  | { kind: 'contact' };

export interface Section {
  id: string;
  heading: Bi;
  blocks: Block[];
}

export interface LegalDoc {
  id: 'privacy' | 'terms';
  slug: string;
  title: Bi;
  summary: Bi;
  sections: Section[];
}

const p = (zh: string, en: string): Block => ({ kind: 'p', text: { zh, en } });
const note = (zh: string, en: string): Block => ({ kind: 'note', text: { zh, en } });
const ul = (...items: [string, string][]): Block => ({
  kind: 'ul',
  items: items.map(([zh, en]) => ({ zh, en })),
});
const ol = (...items: [string, string][]): Block => ({
  kind: 'ol',
  items: items.map(([zh, en]) => ({ zh, en })),
});
const table = (head: [string, string][], ...rows: [string, string][][]): Block => ({
  kind: 'table',
  head: head.map(([zh, en]) => ({ zh, en })),
  rows: rows.map((row) => row.map(([zh, en]) => ({ zh, en }))),
});
const contact = (): Block => ({ kind: 'contact' });
const links = (...items: [string, string, string][]): Block => ({
  kind: 'links',
  items: items.map(([zh, en, href]) => ({ label: { zh, en }, href })),
});

const s = (id: string, zh: string, en: string, blocks: Block[]): Section => ({
  id,
  heading: { zh, en },
  blocks,
});

export const privacyPolicy: LegalDoc = {
  id: 'privacy',
  slug: 'privacy',
  title: { zh: '隱私權政策', en: 'Privacy Policy' },
  summary: {
    zh: 'MengYin Study 是一款溫習與練習應用程式。我們把資料蒐集降到最低：不投放廣告、不使用行為追蹤工具、不出售個人資料。若你訂閱付費方案，付款由 Stripe 處理，我們只保留方案、付款狀態與識別碼。這份政策說明我們蒐集哪些資料、為什麼蒐集、存放在哪裡，以及你可以如何查閱、匯出與刪除。',
    en: 'MengYin Study is a revision and practice app. We keep data collection to a minimum: no advertising, no behavioural tracking, and no selling of personal data. If you subscribe to a paid plan, Stripe handles payment and we keep only the plan, payment status and identifiers. This policy explains what we collect, why, where it is stored, and how you can inspect, export or delete it.',
  },
  sections: [
    s(
      'scope',
      '適用範圍',
      'Scope',
      [
        p(
          '本政策適用於 MengYin Study 網站、桌面版應用程式，以及兩者提供的題庫、練習、測驗、AI 出題與雲端同步功能。AI 出題由第三方模型供應商（智譜 GLM、DeepSeek）與 Cloudflare Workers AI 協助提供；它們依我們的指示處理請求，同時適用其自身的政策。',
          'This policy covers the MengYin Study website, the desktop app, and the deck, practice, exam, AI-generation and cloud-sync features both provide. AI generation is powered by third-party model providers (Zhipu GLM, DeepSeek) and Cloudflare Workers AI, which process requests on our instructions and under their own policies.',
        ),
        p(
          '本政策不適用於 Google 或 GitHub 的登入頁面，以及其他外部網站。那些服務由各自的營運者負責，並適用它們自己的隱私權政策。',
          'It does not cover the Google or GitHub sign-in pages or any other external site. Those are run by their own operators under their own privacy policies.',
        ),
        p(
          '在本政策中，「我們」指 {{operator}}；「你」指使用本服務的人。',
          'In this policy, “we” means {{operator}} and “you” means the person using the service.',
        ),
      ],
    ),

    s(
      'collect',
      '我們蒐集的資料',
      'What we collect',
      [
        p(
          '下表是完整的清單。只有標示為「雲端」的資料會離開你的裝置。',
          'The table below is the complete list. Only the rows marked “cloud” ever leave your device.',
        ),
        table(
          [
            ['資料', 'Data'],
            ['內容', 'Contents'],
            ['存放位置', 'Stored in'],
          ],
          [
            ['帳號', 'Account'],
            ['電子郵件、顯示名稱、頭像網址、登入方式、註冊時間', 'Email address, display name, avatar URL, sign-in method, sign-up date'],
            ['雲端（Supabase）', 'Cloud (Supabase)'],
          ],
          [
            ['帳單與訂閱', 'Billing and subscriptions'],
            [
              '方案、訂閱狀態、續訂日期、Stripe 客戶與訂閱識別碼、付款狀態與發票紀錄。付款方式、卡號、帳單地址與稅務識別碼由 Stripe 的託管結帳頁直接收集；我們不儲存完整卡號。',
              'Plan, subscription status, renewal date, Stripe customer and subscription IDs, payment status and invoices. Payment method, card number, billing address and tax ID are collected by Stripe’s hosted checkout; we do not store full card numbers.',
            ],
            [
              'Stripe（付款與發票）與雲端（Supabase，僅方案、狀態與識別碼）',
              'Stripe (payments and invoices) and cloud (Supabase: plan, status and identifiers only)',
            ],
          ],
          [
            [
              'Google 登入',
              'Google Sign-In',
            ],
            [
              'Google 帳號識別碼、名稱、電子郵件、頭像網址（僅在你選擇 Google 登入時）',
              'Google account ID, name, email address and avatar URL (only when you choose Google Sign-In)',
            ],
            ['雲端（Supabase Auth）', 'Cloud (Supabase Auth)'],
          ],
          [
            ['自建題庫', 'Your decks'],
            ['標題、說明、標籤、題目與答案', 'Title, description, tags, questions and answers'],
            ['雲端（只有你的帳號可讀）與本機', 'Cloud (readable only by your account) and this device'],
          ],
          [
            ['學習進度', 'Progress'],
            ['作答紀錄、錯題、筆記、複習排程、測驗結果', 'Attempts, mistakes, notes, review schedule, exam results'],
            ['雲端（只有你的帳號可讀）與本機', 'Cloud (readable only by your account) and this device'],
          ],
          [
            ['AI 出題偏好與教材', 'AI generation preferences and materials'],
            [
              '供應商、文字模型、生圖模型、插圖偏好；教材檔案與解析後的文字',
              'Provider, text model, image model, illustration preference; material files and extracted text',
            ],
            [
              '偏好在 Generate 頁選擇並只留在你的裝置；教材文字只為該次生成傳送到 AI 服務，不儲存',
              'Preferences are chosen on Generate and stay on this device; material text is sent to the AI service for that request only and is not stored',
            ],
          ],
          [
            ['AI 生成請求', 'AI generation request'],
            ['主題、描述、教材片段、題型設定與生成結果', 'Topic, description, material excerpts, question settings and generated output'],
            [
              '傳輸到 Cloudflare 與模型供應商；我們不在伺服器保存',
              'Transmitted to Cloudflare and the model provider; not stored on our servers',
            ],
          ],
          [
            ['介面設定與離線快取', 'Preferences and offline cache'],
            ['語言、主題、字級、練習偏好、題庫快取', 'Language, theme, text size, practice preferences, cached decks'],
            ['只在你的裝置', 'This device only'],
          ],
          [
            ['技術紀錄', 'Technical logs'],
            ['IP 位址、瀏覽器類型、請求時間與路徑', 'IP address, browser type, request time and path'],
            ['Cloudflare 與 Supabase 的短期日誌', 'Short-lived logs at Cloudflare and Supabase'],
          ],
        ),
        ul(
          [
            '帳號資料只在你註冊或登入後才會產生。你可以完全不註冊，以訪客身分在本機練習。',
            'Account data exists only once you register or sign in. You can also practise entirely as a guest, on your own device.',
          ],
          [
            '密碼由 Supabase Auth 以不可逆雜湊儲存，我們看不到明文密碼，也無法還原。',
            'Passwords are stored by Supabase Auth as an irreversible hash. We never see the plain password and cannot recover it.',
          ],
          [
            '使用 Google 或 GitHub 登入時，該服務會向我們提供帳號識別碼、顯示名稱與頭像網址；我們不會取得你的密碼，也不會取得你在該服務的其他資料。',
            'When you sign in with Google or GitHub, that provider gives us an account identifier, a display name and an avatar URL. We do not receive your password or any other data from that account.',
          ],
          [
            '我們不會要求你的電話號碼、生日或身分證件。付費時，Stripe 的託管結帳頁會要求付款方式與帳單地址；這些資料由 Stripe 收集與保存，我們只收到付款結果、方案與訂閱識別碼，不會取得完整卡號。',
            'We never ask for your phone number, date of birth or identity documents. When you pay, Stripe’s hosted checkout asks for a payment method and billing address; Stripe collects and stores that data. We receive only the payment result, plan and subscription identifiers, never the full card number.',
          ],
        ),
      ],
    ),

    s(
      'google',
      'Google 登入與 Google API 資料',
      'Google Sign-In and Google API data',
      [
        p(
          'Google 登入是選用的。若你選擇以 Google 登入，我們只會向 Google 要求基本個人資料：你的 Google 帳號識別碼、電子郵件地址、顯示名稱與頭像網址（OAuth scope：openid、email、profile）。我們不會要求 Gmail、Google Drive、Google 日曆、聯絡人、相簿或其他 Google 服務的存取權。',
          'Google Sign-In is optional. If you choose it, we request only basic profile data from Google: your Google account ID, email address, display name and profile picture URL (OAuth scopes: openid, email, profile). We do not request access to Gmail, Google Drive, Google Calendar, Contacts, Photos or any other Google service.',
        ),
        p(
          '我們只會把這些資料用於建立與驗證你的帳號、顯示你的名稱與頭像，以及讓你登入。我們不會把 Google 使用者資料用於廣告、行為分析、個人輪廓、出售或出租，也不會用於訓練 AI 模型。除了提供本服務所需的基礎設施與付款供應商（Supabase、Cloudflare、Stripe），或法律要求的情況外，我們不會把 Google 使用者資料分享給其他第三方。',
          'We use this data only to create and authenticate your account, display your name and avatar, and sign you in. We do not use Google user data for advertising, behavioural analytics, profiling, sale or rental, and we do not use it to train AI models. We do not share Google user data with third parties except the infrastructure and payment providers needed to run the service (Supabase, Cloudflare and Stripe) or where the law requires it.',
        ),
        p(
          'MengYin Study 對 Google API 所取得資訊的使用與傳輸，遵守 Google API 服務使用者資料政策，包括其中的 Limited Use（有限使用）要求。Google 使用者資料不會被用於提供或改善其他應用程式、裝置或 AI 模型。',
          "MengYin Study's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Google user data is not used to provide or improve other apps, devices or AI models.",
        ),
        ul(
          [
            '你可以隨時在「帳號」頁面刪除帳號；與 Google 登入連結的帳號資料會一併刪除。你也可以來信要求刪除。',
            'You can delete your account at any time from the Account page; the account data linked to your Google sign-in is deleted with it. You can also write to us to request deletion.',
          ],
          [
            '如要撤銷 Google 存取權，請前往 Google 帳號的「安全性 → 第三方應用程式與服務」，移除 MengYin Study。撤銷後你將無法再以 Google 登入，但可改用電子郵件與密碼。',
            'To revoke Google access, open your Google Account’s Security → Third-party apps & services and remove MengYin Study. After revocation you can no longer sign in with Google, but you can use email and password.',
          ],
          [
            'Google 的隱私權政策與 Google API 服務使用者資料政策適用於 Google 對你資料的處理。',
            "Google's Privacy Policy and Google API Services User Data Policy apply to Google's handling of your data.",
          ],
        ),
        links(
          [
            'Google API 服務使用者資料政策',
            'Google API Services User Data Policy',
            'https://developers.google.com/terms/api-services-user-data-policy',
          ],
          ['Google 隱私權政策', 'Google Privacy Policy', 'https://policies.google.com/privacy'],
          ['Google API 服務條款', 'Google APIs Terms of Service', 'https://developers.google.com/terms'],
        ),
        note(
          'Google API 只用於登入，不用於 AI 出題。我們不會使用 Google API，也不允許任何人使用本應用程式或其 AI 功能，來建立、生成或散布 AI 生成的未經同意私密影像（AI NCII）、兒少性虐待內容、性化內容，或騷擾、貶抑他人的內容。',
          'Google APIs are used only for sign-in, never for AI generation. We do not use Google APIs, and we do not permit anyone to use the app or its AI feature, to create, generate or distribute AI-generated non-consensual intimate imagery (AI NCII), child sexual abuse material, sexualised content, or content that harasses or degrades another person.',
        ),
      ],
    ),

    s(
      'use',
      '我們如何使用資料',
      'How we use it',
      [
        ul(
          [
            '提供服務：登入、跨裝置同步、顯示進度、安排複習時間、計算統計。',
            'To provide the service: signing you in, syncing across devices, showing progress, scheduling reviews and computing statistics.',
          ],
          [
            '安全與防濫用：偵測異常登入、保護你的帳號與資料完整性。',
            'Security and abuse prevention: spotting unusual sign-ins and protecting your account and the integrity of your data.',
          ],
          [
            '支援：回覆你的問題，處理查閱、更正、匯出或刪除的請求。',
            'Support: answering your questions and handling access, correction, export or deletion requests.',
          ],
          [
            '我們目前不使用你的資料進行行為分析、廣告投放或建立個人輪廓。若未來導入任何分析工具，我們會先更新本政策並提供退出方式。',
            'We do not currently use your data for behavioural analytics, advertising or profiling. If we ever add analytics, we will update this policy first and provide a way to opt out.',
          ],
        ),
        p(
          '若你所在地的法律要求我們說明處理個人資料的法律依據（例如歐盟一般資料保護規則），我們的依據是：履行與你的契約（提供服務）、我們的正當利益（維護安全與改善服務），以及你的同意（在你明確給出同意的情況下）。',
          'Where the law requires us to name a legal basis (for example the EU General Data Protection Regulation), we rely on performance of our contract with you (providing the service), our legitimate interests (keeping the service safe and improving it), and your consent where you have explicitly given it.',
        ),
      ],
    ),

    s(
      'ai',
      'AI 出題與模型供應商',
      'AI generation and model providers',
      [
        p(
          'AI 出題由本服務提供，使用我們自己的供應商金鑰（智譜 GLM、DeepSeek）與 Cloudflare Workers AI 圖片生成；你不需要提供 API 金鑰，也不會在裝置上保存任何供應商金鑰。',
          'AI generation is provided by this service using our own provider keys (Zhipu GLM, DeepSeek) and Cloudflare Workers AI for images. You do not need an API key, and no provider key is stored on your device.',
        ),
        p(
          '按下生成時，應用程式會把你的主題、描述、選取的教材片段與題型設定送到我們的 Cloudflare API，再轉送給所選的模型供應商；插圖提示會送到 Cloudflare Workers AI。這些供應商可能位於其他國家，並依其政策處理內容，可能包括記錄請求或將內容用於模型訓練。我們不在伺服器保存提示詞、教材或生成結果。',
          'When you start a generation, the app sends your topic, description, selected material excerpts and question settings to our Cloudflare API, which forwards them to the selected model provider; illustration prompts go to Cloudflare Workers AI. Those providers may be in other countries and handle content under their own policies, which may include logging requests or using content to train models. We do not store prompts, materials or generated output on our servers.',
        ),
        ul(
          [
            '教材在你的裝置上解析；生成結束後，應用程式會自動刪除教材檔案與解析後的文字。',
            'Materials are parsed on your device, and the app deletes the files and the extracted text as soon as generation finishes.',
          ],
          [
            'AI 生成的結果會在生成介面標示為 AI 生成；儲存後的題庫仍可能包含 AI 內容，這些內容可能不準確，請依《服務條款》自行核對。',
            'AI-generated results are labelled in the generation interface. A saved deck may still contain AI-generated content, which may be inaccurate; verify it as described in the Terms of Service.',
          ],
          [
            '我們不會在你的帳號以外保存生成結果。生成題庫只有在你按下「儲存」且已登入時才會上傳到你的帳號，且只有你的帳號能讀取；插圖會存進你帳號專屬的私人 Storage 資料夾。題庫文字與圖片合共每個帳戶 30 MB。',
            'We do not keep generated output outside your account. A generated deck is uploaded only when you choose Save while signed in, and only your account can read it. Its illustrations go to a private Storage folder owned by your account. Deck text and images share a 30 MB limit per account.',
          ],
          [
            '為保護生成額度與服務穩定，我們可能套用每日題數、圖片數與速率上限。',
            'To protect the generation allowance and keep the service stable, daily question, image and rate limits may apply.',
          ],
          [
            '請不要把你不想外流的內容放進教材。你也要遵守所選 AI 服務供應商的條款。',
            'Do not put content you would not want disclosed into your materials. You must also follow the terms of the AI provider used for your request.',
          ],
        ),
        p(
          '本應用程式與 AI 出題功能僅供學術溫習之用。我們不會使用 Google API，也不會允許任何人使用本應用程式或 AI 出題功能，來建立、生成或散布 AI 生成的未經同意私密影像（AI NCII）、兒少性虐待內容、性化內容，或其他騷擾、貶抑他人的內容。這類內容一律禁止，違者帳號可能被停用。',
          'The app and its AI generation feature are for academic revision only. We do not use Google APIs, and we do not permit anyone to use the app or its AI generation feature, to create, generate or distribute AI-generated non-consensual intimate imagery (AI NCII), child sexual abuse material, sexualised content, or other content that harasses or degrades a person. Such content is prohibited and may result in account suspension.',
        ),
      ],
    ),

    s(
      'sharing',
      '資料分享',
      'Sharing',
      [
        p(
          '我們不出售、不出租，也不會為了行銷而交換你的個人資料。只有在下列情況才會分享：',
          'We do not sell, rent or trade your personal data for marketing. We share it only in these cases:',
        ),
        ul(
          [
            '服務供應商：Supabase（資料庫與身分驗證）、Cloudflare（靜態網站代管、AI API 與圖片生成）、Stripe（僅在你訂閱付費方案時；付款、訂閱、發票與稅務）、智譜 GLM 與 DeepSeek（僅在你使用 AI 出題時）、Google 與 GitHub（僅在你選擇該登入方式時）。它們只能為了提供這些服務而處理資料。',
            'Service providers: Supabase (database and authentication), Cloudflare (static hosting, AI API and image generation), Stripe (only when you subscribe to a paid plan; payments, subscriptions, invoices and tax), Zhipu GLM and DeepSeek (only when you use AI generation), and Google or GitHub (only when you choose that sign-in method). They may process data only to provide those services.',
          ],
          [
            '法律要求：依法令、法院命令或主管機關的合法要求，且僅限於必要的範圍。',
            'Legal requirements: where required by law, a court order or a competent authority, and only to the extent necessary.',
          ],
          [
            '保護權利：為防止詐欺、濫用或維護服務與使用者的安全所必要。',
            'Protecting rights: where necessary to prevent fraud or abuse, or to keep the service and its users safe.',
          ],
        ),
        p(
          '你的題庫與學習進度預設只有你自己能讀取。資料庫以資料列層級安全性（Row Level Security）隔離每個帳號，一般帳號無法讀取他人的資料，也無法把自己提升為管理員。官方題庫是公開內容，不含你的個人資料。',
          'Your decks and progress are private by default. The database isolates every account with row level security, so an ordinary account cannot read another learner’s data or promote itself to administrator. Official decks are public content and contain none of your personal data.',
        ),
        p(
          'Stripe 是獨立的付款處理商，依其隱私權政策與 PCI DSS 標準處理你的付款資料。我們的伺服器只保存 Stripe 客戶與訂閱識別碼、方案與付款狀態，不保存完整卡號或安全碼。',
          'Stripe is an independent payment processor and handles your payment data under its own privacy policy and the PCI DSS standards. Our servers keep only Stripe customer and subscription identifiers, the plan and payment status; they do not store full card numbers or security codes.',
        ),
      ],
    ),

    s(
      'location',
      '存放位置與跨境傳輸',
      'Where data lives and cross-border transfer',
      [
        ul(
          [
            '帳號與同步資料存放於 Supabase 的 PostgreSQL 資料庫，目前區域為亞太－首爾。',
            'Account and synced data live in a Supabase PostgreSQL database, currently in the Asia Pacific (Seoul) region.',
          ],
          [
            '靜態網站檔案由 Cloudflare 的全球節點提供。',
            'Static site files are served from Cloudflare’s global network.',
          ],
          [
            '你的同步資料可能被傳輸到你所在國家以外的地方。我們依服務供應商的標準資料保護條款處理這些傳輸。',
            'Your synced data may be transferred outside your country. We rely on our providers’ standard data protection terms for those transfers.',
          ],
          [
            'AI 生成請求會經過我們的 Cloudflare API，並轉送到所選的模型供應商（智譜 GLM 或 DeepSeek）；插圖提示會送到 Cloudflare Workers AI。這些請求可能在你所在國家以外處理。',
            'AI generation requests pass through our Cloudflare API and are forwarded to the selected model provider (Zhipu GLM or DeepSeek); illustration prompts go to Cloudflare Workers AI. Those requests may be processed outside your country.',
          ],
          [
            '付款與訂閱資料由 Stripe 在其營運的國家處理，可能包括美國、愛爾蘭或其他地區；實際地點取決於你所在的國家與 Stripe 的服務安排。',
            'Payment and subscription data are processed by Stripe in the countries where it operates, which may include the United States, Ireland or other regions, depending on your country and Stripe’s arrangements.',
          ],
        ),
      ],
    ),

    s(
      'retention',
      '保留期間',
      'Retention',
      [
        ul(
          [
            '帳號資料與同步內容：保留到你刪除帳號或要求刪除為止。',
            'Account data and synced content: kept until you delete your account or ask us to.',
          ],
          [
            '帳單與交易紀錄：由 Stripe 依稅務、會計、防詐騙與爭議處理所需期間保存。即使你刪除帳號，我們與 Stripe 仍可能保留發票、付款狀態與交易紀錄；Supabase 內的方案、Stripe 識別碼與點數紀錄會隨帳號刪除。',
            'Billing and transaction records: retained by Stripe for the periods needed for tax, accounting, fraud prevention and dispute handling. Even after you delete your account, we and Stripe may retain invoices, payment status and transaction records; the plan, Stripe identifiers and point ledger in Supabase are deleted with the account.',
          ],
          [
            '本機資料：保留在你的裝置上，直到你在瀏覽器或應用程式中清除資料。',
            'On-device data: kept on your device until you clear it in the browser or the app.',
          ],
          [
            'AI 生成請求：我們不在伺服器保存提示詞、教材或生成結果。模型供應商可能依其短期日誌政策保留請求，詳見其隱私權政策。',
            'AI generation requests: we do not store prompts, materials or generated output on our servers. Model providers may retain requests under their short-lived logging policies; see their privacy policies.',
          ],
          [
            '技術日誌：依 Cloudflare 與 Supabase 預設的短期保留期間保存，之後自動汰除。',
            'Technical logs: kept for our providers’ short default retention periods and then discarded.',
          ],
          [
            '刪除之後：我們會移除或去識別化相關資料；既有備份會在下一個備份輪替週期被覆蓋。',
            'After deletion: we remove or de-identify the data, and existing backups are overwritten in the next backup rotation.',
          ],
        ),
      ],
    ),

    s(
      'rights',
      '你的權利',
      'Your rights',
      [
        p(
          '依個人資料保護法，以及在你所在地適用時的其他法律（例如歐盟一般資料保護規則），你可以行使下列權利：',
          'Under Taiwan’s Personal Data Protection Act, and under other laws where they apply to you (such as the EU General Data Protection Regulation), you may:',
        ),
        ol(
          [
            '查閱與取得副本：在應用程式的「設定 → 資料」選擇「匯出備份」，即可下載包含題庫、作答紀錄與筆記的 JSON 檔。',
            'Access and obtain a copy: choose Export backup in Settings → Data to download a JSON file containing your decks, attempts and notes.',
          ],
          [
            '更正：在「帳號」頁面修改顯示名稱；其他資料可來信要求更正。',
            'Correct: change your display name on the Account page, or ask us to correct anything else.',
          ],
          [
            '刪除：在應用程式的「帳號」頁面選擇「刪除帳號」。帳號、雲端題庫、學習進度與筆記會立即永久刪除，無法復原；若你已無法登入，也可以來信由我們代為刪除。若你有付費訂閱，刪除帳號時我們會先停止其自動續訂；刪除帳號本身不會退款，請在刪除前先依退款條款申請。發票與交易紀錄可能依法律保留（見「保留期間」）。',
            'Delete: choose Delete account on the Account page. The account, cloud decks, progress and notes are erased immediately and permanently. If you can no longer sign in, write to us and we will delete the account for you. If you have a paid subscription, deleting the account first stops it renewing; deleting the account does not itself issue a refund, so request one under the refunds section before deleting. Invoices and transaction records may be retained as required by law (see Retention).',
          ],
          [
            '限制或反對處理、撤回同意：來信告知即可，不會影響你在此之前的權益。',
            'Restrict or object to processing, or withdraw consent: just write to us; this does not affect what happened before.',
          ],
          [
            '申訴：向台灣的個人資料保護主管機關，或你所在地的資料保護機關提出。',
            'Complain: to Taiwan’s personal data authority, or to the data protection authority where you live.',
          ],
        ),
        note(
          '我們不會因為你行使上述權利而拒絕提供服務或對你差別待遇。訪客資料只存在你的裝置，刪除瀏覽器資料即可清除。',
          'We will not refuse service or treat you differently for exercising these rights. Guest data exists only on your device, so clearing your browser data removes it.',
        ),
      ],
    ),

    s(
      'children',
      '兒童與青少年',
      'Children and teenagers',
      [
        p(
          '本服務不是為 13 歲以下兒童設計的，我們不會刻意蒐集 13 歲以下兒童的個人資料。若你未滿 18 歲，請在法定代理人同意下使用。若我們發現蒐集了兒童的資料，會盡快刪除。',
          'The service is not designed for children under 13, and we do not knowingly collect personal data from them. If you are under 18, please use it with the consent of a parent or guardian. If we learn that we have collected a child’s data, we will delete it promptly.',
        ),
      ],
    ),

    s(
      'cookies',
      'Cookie 與本機儲存',
      'Cookies and local storage',
      [
        ul(
          [
            '我們不使用廣告或追蹤 Cookie，也沒有第三方分析或社群追蹤程式。',
            'We use no advertising or tracking cookies, and no third-party analytics or social trackers.',
          ],
          [
            '應用程式使用瀏覽器本機儲存（localStorage、sessionStorage 與 IndexedDB）保存登入工作階段、介面設定、離線題庫、AI 設定與生成草稿。生成草稿只存在目前分頁，關閉分頁或瀏覽器後清除。這些是提供服務所必要的。',
            'The app uses browser storage (localStorage, sessionStorage and IndexedDB) for your session, preferences, offline decks, AI settings and generated drafts. A draft lives only in the current tab and is cleared when the tab or browser closes. These are necessary to provide the service.',
          ],
          [
            '登入後，題庫插圖會存進你帳號專屬的私人 Supabase Storage 資料夾；題庫文字與圖片合共上限 30 MB，題庫資料本身只保存圖片路徑。刪除題庫或帳戶時，相關圖片會一併移除。',
            'When you are signed in, deck illustrations are stored in a private Supabase Storage folder owned by your account; deck text and images share a 30 MB limit, and the deck row keeps only an image path. Deleting the deck or account removes the images.',
          ],
          [
            '你可以隨時清除瀏覽器資料；之後需要重新登入，離線題庫也會重新下載。',
            'You can clear your browser data at any time. You will then need to sign in again and offline decks will re-download.',
          ],
          [
            '當你前往 Stripe 的託管結帳頁或客戶入口網站時，Stripe 可能在其網域設定 Cookie 或使用本機儲存，以完成付款、記住工作階段與防止詐騙；那些 Cookie 適用 Stripe 的隱私權政策。',
            'When you open Stripe’s hosted checkout or customer portal, Stripe may set cookies or use local storage on its own domain to take payment, keep the session and prevent fraud; those cookies are governed by Stripe’s privacy policy.',
          ],
          [
            '桌面版應用程式使用自己的本機儲存空間，移除應用程式時可一併刪除。',
            'The desktop app keeps its own local storage, which you can remove together with the app.',
          ],
        ),
      ],
    ),

    s(
      'security',
      '安全',
      'Security',
      [
        ul(
          [
            '所有與我們伺服器之間的傳輸都使用 TLS 加密。',
            'All traffic to our servers uses TLS encryption.',
          ],
          [
            '資料庫以資料列層級安全性限制存取，只有你的帳號能讀寫自己的資料。',
            'The database restricts access with row level security: only your account can read and write its own data.',
          ],
          [
            '密碼由 Supabase Auth 以雜湊儲存；我們的工作人員不會看到你的密碼。',
            'Passwords are stored as hashes by Supabase Auth; our staff never see them.',
          ],
          [
            '付款卡資料由 Stripe 依 PCI DSS 標準處理；我們的伺服器不儲存完整卡號或安全碼。',
            'Payment card data is handled by Stripe under the PCI DSS standards; our servers do not store full card numbers or security codes.',
          ],
          [
            '沒有任何系統能保證百分之百安全。若發生影響你權益的資料外洩，我們會依法律要求通知你，並說明影響範圍與因應方式。',
            'No system can be guaranteed completely secure. If a breach affects your rights, we will notify you as the law requires and explain what was affected and what we are doing about it.',
          ],
        ),
      ],
    ),

    s(
      'changes',
      '政策變更',
      'Changes to this policy',
      [
        p(
          '我們可能更新本政策，例如新增功能或調整服務供應商時。重大變更會在應用程式內公告，並更新本頁的版本與生效日期。繼續使用服務即表示你接受更新後的政策。',
          'We may update this policy, for example when we add a feature or change a provider. Material changes will be announced in the app and the version and effective date on this page will be updated. Continuing to use the service means you accept the updated policy.',
        ),
      ],
    ),

    s('contact', '聯絡我們', 'Contact us', [contact()]),
  ],
};

export const termsOfService: LegalDoc = {
  id: 'terms',
  slug: 'terms',
  title: { zh: '服務條款', en: 'Terms of Service' },
  summary: {
    zh: '這份條款是你與 {{operator}} 之間關於使用 MengYin Study 的協議。請在使用前閱讀。部分功能需要付費訂閱；付費方案會自動續訂，本條款說明了計費、每月點數、取消與退款方式。註冊帳號或使用服務，即表示你同意本條款與隱私權政策。',
    en: 'These terms are the agreement between you and {{operator}} for using MengYin Study. Please read them before you start. Some features need a paid subscription; paid plans renew automatically, and these terms explain billing, monthly points, cancellation and refunds. By creating an account or using the service, you agree to these terms and to the Privacy Policy.',
  },
  sections: [
    s(
      'acceptance',
      '接受條款',
      'Acceptance',
      [
        p(
          '使用 MengYin Study（以下稱「本服務」）即表示你同意本條款。若你不同意，請停止使用本服務。',
          'By using MengYin Study (the “service”) you agree to these terms. If you do not agree, please stop using it.',
        ),
        p(
          '若你未滿 18 歲，請在法定代理人同意下使用本服務。若你代表一個組織使用本服務，你聲明你有權代表該組織接受本條款。',
          'If you are under 18, please use the service with the consent of a parent or guardian. If you use it on behalf of an organisation, you confirm that you are authorised to accept these terms for that organisation.',
        ),
      ],
    ),

    s(
      'service',
      '服務內容',
      'The service',
      [
        p(
          '本服務提供題庫瀏覽、練習與測驗、錯題複習、學習統計、AI 出題與跨裝置同步。功能會隨版本調整。',
          'The service offers deck browsing, practice and exams, mistake review, study statistics, AI question generation and cross-device sync. Features change between versions.',
        ),
        ul(
          [
            '本服務提供免費方案與付費方案。免費方案每月有 200 題 GLM-4.7 的生成額度；付費方案按月或按年訂閱，包含每月點數、較高階模型與 AI 生圖額度。實際方案、價格與包含內容以方案頁與 Stripe 結帳頁為準。',
            'The service offers a free plan and paid plans. The free plan includes 200 GLM-4.7 questions per calendar month; paid plans are billed monthly or yearly and include a monthly points allowance, stronger models and AI image quotas. The plans page and the Stripe checkout page show the current plans, prices and inclusions.',
          ],
          [
            'AI 出題使用本服務的供應商額度；你不需要自備 API 金鑰。為維持服務穩定與公平使用，我們可能設定每日或每月的題數、圖片數與速率上限，並可能隨成本調整；付費方案的用量以點數計算。',
            'AI generation uses the service’s provider allocation; you do not need your own API key. To keep the service stable and fair, daily or monthly question, image and rate limits may apply and may change with cost; paid plans meter usage in points.',
          ],
          [
            '你可以不註冊，以訪客身分在本機使用多數練習功能；同步與雲端題庫需要帳號。',
            'You can use most practice features as a guest without registering; sync and cloud decks require an account.',
          ],
        ),
      ],
    ),

    s(
      'billing',
      '方案、付款與續訂',
      'Plans, payments and renewal',
      [
        p(
          '付費方案透過 Stripe 的託管結帳頁訂購。方案頁以美元（USD）標示價格；Stripe 可能依你所在地顯示當地貨幣，並套用其匯率。你的發卡銀行可能另收跨境或貨幣轉換費，營業稅、VAT、GST 等稅費也可能在結帳時另加。實際扣款金額、幣別與稅額以 Stripe 結帳頁顯示者為準。',
          'Paid plans are purchased through Stripe’s hosted checkout. The plans page shows prices in US dollars (USD); Stripe may present your local currency using its exchange rate. Your card issuer may add cross-border or currency-conversion fees, and taxes such as sales tax, VAT or GST may be added at checkout. The amount, currency and tax shown on the Stripe checkout page are authoritative.',
        ),
        ul(
          [
            '付費訂閱會自動續訂，直到你在「管理帳單」取消。月繳方案每月續訂，年繳方案每年續訂；Stripe 會向你的付款方式收取當時的價格與稅費。',
            'Paid subscriptions renew automatically until you cancel in Manage billing. Monthly plans renew each month and yearly plans each year; Stripe charges your payment method the then-current price and taxes.',
          ],
          [
            '你可以在「管理帳單」隨時取消。取消在目前已付計費期間結束時生效；期限屆滿前你仍可使用付費功能，之後帳戶回落免費方案。除退款條款或法律另有規定外，已付期間的費用不會因取消而按比例退還。',
            'You can cancel at any time in Manage billing. Cancellation takes effect at the end of the current paid billing period; you keep paid features until then, after which the account returns to the free plan. Except as set out in the refunds section or required by law, fees for the current period are not refunded pro rata on cancellation.',
          ],
          [
            '付費方案的每月點數在訂閱週年日發放：輕量 500 點、標準 1,100 點、進階 2,500 點。這不是按日曆月計算，也不是一次發放全年；年繳方案同樣每月發放。未使用的方案點數在下次發放時失效，不會累積，也不會補發你沒有登入的月份。',
            'Paid plans grant their monthly points on the subscription anniversary: Light 500, Standard 1,100 and Pro 2,500. This is not a calendar-month allowance and is not paid out for the whole year at once; yearly plans also grant monthly. Unused plan points expire at the next grant, do not roll over, and missed months are not backfilled.',
          ],
          [
            '在同期間升級會即時生效，Stripe 可能按比例收取差額。我們只補發新方案與舊方案每月點數的差額，不會補回你已經花費的點數。降級在目前計費期間結束時生效；到期前你仍使用原方案，續訂時套用較低方案與其點數，未用完的方案點數不保留。',
            'An upgrade within the same period takes effect immediately and Stripe may charge a prorated difference. We add only the difference between the new and old monthly allowance; points you have already spent are not restored. A downgrade takes effect at the end of the current billing period: you keep the current plan until then, the lower plan and its allowance apply at renewal, and unused plan points do not carry over.',
          ],
          [
            '若扣款失敗，Stripe 可能重試。在付款成功前，我們可能暫停付費功能並將帳戶回落免費方案；更新付款方式並完成付款後可恢復。',
            'If a charge fails, Stripe may retry it. Until payment succeeds, we may suspend paid features and return the account to the free plan; access resumes after you update the payment method and payment completes.',
          ],
          [
            '我們可能調整價格。價格變更會在生效前至少 30 天於應用程式內公告或以電子郵件通知；法律另有規定者從其規定。變更生效後的續訂適用新價格；繼續訂閱即表示你接受新價格。',
            'We may change prices. We will announce a price change in the app or by email at least 30 days before it takes effect, or as otherwise required by law. The new price applies to renewals after it takes effect; continuing the subscription means you accept it.',
          ],
        ),
      ],
    ),

    s(
      'refunds',
      '退款',
      'Refunds',
      [
        p(
          '首次成功付款後 7 天內，你可以在「帳戶」頁面申請退款。退款以未使用的方案點數計算，不是一筆過全額退款；若你完全沒有使用方案點數，則退還該筆實付金額。每個訂閱只可退款一次。7 天後或不符合自動流程的情況，請來信聯絡，我們會依適用法律與實際使用情況審查。',
          'Within 7 days of the first successful payment you may request a refund from the Account page. The refund is based on the plan points you have not used, not automatically the full amount; if you used no plan points at all, the full amount paid is refunded. Each subscription can be refunded once. After 7 days, or where the automatic flow does not apply, write to us and we will review the case under applicable law and actual usage.',
        ),
        ul(
          [
            '月繳方案：退款 = 實付金額 × 未使用方案點數 ÷ 每月方案點數。例如每月 500 點、實付 US$4.99，已使用 100 點，退款為 US$4.99 × 400 ÷ 500 = US$3.99。',
            'Monthly plan: refund = amount paid × unused plan points ÷ monthly plan points. For example, with 500 points a month and US$4.99 paid, using 100 points leaves 400, so the refund is US$4.99 × 400 ÷ 500 = US$3.99.',
          ],
          [
            '年繳方案：未使用的完整未來月份全額退還，當前月份按未使用點數比例計算。公式為：實付金額 ×（11 + 未使用方案點數 ÷ 每月方案點數）÷ 12。若完全未使用，比例為 12/12，即全額退還。',
            'Yearly plan: untouched future months are refunded in full and the current month uses the unused-point share. The formula is: amount paid × (11 + unused plan points ÷ monthly plan points) ÷ 12. With no points used, the ratio is 12/12 and the full amount is refunded.',
          ],
          [
            '計算只計入方案每月點數；加購或贈送的點數不計入，亦不可退款，但法律要求，或點數因我們的原因無法使用時，不在此限。',
            'Only the plan’s monthly points are counted. Purchased or gifted bonus points are excluded and non-refundable, except where the law requires it or the points cannot be used for reasons attributable to us.',
          ],
          [
            '退款一經完成，訂閱會即時終止，帳戶回到免費方案，剩餘的方案點數會清除；你不會保留未使用的付費使用權。單純取消而不申請退款，則可使用至目前已付期間結束。',
            'Once a refund is completed the subscription ends immediately, the account returns to the free plan and the remaining plan points are cleared; you do not keep the unused paid access. A cancellation without a refund instead keeps access until the end of the period already paid for.',
          ],
          [
            '退款經 Stripe 退回原付款方式，原則上以原交易幣別處理；實際入帳時間與當地金額可能因發卡機構、銀行或匯率而異，我們不另扣手續費。若 Stripe 回報退款失敗，帳戶頁面會顯示狀態，我們會與你跟進處理。',
            'Refunds are returned through Stripe to the original payment method, normally in the original transaction currency. The time to appear and the local amount may vary with your card issuer, bank or exchange rate; we do not deduct an additional fee. If Stripe reports that the refund failed, the Account page shows that status and we will follow it up with you.',
          ],
          [
            '本條不限制你所在地法律賦予的強制取消或退款權利。若你已刪除帳戶、帳單不是首次訂閱付款，或系統無法自動處理，請在刪除帳戶前先來信申請退款；刪除帳戶本身不會自動退款。',
            'Nothing in this section limits a mandatory cancellation or refund right you have where you live. If you have deleted your account, the invoice is not the first subscription payment, or the automatic flow cannot process it, write to us before deleting the account; deleting an account does not itself issue a refund.',
          ],
          [
            '申請退款或對收費有疑問，請透過「帳戶」頁面或本條款下方的聯絡方式與我們聯絡。',
            'To request a refund or question a charge, use the Account page or the contact details at the end of these terms.',
          ],
        ),
      ],
    ),

    s(
      'account',
      '帳號與安全',
      'Accounts and security',
      [
        ul(
          [
            '請提供正確的資料，並妥善保管你的密碼與登入方式。',
            'Provide accurate details and keep your password and sign-in method secure.',
          ],
          [
            '你帳號下發生的活動由你負責。若發現未經授權的使用，請立即通知我們。',
            'You are responsible for activity under your account. Tell us immediately if you notice unauthorised use.',
          ],
          [
            '若你訂閱付費方案，請提供正確且最新的帳單資料，並確保你有權使用該付款方式。你帳號下產生的訂閱費用由你負責。',
            'If you subscribe to a paid plan, keep your billing details accurate and up to date, and make sure you are authorised to use the payment method. You are responsible for subscription charges incurred under your account.',
          ],
          [
            '你可以隨時在「帳號」頁面刪除帳號。若你有付費訂閱，刪除帳號時我們會先停止其自動續訂；刪除帳號本身不會退款，請在刪除前先依退款條款申請。發票與交易紀錄可能依法律保留。',
            'You can delete your account at any time from the Account page. If you have a paid subscription, deleting the account first stops it renewing; deleting the account does not itself issue a refund, so request one under the refunds section before deleting. Invoices and transaction records may be retained as required by law.',
          ],
          [
            '我們可能在你違反本條款時限制或終止你的帳號。',
            'We may restrict or close your account if you break these terms.',
          ],
        ),
      ],
    ),

    s(
      'content',
      '使用者內容',
      'Your content',
      [
        p(
          '你建立的題庫、筆記與教材仍屬於你。你授予我們一項非專屬、全球、免費的授權，僅用於儲存、傳輸、備份與顯示這些內容，以提供本服務。',
          'The decks, notes and materials you create remain yours. You grant us a non-exclusive, worldwide, royalty-free licence to store, transmit, back up and display that content solely to provide the service.',
        ),
        p(
          'AI 生成內容的著作權狀態可能因地區而異。在法律允許的範圍內，我們不主張對你透過本服務產生的 AI 題庫擁有著作權；但你也不會因此獲得超出適用法律、AI 供應商條款或第三方權利所提供的權利，且你仍需自行負責其使用與散布。',
          'Copyright in AI-generated content may differ between jurisdictions. To the extent the law allows, we do not claim copyright in AI-generated decks you create through the service; but you do not receive rights beyond those available under applicable law, the AI provider’s terms or third-party rights, and you remain responsible for using and distributing that content.',
        ),
        ul(
          [
            '你聲明你擁有這些內容的權利，或已取得必要的授權，且上傳不會侵害他人的著作權、商標、隱私或營業秘密。',
            'You confirm that you own or are licensed to use that content and that uploading it does not infringe anyone’s copyright, trade mark, privacy or trade secrets.',
          ],
          [
            '你的題庫預設不公開。我們不會把它們發布到廣場，也不會提供給其他使用者。',
            'Your decks are private by default. We do not publish them to the Plaza or make them available to other learners.',
          ],
          [
            '你可以隨時刪除自己的題庫；刪除後即從你的帳號移除。',
            'You can delete your decks at any time; they are removed from your account when you do.',
          ],
        ),
      ],
    ),

    s(
      'acceptable',
      '可接受的使用方式',
      'Acceptable use',
      [
        p('你不得有下列行為：', 'You must not:'),
        ul(
          [
            '上傳侵害著作權、商標、隱私或營業秘密的內容。',
            'Upload content that infringes copyright, trade marks, privacy or trade secrets.',
          ],
          [
            '以自動化方式大量存取、爬取、癱瘓或規避本服務的流量限制。',
            'Access the service automatically at scale, scrape it, overwhelm it or evade its rate limits.',
          ],
          [
            '嘗試繞過存取控制、探查其他使用者的資料，或測試系統弱點後未負責任地揭露。',
            'Try to bypass access controls, probe other learners’ data, or test for weaknesses without responsible disclosure.',
          ],
          [
            '逆向工程、拆解或修改應用程式，但法律明文允許者不在此限。',
            'Reverse engineer, decompile or modify the app, except where the law expressly permits it.',
          ],
          [
            '將本服務用於違法用途，或在明令禁止使用電子設備的考試中使用。',
            'Use the service for anything unlawful, or in an exam that forbids electronic devices.',
          ],
          [
            '冒用他人身分，或散布惡意程式。',
            'Impersonate anyone, or distribute malware.',
          ],
          [
            '移除、遮蓋或偽造 AI 生成標示，或把 AI 生成內容冒充為人工撰寫、人工審核或官方答案。',
            'Remove, obscure or forge AI-generated labels, or present AI-generated content as human-written, human-reviewed or official answers.',
          ],
          [
            '生成、上傳、要求或散布 AI 生成的未經同意私密影像（AI NCII）、兒少性虐待內容、涉及未成年人的性內容，或其他侵害他人隱私、同意或尊嚴的性化內容。',
            'Generate, upload, request or distribute AI-generated non-consensual intimate imagery (AI NCII), child sexual abuse material, sexual content involving minors, or any sexualised content that violates another person’s privacy, consent or dignity.',
          ],
          [
            '使用 AI 出題功能來建立上述內容，或用來冒充、誹謗或騷擾真實人物。',
            'Use the AI generation feature to create that content, or to impersonate, defame or harass a real person.',
          ],
        ),
      ],
    ),

    s(
      'ai-output',
      'AI 生成的內容與標示',
      'AI-generated content and labelling',
      [
        p(
          '本服務的題目、答案、解釋、插圖、圖表說明、翻譯或其他文字與圖片，可能全部或部分由生成式 AI 產生。我們會在生成結果或其他介面位置，以「AI 生成」標籤、模型名稱或說明標示；標示可能適用於整份結果，不一定逐句出現。除介面明確說明已經人工審核外，AI 生成內容未經我們逐項人工審核。',
          'Questions, answers, explanations, illustrations, figure captions, translations and other text or images in the service may be generated in whole or in part by generative AI. We label AI-generated output in the generation result or another interface location with an “AI-generated” label, the model name or a description. A label may apply to the whole result rather than every sentence. Unless the interface expressly says otherwise, AI-generated content is not individually reviewed by us.',
        ),
        p(
          '由應用程式依結構化資料繪製的 Render 圖表（函數、幾何、圖表、地圖、電路、分子、時間軸、表格、流程圖等）不是生成式 AI 產生的圖片，但其資料與呈現仍可能出錯，請一併核對。插圖也可能來自網路圖片搜尋；若使用外部圖片，介面會顯示作者與授權資訊，該圖片不是 AI 生成，但仍受其授權條款約束。',
          'Render figures drawn by the app from structured data (functions, geometry, charts, maps, circuits, molecules, timelines, tables and flowcharts) are not generative-AI images, but their data and presentation can still be wrong; check them too. Illustrations may also come from web image search; where an external image is used, the interface shows its author and licence. That image is not AI-generated, but its licence still applies.',
        ),
        ul(
          [
            'AI 生成內容可能錯誤、虛構、過時、帶有偏見，或把不存在的事物說成事實；它也可能誤解你的教材。請以獨立來源核對事實、計算、程式碼、引用、翻譯、圖表與數字，再使用或分享。',
            'AI-generated content may be wrong, fabricated, out of date, biased, or present invented material as fact; it may also misread your materials. Verify facts, calculations, code, citations, translations, figures and numbers against independent sources before you use or share it.',
          ],
          [
            '不要只依賴 AI 生成內容作考試答案、醫療、法律、財務、安全或其他專業或高風險決定，也不要把單一題庫當成考試範圍的完整依據。程式題的程式碼可能不安全或不可執行，請自行測試。',
            'Do not rely on AI-generated content alone for exam answers, medical, legal, financial, safety or other professional or high-stakes decisions, and do not treat one deck as complete coverage of an exam syllabus. Code in code questions may be unsafe or may not run; test it yourself.',
          ],
          [
            '請保留我們提供的任何「AI 生成」標籤、模型名稱與相關說明，不得移除、遮蓋、改寫或偽造，以誤導他人以為內容由人工撰寫或審核。當你公開、分享、匯出或提交 AI 生成內容時，請依法律、平台規則、學校或考試規定揭露其為 AI 生成。',
            'Keep any “AI-generated” label, model name and related notices we provide. Do not remove, obscure, alter or forge them to mislead anyone into thinking the content was written or reviewed by a human. When you publish, share, export or submit AI-generated content, disclose that it is AI-generated where required by law, platform rules, or your school or exam rules.',
          ],
          [
            'AI 生成內容可能重現或近似受著作權、商標、肖像權或隱私保護的作品、品牌、真實人物或地點。你必須確保使用、修改或散布不會侵害他人權利；若輸出含有你不應使用的第三方內容，請勿使用，我們也可移除相關內容。',
            'AI-generated content may reproduce or resemble copyrighted works, trade marks, real people or places, or material protected by publicity or privacy rights. You must ensure that your use, modification or distribution does not infringe those rights. Do not use output that contains third-party material you are not entitled to use; we may remove it.',
          ],
          [
            '模型、版本與供應商可能改變，相同提示不一定得到相同結果。我們不保證 AI 生成內容可重現、正確、適合特定用途，也不保證 AI 偵測工具能正確辨識它。',
            'Models, versions and providers may change, and the same prompt may not produce the same result. We do not guarantee that AI-generated content is reproducible, accurate or fit for a particular purpose, or that AI-detection tools will identify it correctly.',
          ],
          [
            '生成品質取決於你選擇的模型與教材。AI 出題已包含在本服務內，你不需要自備 API 金鑰；用量依你的方案額度或點數計算。你仍需遵守所選 AI 供應商的條款，我們也可能依公平使用政策限制或暫停用量。',
            'Quality depends on the model and materials you choose. AI generation is included in the service; you do not need your own API key, and usage is metered by your plan allowance or points. You must still follow the terms of the AI provider used for your request, and we may limit or suspend usage under our fair-use policy.',
          ],
          [
            'AI 出題只供學術溫習使用。你不得用它生成或散布未經同意的私密影像（AI NCII）、兒少性虐待內容、性化內容、深度偽造、冒充真實人物，或侵害他人隱私、名譽或智慧財產的內容；我們可移除這類內容並停用帳號。',
            'AI generation is for academic revision only. You must not use it to create AI-generated non-consensual intimate imagery (AI NCII), child sexual abuse material, sexualised content, deepfakes, impersonations of real people, or content that infringes anyone’s privacy, reputation or intellectual property; we may remove such content and suspend the account.',
          ],
          [
            '若你發現有害、違法或不準確的 AI 生成內容，請透過本條款下方的聯絡方式通知我們；我們會視情況更正、標示或移除。',
            'If you find harmful, unlawful or inaccurate AI-generated content, report it through the contact details at the end of these terms; we may correct, label or remove it.',
          ],
        ),
      ],
    ),

    s(
      'ip',
      '智慧財產權',
      'Intellectual property',
      [
        ul(
          [
            '本服務的程式、介面設計、「MengYin Study」名稱與標誌屬於我們所有。',
            'The app’s code, interface design and the MengYin Study name and marks belong to us.',
          ],
          [
            '官方題庫由我們或內容提供者授權提供，僅供你個人學習使用；未經授權不得重製、改作或再散布。',
            'Official decks are licensed to us by their authors and are for your personal study only; they may not be copied, adapted or redistributed without permission.',
          ],
          [
            '本服務使用開源元件，各元件依其授權條款提供。',
            'The service uses open-source components, each provided under its own licence.',
          ],
        ),
      ],
    ),

    s(
      'third-party',
      '第三方服務',
      'Third-party services',
      [
        p(
          '本服務整合 Supabase、Cloudflare（含 Workers AI）、Stripe（付款與訂閱）、智譜 GLM、DeepSeek、Google 與 GitHub。這些服務由其營運者負責，並適用它們自己的條款與隱私權政策。我們不為第三方的可用性、內容或行為負責，但這不影響我們依法應負的責任。',
          'The service integrates Supabase, Cloudflare (including Workers AI), Stripe (payments and subscriptions), Zhipu GLM, DeepSeek, Google and GitHub. Those services are run by their own operators under their own terms and privacy policies. We are not responsible for their availability, content or conduct, except where the law makes us responsible.',
        ),
      ],
    ),

    s(
      'google',
      'Google API 與 Google 登入',
      'Google APIs and Google Sign-In',
      [
        p(
          '若你使用 Google 登入，我們只會取得你的 Google 帳號識別碼、名稱、電子郵件地址與頭像網址，並只用於建立帳號、驗證身分與顯示個人資料。我們不會要求 Gmail、Google Drive、日曆、聯絡人或其他 Google 服務的存取權。',
          'If you use Google Sign-In, we receive only your Google account ID, name, email address and profile picture URL, and use them only to create your account, authenticate you and display your profile. We do not request access to Gmail, Google Drive, Calendar, Contacts or any other Google service.',
        ),
        p(
          'MengYin Study 對 Google API 所取得資訊的使用與傳輸，遵守 Google API 服務使用者資料政策，包括其中的 Limited Use（有限使用）要求。Google API 只用於登入，不用於 AI 出題；我們不會使用 Google API 來建立、生成或散布 AI 生成的未經同意私密影像（AI NCII）。',
          "MengYin Study's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Google APIs are used only for sign-in, never for AI generation; we do not use Google APIs to create, generate or distribute AI-generated non-consensual intimate imagery (AI NCII).",
        ),
        links(
          [
            'Google API 服務使用者資料政策',
            'Google API Services User Data Policy',
            'https://developers.google.com/terms/api-services-user-data-policy',
          ],
          ['Google API 服務條款', 'Google APIs Terms of Service', 'https://developers.google.com/terms'],
        ),
      ],
    ),

    s(
      'changes',
      '服務的變更與中止',
      'Changes and termination',
      [
        ul(
          [
            '我們可能新增、修改或移除功能，或暫停服務進行維護。',
            'We may add, change or remove features, or pause the service for maintenance.',
          ],
          [
            '若我們決定結束本服務，會以合理方式提前通知，並在可行範圍內提供匯出資料的機會。若你已預付付費方案，我們會依未使用期間比例退還費用，或依法律要求處理。',
            'If we decide to shut the service down, we will give reasonable notice and, where we can, a chance to export your data. If you have prepaid a paid plan, we will refund the unused portion pro rata or otherwise as the law requires.',
          ],
        ),
      ],
    ),

    s(
      'disclaimer',
      '免責聲明',
      'Disclaimer',
      [
        p(
          '本服務按「現狀」與「現有」提供，不提供任何明示或默示的擔保，包括可用性、正確性、完整性或特定目的適用性的擔保。我們不保證服務不中斷、無錯誤，或題庫內容符合任何考試要求。',
          'The service is provided “as is” and “as available”, without warranties of any kind, express or implied, including availability, accuracy, completeness or fitness for a particular purpose. We do not guarantee uninterrupted or error-free operation, or that any deck matches any exam syllabus.',
        ),
      ],
    ),

    s(
      'liability',
      '責任限制',
      'Limitation of liability',
      [
        p(
          '在法律允許的最大範圍內，我們對因使用或無法使用本服務所生的間接、附隨、特別、懲罰性或後果性損害不負責任，包括成績、機會或資料的損失。',
          'To the fullest extent the law allows, we are not liable for indirect, incidental, special, punitive or consequential losses arising from use of, or inability to use, the service, including lost grades, opportunities or data.',
        ),
        p(
          '在法律允許的最大範圍內，不論你使用免費或付費方案，我們的總責任以你於事件發生前 12 個月內就本服務實際支付的金額為上限；若你未支付任何費用，則以新台幣 1,000 元為上限。本條不排除依法不得排除的責任，例如故意或重大過失，或造成人身傷害的責任。',
          'To the fullest extent the law allows, whether you use a free or paid plan, our total liability is limited to the amount you actually paid us for the service in the 12 months before the event giving rise to the claim; if you paid nothing, the limit is NT$1,000. Nothing in these terms excludes liability that cannot lawfully be excluded, such as for intent, gross negligence or personal injury.',
        ),
      ],
    ),

    s(
      'law',
      '準據法與爭議解決',
      'Governing law and disputes',
      [
        p(
          '本條款依中華民國（台灣）法律解釋與適用，不適用其涉外民事法律適用法中關於準據法選擇的規定。因本條款所生的爭議，以台灣台北地方法院為第一審管轄法院。',
          'These terms are governed by the laws of the Republic of China (Taiwan), without regard to its choice-of-law rules. Disputes arising from these terms are subject to the first-instance jurisdiction of the Taipei District Court, Taiwan.',
        ),
        p(
          '這不影響你依你所在地消費者保護法強制規定所享有的權利。',
          'This does not affect rights you have under mandatory consumer protection rules where you live.',
        ),
      ],
    ),

    s(
      'term-changes',
      '條款變更',
      'Changes to these terms',
      [
        p(
          '我們可能更新本條款。重大變更會在應用程式內公告，並更新本頁的版本與生效日期。變更後繼續使用服務，即表示你接受更新後的條款；若你不同意，可以停止使用並刪除帳號。',
          'We may update these terms. Material changes will be announced in the app and the version and effective date on this page will be updated. Continuing to use the service after a change means you accept the updated terms; if you disagree, you may stop using the service and delete your account.',
        ),
      ],
    ),

    s(
      'general',
      '一般條款',
      'General',
      [
        ul(
          [
            '若本條款的任何部分被認定無效，其餘部分仍然有效。',
            'If any part of these terms is held invalid, the rest remains in force.',
          ],
          [
            '本條款與隱私權政策構成你與我們之間關於本服務的完整協議。',
            'These terms and the Privacy Policy are the entire agreement between you and us about the service.',
          ],
          [
            '我們未行使某項權利，不表示我們放棄該權利。',
            'If we do not enforce a right, we are not waiving it.',
          ],
        ),
      ],
    ),

    s('contact', '聯絡我們', 'Contact us', [contact()]),
  ],
};

export const LEGAL_DOCS: Record<'privacy' | 'terms', LegalDoc> = {
  privacy: privacyPolicy,
  terms: termsOfService,
};

export const LEGAL_CHROME = {
  updated: { zh: '最後更新', en: 'Last updated' },
  version: { zh: '版本', en: 'Version' },
  back: { zh: '返回應用程式', en: 'Back to the app' },
  contents: { zh: '目錄', en: 'Contents' },
  english: { zh: 'English', en: 'English' },
  chinese: { zh: '繁體中文', en: '繁體中文' },
  language: { zh: '語言', en: 'Language' },
  footer: {
    zh: '本文件同時提供繁體中文與英文版本。如兩個版本有任何歧異，以繁體中文版為準。',
    en: 'This document is published in Traditional Chinese and English. If the two versions differ, the Traditional Chinese version prevails.',
  },
  contactLead: {
    zh: '隱私、帳號與條款相關的問題，請透過下列管道聯絡我們。我們會在 30 天內回覆。',
    en: 'For questions about privacy, your account or these terms, contact us through the channels below. We reply within 30 days.',
  },
  contactEmailLabel: { zh: '電子郵件', en: 'Email' },
} as const;
