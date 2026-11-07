/**
 * Public homepage copy.
 *
 * Kept outside the React component for two reasons: the same text is used by
 * the pre-JavaScript shell in `index.html`, and a reviewer comparing the OAuth
 * consent screen with the homepage should see one name — `MengYin Study` — in
 * both languages, never a translated variant.
 */

export interface Bi {
  en: string;
  zh: string;
}

export const APP_DISPLAY_NAME = 'MengYin Study';

export interface Feature {
  number: string;
  title: Bi;
  body: Bi;
}

export interface Step {
  number: string;
  title: Bi;
  body: Bi;
}

export const LANDING = {
  eyebrow: {
    en: 'A study tool for building, practising and remembering',
    zh: '建立、練習、記住的溫習工具',
  } satisfies Bi,

  heroLede: {
    en: 'A revision and practice app that helps you build your own question decks, drill the questions you keep missing, and see what you have actually learned.',
    zh: '一款溫習與練習應用程式：建立自己的題庫、反覆練好一直答錯的題目，並看清自己真正掌握了什麼。',
  } satisfies Bi,

  heroBody: {
    en: 'Study official decks or import your course material. Generate practice questions with the built-in AI service, practise code in six languages, and see exactly what you have learned. No ads, no tracking, and no selling your data.',
    zh: '研讀官方題庫或匯入自己的教材，用內建的 AI 服務生成練習題，練習六種程式語言，並清楚看見自己學會了什麼。沒有廣告、沒有行為追蹤，也不出售你的資料。',
  } satisfies Bi,

  ctaPrimary: { en: 'Start studying', zh: '開始練習' } satisfies Bi,
  ctaSignIn: { en: 'Sign in', zh: '登入' } satisfies Bi,
  ctaCreate: { en: 'Create a free account', zh: '建立免費帳號' } satisfies Bi,
  nav: {
    pricing: { en: 'Pricing', zh: '方案與價格' },
  } satisfies Record<string, Bi>,

  ctaNote: {
    en: 'Start free in the browser or desktop app. Paid plans add AI points, stronger models and images; cancel any time.',
    zh: '可免費開始，支援瀏覽器與桌面版。付費方案提供 AI 點數、更強模型與生圖，並可隨時取消。',
  } satisfies Bi,
  ctaPricing: {
    en: 'See plans and points',
    zh: '查看方案與點數',
  } satisfies Bi,

  preview: {
    label: { en: 'Illustrative preview', zh: '介面示意' },
    title: { en: 'Today', zh: '今日' },
    due: { en: '12 due', zh: '12 題待複習' },
    mistakes: { en: '3 mistakes', zh: '3 題錯題' },
    accuracy: { en: '86% accuracy', zh: '86% 正確率' },
    questionLabel: { en: 'Multiple choice · Data structures', zh: '單選題 · 資料結構' },
    question: {
      en: 'Which data structure is last in, first out?',
      zh: '哪一種資料結構是後進先出？',
    },
    optionCorrect: { en: 'Stack', zh: '堆疊' },
    optionWrong: { en: 'Queue', zh: '佇列' },
    explanation: {
      en: 'A stack pushes and pops at the same end.',
      zh: '堆疊在同一端推入與彈出。',
    },
    footer: {
      en: 'Practice · Exam · Mistakes · Spaced review',
      zh: '練習 · 測驗 · 錯題 · 間隔複習',
    },
  },

  features: {
    eyebrow: { en: 'What you can do', zh: '你可以做什麼' },
    title: { en: 'One place to practise, review and remember.', zh: '在同一個地方練習、複習、記住。' },
    body: {
      en: 'Everything is built around a simple loop: answer questions, see what went wrong, and come back to it at the right time.',
      zh: '一切都圍繞一個簡單循環：作答、看清哪裡出錯，然後在適當的時候再練一次。',
    },
    items: [
      {
        number: '01',
        title: { en: 'Build or import decks', zh: '建立或匯入題庫' },
        body: {
          en: 'Write questions by hand, import JSON, CSV or Markdown, or point the app at a folder of notes. Plugins can add custom question types and importers.',
          zh: '可以手寫題目、匯入 JSON、CSV 或 Markdown，或直接指向一個筆記資料夾。插件可加入自訂題型與匯入器。',
        },
      },
      {
        number: '02',
        title: { en: 'Practice that adapts', zh: '會調整的練習' },
        body: {
          en: 'Spaced repetition brings questions back when they are due. Mistake drills and exam mode cover the other ways you revise.',
          zh: '間隔重複會在題目到期時把它們帶回來；錯題重練與測驗模式則照顧其他溫習方式。',
        },
      },
      {
        number: '03',
        title: { en: 'AI questions, built in', zh: 'AI 出題，內建服務' },
        body: {
          en: 'Turn your notes into practice questions with the built-in GLM and DeepSeek service. The free plan includes 200 questions a month; paid plans add points and stronger models — no API key needed.',
          zh: '用內建的 GLM 與 DeepSeek 服務把筆記變成練習題。免費方案每月 200 題；付費方案提供點數與更強模型，不需自備 API 金鑰。',
        },
      },
      {
        number: '04',
        title: { en: 'Code questions that run', zh: '真正可執行的程式題' },
        body: {
          en: 'Practise JavaScript, TypeScript, Python, SQL, Java and C++ with tests that run locally in the browser. No execution server.',
          zh: '練習 JavaScript、TypeScript、Python、SQL、Java 與 C++，測試直接在瀏覽器本機執行，不需要執行伺服器。',
        },
      },
      {
        number: '05',
        title: { en: 'Progress that follows you', zh: '進度跟著你走' },
        body: {
          en: 'Create an account to sync decks and progress across devices. Stay signed out and everything stays in this browser.',
          zh: '建立帳號即可在裝置之間同步題庫與進度；不登入時，所有資料只留在這個瀏覽器。',
        },
      },
      {
        number: '06',
        title: { en: 'Private by default', zh: '預設私密' },
        body: {
          en: 'No advertising, no behavioural tracking, no selling data. Export a backup or delete your account whenever you want.',
          zh: '沒有廣告、沒有行為追蹤、不出售資料。你隨時可以匯出備份或刪除帳號。',
        },
      },
    ] satisfies Feature[],
  },

  how: {
    eyebrow: { en: 'How it works', zh: '怎麼運作' },
    title: {
      en: 'Pick a deck. Answer a few questions. Let the review queue do the rest.',
      zh: '選一組題庫，先答幾題，剩下的交給複習排程。',
    },
    steps: [
      {
        number: '01',
        title: { en: 'Choose or make a deck', zh: '選擇或建立題庫' },
        body: {
          en: 'Start with an official deck, import your notes, or generate a set from a topic.',
          zh: '從官方題庫開始、匯入自己的筆記，或直接從主題生成一組題目。',
        },
      },
      {
        number: '02',
        title: { en: 'Practise and review', zh: '練習與複習' },
        body: {
          en: 'Answer in practice, exam or mistake-drill mode. Every attempt updates what is due next.',
          zh: '用練習、測驗或錯題模式作答；每次作答都會更新下次到期的題目。',
        },
      },
      {
        number: '03',
        title: { en: 'See what stuck', zh: '看見學習成果' },
        body: {
          en: 'Accuracy, mastery and a 14-day activity chart show where you are improving and what to study next.',
          zh: '正確率、掌握度與 14 天活動圖，讓你看見哪裡進步、下一節該練什麼。',
        },
      },
    ] satisfies Step[],
  },

  audience: {
    eyebrow: { en: 'Who it is for', zh: '適合誰' },
    title: { en: 'Students, self-learners and tutors.', zh: '學生、自學者與補習導師。' },
    body: {
      en: 'Use it for course revision, language practice, professional exams or any subject where recall matters.',
      zh: '適用於課程溫習、語言練習、專業考試，或任何需要記憶與回想的主題。',
    },
    points: [
      { en: 'University and school students revising for exams', zh: '準備考試的大學生與中學生' },
      { en: 'Self-learners working through a textbook or course', zh: '跟著教科書或課程自學的人' },
      { en: 'Tutors building a shared question bank for students', zh: '為學生建立共用題庫的導師' },
    ] satisfies Bi[],
  },

  google: {
    eyebrow: { en: 'Sign-in and data', zh: '登入與資料' },
    title: { en: 'Your data, kept for study.', zh: '你的資料，只用於溫習。' },
    body: {
      en: 'If you sign in with Google or email, we use the account only to sync decks and progress across devices and to show your name and avatar. Google gives us only your name, email address and profile picture URL.',
      zh: '若你以 Google 或電子郵件登入，我們只會用該帳號在裝置之間同步題庫與進度，以及顯示你的名稱與頭像。Google 只會提供你的名稱、電子郵件地址與頭像網址。',
    },
    points: [
      {
        en: 'We never request Gmail, Google Drive, Google Calendar, Contacts or Photos.',
        zh: '我們不會要求 Gmail、Google Drive、Google 日曆、聯絡人或相簿的存取權。',
      },
      {
        en: 'We do not sell your data, use it for advertising, or use it to train AI models.',
        zh: '我們不會出售你的資料、不會用於廣告，也不會用於訓練 AI 模型。',
      },
      {
        en: 'Delete your account and cloud data in the app at any time, or revoke access from your Google Account.',
        zh: '你可以隨時在應用程式內刪除帳號與雲端資料，或從 Google 帳號撤銷存取權。',
      },
    ] satisfies Bi[],
    limitedUse: {
      en: "MengYin Study's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
      zh: 'MengYin Study 對 Google API 所取得資訊的使用與傳輸，遵守 Google API 服務使用者資料政策，包括其中的 Limited Use（有限使用）要求。',
    } satisfies Bi,
    apiOnlyForSignIn: {
      en: 'Google APIs are used only for sign-in. They are not used for AI generation.',
      zh: 'Google API 只用於登入，不用於 AI 出題。',
    } satisfies Bi,
    policyLabel: { en: 'Google API Services User Data Policy', zh: 'Google API 服務使用者資料政策' },
    policyHref: 'https://developers.google.com/terms/api-services-user-data-policy',
  },

  ai: {
    eyebrow: { en: 'AI and content policy', zh: 'AI 與內容政策' },
    title: { en: 'AI for study questions — nothing else.', zh: 'AI 只用來出練習題，不做其他用途。' },
    body: {
      en: 'AI generation is optional and runs through this service, which uses GLM, DeepSeek and Cloudflare Workers AI with provider keys held on the server. AI-generated output is labelled in the app. It is designed to turn study material into practice questions, not to produce general-purpose or adult content.',
      zh: 'AI 出題是選用的，經由本服務使用 GLM、DeepSeek 與 Cloudflare Workers AI，供應商金鑰由伺服器保管。AI 生成的內容會在應用程式內標示。它的用途是把溫習教材變成練習題，不是產生通用或成人內容。',
    },
    points: [
      {
        en: 'Materials are parsed on your device; only a bounded excerpt is sent to the AI service for the request, and provider keys never reach the browser.',
        zh: '教材在你的裝置上解析；只有有限的片段會為該次請求送到 AI 服務，供應商金鑰不會進入瀏覽器。',
      },
      {
        en: 'AI-generated questions, answers, explanations and images are labelled at the result level. Keep the label when you share or export them.',
        zh: 'AI 生成的題目、答案、解釋與插圖會以整份結果標示；分享或匯出時請保留標示。',
      },
      {
        en: 'AI can invent facts, citations, calculations or code. Verify them against independent sources before you rely on them.',
        zh: 'AI 可能虛構事實、引用、計算或程式碼；使用前請以獨立來源核對。',
      },
      {
        en: 'Do not use AI output as the only source for exams, professional advice or other high-stakes decisions.',
        zh: '不要只依賴 AI 輸出作考試答案、專業意見或其他高風險決定。',
      },
    ] satisfies Bi[],
    policy: {
      en: 'MengYin Study does not use Google APIs, and does not permit any use of the app or its AI feature, to create, generate or distribute AI-generated non-consensual intimate imagery (AI NCII), child sexual abuse material, sexualised content, or content that harasses or degrades another person. Such content is prohibited.',
      zh: 'MengYin Study 不會使用 Google API，也不允許任何人使用本應用程式或其 AI 功能來建立、生成或散布 AI 生成的未經同意私密影像（AI NCII）、兒少性虐待內容、性化內容，或騷擾、貶抑他人的內容。這類內容一律禁止。',
    } satisfies Bi,
    termsLabel: { en: 'Read the Terms of Service', zh: '閱讀服務條款' },
  },

  cta: {
    title: { en: 'Start with a deck. See what sticks.', zh: '先從一組題庫開始，看看什麼留得下來。' },
    body: {
      en: 'Pick a deck, answer a few questions, and let the review queue schedule what comes next.',
      zh: '選一組題庫，先答幾題，讓複習排程安排接下來要練什麼。',
    },
  },

  footer: {
    tagline: { en: 'Revision & practice, for the long run.', zh: '為長遠學習而設的溫習與練習。' },
    independent: {
      en: 'MengYin Study is an independent study project.',
      zh: 'MengYin Study 是一個獨立的溫習計劃。',
    },
    trademark: {
      en: 'Google and Google Sign-In are trademarks of Google LLC.',
      zh: 'Google 與 Google 登入是 Google LLC 的商標。',
    },
    privacy: { en: 'Privacy Policy', zh: '隱私權政策' },
    terms: { en: 'Terms of Service', zh: '服務條款' },
    pricing: { en: 'Pricing', zh: '方案與價格' },
    contact: { en: 'Contact', zh: '聯絡我們' },
  },
} as const;
