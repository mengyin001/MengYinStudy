#!/usr/bin/env node
/**
 * Scaffolds a new question-pack plugin: `npm run plugin:new -- my-topic`
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function slugify(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

const rawName = process.argv[2];
if (!rawName) {
  console.error('用法：npm run plugin:new -- <插件名稱>');
  console.error('例如：npm run plugin:new -- calculus-week1');
  process.exit(1);
}

const slug = slugify(rawName);
if (!slug || !/^[a-z0-9]/.test(slug)) {
  console.error('插件名稱需以英文字母或數字開頭，只可包含 a-z 0-9 . _ -');
  process.exit(1);
}

const pluginDir = path.join(root, 'plugins', slug);
if (await exists(pluginDir)) {
  console.error(`plugins/${slug} 已存在，請使用其他名稱。`);
  process.exit(1);
}

const title = rawName.replace(/[-_]+/g, ' ').trim();
const deckId = `${slug}-basics`;

const manifest = {
  schemaVersion: 1,
  id: slug,
  name: `${title} 複習`,
  version: '1.0.0',
  description: '用一兩句說明這個題庫涵蓋的內容。',
  author: '',
  tags: [title],
  content: ['./decks/*.json'],
};

const deck = {
  id: deckId,
  title: '第一章：示範題目',
  description: '把問題換成你自己的溫習內容。',
  tags: [title],
  questions: [
    {
      id: `${slug}-q1`,
      type: 'single',
      prompt: '這是一條單選題示範，請把題目內容換成你的問題。',
      options: [
        { id: 'a', text: '選項 A' },
        { id: 'b', text: '選項 B（正確答案）' },
        { id: 'c', text: '選項 C' },
      ],
      answer: { kind: 'single', optionId: 'b' },
      explanation: '在這裡寫解析，作答後會顯示。',
      tags: [title, '示範'],
      difficulty: 1,
    },
    {
      id: `${slug}-q2`,
      type: 'fill',
      prompt: '這是一條填空題示範：1 + 1 = ____',
      answer: { kind: 'fill', accept: ['2', '二'] },
      explanation: 'accept 陣列內任何一個寫法都會被視為正確，並會自動忽略大小寫與多餘空格。',
      tags: [title, '示範'],
      difficulty: 1,
    },
  ],
};

const readme = `# ${title} 複習插件

由 \`npm run plugin:new\` 建立。

- \`manifest.json\`：插件資料（id、名稱、題庫檔案清單）
- \`decks/*.json\`：題庫內容

## 下一步

1. 編輯 \`decks/${deckId}.json\`，換成你的題目。
2. 執行 \`npm run plugins:sync\`（或 \`npm run plugins:watch\`）。
3. 重新整理應用，在「題庫」頁看到新題庫。

題目格式與題型擴充請參考 \`docs/PLUGIN_GUIDE.md\`。
`;

await mkdir(path.join(pluginDir, 'decks'), { recursive: true });
await writeFile(path.join(pluginDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(path.join(pluginDir, 'decks', `${deckId}.json`), `${JSON.stringify(deck, null, 2)}\n`, 'utf8');
await writeFile(path.join(pluginDir, 'README.md'), readme, 'utf8');

const indexFile = path.join(root, 'apps', 'web', 'public', 'plugins', 'index.json');
if (await exists(indexFile)) {
  try {
    JSON.parse(await readFile(indexFile, 'utf8'));
  } catch {
    // ignore, sync will rebuild it
  }
}

console.log(`✔ 已建立 plugins/${slug}`);
console.log('  下一步：npm run plugins:sync');
