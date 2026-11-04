#!/usr/bin/env node
/**
 * Headless smoke test: drives the built app in Edge/Chrome via puppeteer-core.
 * Covers practice, results, statistics, plugins (custom type + CSV importer),
 * the protected account route and auth forms, both languages and both themes.
 * Set ALLOW_BACKEND_OFFLINE=1 when the Supabase migrations have not been applied.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, '_screenshots');
const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
// The migration/seed step is external to this repository's build. Set this to
// 1 when intentionally testing on a project whose tables have not been created.
const allowBackendOffline = process.env.ALLOW_BACKEND_OFFLINE === '1';

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

const results = [];
const errors = [];

function record(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickText(page, needle, selector = 'button, a') {
  const handle = await page.evaluateHandle(
    (text, query) => {
      const elements = [...document.querySelectorAll(query)];
      return elements.find((element) => (element.textContent ?? '').trim().includes(text)) ?? null;
    },
    needle,
    selector,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`no element containing "${needle}"`);
  await element.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await element.click();
}

async function textOf(page, selector) {
  return page.$eval(selector, (node) => node.textContent ?? '').catch(() => '');
}

async function shot(page, name) {
  await sleep(240);
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

async function go(page, hash) {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await sleep(260);
}

async function answerCurrentQuestion(page, options = {}) {
  const { selfGrade = true } = options;
  if (await page.$('.choice-list .choice')) {
    await page.click('.choice-list .choice');
    return 'choice';
  }
  if (await page.$('.tf-row .tf')) {
    await page.click('.tf-row .tf');
    return 'boolean';
  }
  if (await page.$('.field textarea')) {
    await page.type('.field textarea', 'Test answer for the self-graded flow.');
    if (selfGrade) {
      await clickText(page, 'Show model answer');
      await sleep(150);
      await clickText(page, 'Correct');
    }
    return 'short';
  }
  if (await page.$('.field input[type="number"]')) {
    await page.type('.field input[type="number"]', '28.27');
    return 'number';
  }
  if (await page.$('.field input')) {
    await page.type('.field input', 'test');
    return 'fill';
  }
  throw new Error('no answer control found');
}

async function openDeckByName(page, name, mode = 'Practice') {
  await go(page, '#/library');
  await page.waitForSelector('.deck-row', { timeout: 10_000 });
  const clicked = await page.evaluate((needle) => {
    const row = [...document.querySelectorAll('.deck-row')].find((node) =>
      (node.textContent ?? '').includes(needle),
    );
    const button = row?.querySelector('.btn');
    if (!button) return false;
    button.click();
    return true;
  }, name);
  if (!clicked) throw new Error(`deck "${name}" not found`);
  await page.waitForSelector('.mode-option', { timeout: 10_000 });
  await pickMode(page, mode);
  await page.waitForSelector('.qcard', { timeout: 10_000 });
}

async function pickMode(page, mode) {
  const picked = await page.evaluate((needle) => {
    const option = [...document.querySelectorAll('.mode-option')].find(
      (node) => !node.disabled && (node.textContent ?? '').includes(needle),
    );
    if (!option) return false;
    option.click();
    return true;
  }, mode);
  if (!picked) throw new Error(`mode "${mode}" not available`);
  await page.waitForSelector('.qcard', { timeout: 10_000 });
}

/** Walk the dot pager until the question type label matches. */
async function findQuestionByType(page, label) {
  const dots = await page.$$eval('.dots .dot', (nodes) => nodes.length);
  for (let index = 0; index < dots; index += 1) {
    await page.evaluate((i) => {
      document.querySelectorAll('.dots .dot')[i]?.click();
    }, index);
    await sleep(140);
    const meta = await textOf(page, '.qcard__meta');
    if (meta.includes(label)) return index;
  }
  return -1;
}

/** Walk the dot pager until the prompt contains a phrase. */
async function findQuestionByPrompt(page, needle) {
  const dots = await page.$$eval('.dots .dot', (nodes) => nodes.length);
  for (let index = 0; index < dots; index += 1) {
    await page.evaluate((i) => {
      document.querySelectorAll('.dots .dot')[i]?.click();
    }, index);
    await sleep(140);
    const prompt = await textOf(page, '.qcard__prompt');
    if (prompt.includes(needle)) return index;
  }
  return -1;
}

async function main() {
  await mkdir(shots, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CANDIDATES[0],
    headless: true,
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
    args: ['--no-first-run', '--hide-scrollbars', '--disable-features=Translate', '--lang=en-GB'],
  });

  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (allowBackendOffline && text.includes('Failed to load resource')) return;
    errors.push(`console: ${text}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (allowBackendOffline && response.url().includes('.supabase.co/')) return;
    errors.push(`http ${response.status()}: ${response.url()}`);
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForSelector('.landing', { timeout: 10_000 });
    const landingHeading = (await textOf(page, '.landing h1')).trim();
    const landingText = await textOf(page, '.landing');
    record(
      'Public homepage',
      landingHeading === 'MengYin Study' &&
        landingText.includes('revision and practice app') &&
        landingText.includes('Google Sign-In'),
      landingHeading,
    );
    await shot(page, '00-home.png');

    await go(page, '#/today');
    await page.waitForSelector('.page-head', { timeout: 10_000 });
    const heading = (await textOf(page, '.page-head h1')).trim();
    record('Today page', heading === 'Today', heading);
    await shot(page, '01-today.png');

    await go(page, '#/library');
    await page.waitForSelector('.deck-row', { timeout: 10_000 });
    const decks = await page.$$eval('.deck-row', (nodes) => nodes.length);
    record('Deck list', decks === 7, `${decks} decks`);
    const deckTitles = await page.$$eval('.deck-row__title', (nodes) => nodes.map((node) => node.textContent ?? ''));
    record(
      'Coding demo deck listed',
      deckTitles.some((title) => title.includes('Coding sandbox')),
      deckTitles.join(' / '),
    );
    await shot(page, '02-decks.png');

    // --- Practice flow -------------------------------------------------
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.deck-row')].find((node) =>
        (node.textContent ?? '').includes('Foundations'),
      );
      row?.querySelector('.btn')?.click();
    });
    await page.waitForSelector('.mode-option', { timeout: 10_000 });
    const modes = await page.$$eval('.mode-option', (nodes) => nodes.length);
    record('Mode picker opens', modes >= 5, `${modes} modes`);
    await shot(page, '03-modes.png');
    await pickMode(page, 'Practice');
    record('Session starts', true);
    await shot(page, '03b-practice.png');

    const preMarked = await page.evaluate(() => ({
      correct: document.querySelectorAll('.choice.is-correct, .tf.is-correct').length,
      selected: document.querySelectorAll('.choice.is-selected, .tf.is-selected').length,
      wrong: document.querySelectorAll('.choice.is-wrong, .tf.is-wrong').length,
    }));
    record(
      'Nothing marked before submitting',
      preMarked.correct === 0 && preMarked.selected === 0 && preMarked.wrong === 0,
      JSON.stringify(preMarked),
    );

    const kind = await answerCurrentQuestion(page);
    if (!(await page.$('.verdict'))) await clickText(page, 'Submit');
    await page.waitForSelector('.verdict', { timeout: 6_000 });
    const verdict = (await textOf(page, '.verdict__label')).trim();
    record('Answer graded', verdict.length > 0, `${kind} → ${verdict}`);
    await shot(page, '04-verdict.png');

    await clickText(page, 'Next');
    await sleep(200);
    await answerCurrentQuestion(page);
    if (!(await page.$('.verdict'))) await clickText(page, 'Submit');
    await page.waitForSelector('.verdict', { timeout: 6_000 });
    record('Second question', true);

    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 10_000 });
    const score = (await textOf(page, '.scoreline__value')).trim();
    record('Results page', score.length > 0, `score ${score}`);
    await shot(page, '05-results.png');

    // --- Statistics ----------------------------------------------------
    await go(page, '#/stats');
    await page.waitForSelector('.chart', { timeout: 10_000 });
    const today = (await textOf(page, '.metrics .metric:nth-child(4) .metric__value')).trim();
    record('Statistics page', today === '2', `today = ${today}`);
    await shot(page, '06-stats.png');

    // --- Plugins -------------------------------------------------------
    await go(page, '#/plugins');
    await page.waitForSelector('.plugin', { timeout: 10_000 });
    const plugins = await page.$$eval('.plugin', (nodes) => nodes.length);
    const issues = await page.$$eval('.issues__item', (nodes) => nodes.length);
    const types = await page.$$eval('.type-row code', (nodes) => nodes.map((node) => node.textContent));
    record('Plugins load cleanly', issues === 0, `${plugins} plugins, ${issues} issues`);
    record('Custom type registered', types.includes('numeric'), types.join(', '));
    await shot(page, '07-plugins.png');

    // --- Plugin importer (CSV) ----------------------------------------
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length < 2) throw new Error('file inputs not found');
    await fileInputs[1].uploadFile(path.join(root, 'plugins', 'demo-numeric', 'samples', 'flashcards.csv'));
    await page.waitForFunction(
      () => (document.querySelector('.toast')?.textContent ?? '').includes('Imported'),
      { timeout: 8_000 },
    );
    record('CSV importer', true, 'toast shows Imported');
    await go(page, '#/library');
    await page.waitForSelector('.deck-row', { timeout: 10_000 });
    const titles = await page.$$eval('.deck-row__title', (nodes) => nodes.map((node) => node.textContent ?? ''));
    record('Imported deck listed', titles.some((title) => title.includes('flashcards')), titles.join(' / '));
    await shot(page, '08-imported.png');

    // --- Custom numeric question type ----------------------------------
    await openDeckByName(page, 'Numeric answers');
    const numericKind = await answerCurrentQuestion(page);
    record('Custom type input', numericKind === 'number', numericKind);
    if (!(await page.$('.verdict'))) await clickText(page, 'Submit');
    await page.waitForSelector('.verdict', { timeout: 6_000 });
    const pairs = await textOf(page, '.pairs');
    record('Custom type grading', pairs.includes('±'), pairs.replace(/\s+/g, ' ').slice(0, 70));
    await shot(page, '09-custom-type.png');
    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 10_000 });

    // --- Exam: draft answers stay editable, dots hide correctness ------
    await openDeckByName(page, 'Systems', 'Exam');

    // Work from a multiple-choice question so the answer can be changed.
    let mcIndex = -1;
    const examDotCount = await page.$$eval('.dots .dot', (nodes) => nodes.length);
    for (let index = 0; index < examDotCount; index += 1) {
      await page.evaluate((i) => {
        document.querySelectorAll('.dots .dot')[i]?.click();
      }, index);
      await sleep(130);
      if ((await textOf(page, '.qcard__meta')).includes('Multiple choice')) {
        mcIndex = index;
        break;
      }
    }
    record('Exam multiple-choice found', mcIndex >= 0, `index ${mcIndex}`);

    const examBefore = (await textOf(page, '.session__meta')).trim();
    const examLabel = (await textOf(page, '.session__actions .btn')).trim();
    record('Exam button reads Next', examLabel.includes('Next'), examLabel);

    await answerCurrentQuestion(page, { selfGrade: false });
    await sleep(200);
    const answeredDots = await page.$$eval('.dot', (nodes) =>
      nodes.filter((node) => node.classList.contains('is-answered')).length,
    );
    record('Exam marks answered questions', answeredDots >= 1, `${answeredDots} answered dots`);

    await clickText(page, 'Next', '.session__actions .btn');
    await sleep(350);
    const examAfter = (await textOf(page, '.session__meta')).trim();
    record('Exam advances on Next', examBefore !== examAfter, `${examBefore} → ${examAfter}`);

    // Go back and change the answer: it must not be locked.
    await page.evaluate((i) => {
      document.querySelectorAll('.dots .dot')[i]?.click();
    }, mcIndex);
    await sleep(250);
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.choice-list .choice')];
      rows[1]?.click();
    });
    await sleep(250);
    const selectedIndex = await page.$$eval('.choice-list .choice', (nodes) =>
      nodes.findIndex((node) => node.classList.contains('is-selected')),
    );
    record('Exam answers stay editable', selectedIndex === 1, `selected index ${selectedIndex}`);

    const leaked = await page.$$eval('.dot', (nodes) =>
      nodes.filter((node) => node.classList.contains('is-ok') || node.classList.contains('is-bad')).length,
    );
    record('Exam dots hide correctness', leaked === 0, `${leaked} coloured dots`);

    await page.evaluate(() => {
      const dots = [...document.querySelectorAll('.dots .dot')];
      dots[dots.length - 1]?.click();
    });
    await sleep(250);
    const lastLabel = (await textOf(page, '.session__actions .btn')).trim();
    record('Last question reads Submit', lastLabel.includes('Submit'), lastLabel);
    await shot(page, '09b-exam.png');

    await clickText(page, 'Submit exam');
    await page.waitForSelector('.sheet', { timeout: 6_000 });
    await page.evaluate(() => {
      document.querySelector('.sheet__foot .btn--primary')?.click();
    });
    await page.waitForSelector('.scoreline', { timeout: 8_000 });
    record('Exam marked on submit', true);

    // --- Muscle memory: answer stays on screen for ~2 s ----------------
    await openDeckByName(page, 'Foundations', 'Muscle memory');
    const drillBefore = (await textOf(page, '.session__meta')).trim();
    await answerCurrentQuestion(page);
    if (!(await page.$('.verdict'))) await clickText(page, 'Submit');
    await page.waitForSelector('.verdict', { timeout: 6_000 });
    await shot(page, '09c-drill.png');
    const drillDuring = (await textOf(page, '.session__meta')).trim();
    await sleep(2600);
    const drillAfter = (await textOf(page, '.session__meta')).trim();
    record(
      'Muscle memory holds the answer, then advances',
      drillDuring === drillBefore && drillAfter !== drillBefore,
      `${drillBefore} → ${drillAfter}`,
    );
    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 10_000 });

    // --- Multi-select must identify itself and not shift on click ------
    await openDeckByName(page, 'Data structures and complexity', 'Practice');
    let foundMulti = false;
    const dotCount = await page.$$eval('.dots .dot', (nodes) => nodes.length);
    for (let index = 0; index < dotCount; index += 1) {
      await page.evaluate((i) => {
        document.querySelectorAll('.dots .dot')[i]?.click();
      }, index);
      await sleep(140);
      if ((await textOf(page, '.qcard__meta')).includes('Select all that apply')) {
        foundMulti = true;
        break;
      }
    }
    record('Multi-select question found', foundMulti, `${dotCount} questions scanned`);
    if (foundMulti) {
      const hint = (await textOf(page, '.choice-hint')).trim();
      const boxes = await page.$$eval('.choice__box', (nodes) => nodes.length);
      const options = await page.$$eval('.choice', (nodes) => nodes.length);
      record('Multi-select hint + checkboxes', hint.length > 0 && boxes === options, `${hint} · ${boxes}/${options}`);

      const before = await page.$$eval('.choice', (nodes) =>
        nodes.map((node) => +node.getBoundingClientRect().height.toFixed(2)),
      );
      await page.click('.choice-list .choice');
      await sleep(300);
      const after = await page.$$eval('.choice', (nodes) =>
        nodes.map((node) => +node.getBoundingClientRect().height.toFixed(2)),
      );
      record(
        'Selecting does not shift rows',
        JSON.stringify(before) === JSON.stringify(after),
        `${before.join(',')} → ${after.join(',')}`,
      );
      await shot(page, '09d-multi.png');
    }
    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 10_000 });

    // --- Images in prompts and in options ------------------------------
    await openDeckByName(page, 'Diagrams', 'Practice');
    const imageDots = await page.$$eval('.dots .dot', (nodes) => nodes.length);
    let promptImage = null;
    let optionImages = null;
    for (let index = 0; index < imageDots; index += 1) {
      await page.evaluate((i) => {
        document.querySelectorAll('.dots .dot')[i]?.click();
      }, index);
      await sleep(180);
      const info = await page.evaluate(() => {
        const media = [...document.querySelectorAll('.qcard__media img')];
        const options = [...document.querySelectorAll('.choice__media img')];
        const loaded = (nodes) => nodes.length > 0 && nodes.every((img) => img.complete && img.naturalWidth > 0);
        return {
          mediaCount: media.length,
          mediaOk: loaded(media),
          mediaSrc: media[0]?.getAttribute('src') ?? '',
          optionCount: options.length,
          optionOk: loaded(options),
        };
      });
      if (!promptImage && info.mediaCount > 0) {
        promptImage = info;
        await shot(page, '09f-prompt-image.png');
      }
      if (!optionImages && info.optionCount > 0) {
        optionImages = info;
        await shot(page, '09e-images.png');
      }
      if (promptImage && optionImages) break;
    }
    record(
      'Prompt image renders',
      !!promptImage && promptImage.mediaOk && promptImage.mediaSrc.includes('/plugins/visual-demo/'),
      promptImage ? `${promptImage.mediaCount} image · ${promptImage.mediaSrc}` : 'none found',
    );
    record(
      'Option images render',
      !!optionImages && optionImages.optionOk,
      optionImages ? `${optionImages.optionCount} images` : 'none found',
    );
    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 10_000 });

    // --- AI generation page and the authoring skill -------------------
    await go(page, '#/settings');
    await page.waitForSelector('.ai-form', { timeout: 10_000 });
    const aiInputs = await page.$$('.ai-form input');
    if (aiInputs.length < 3) throw new Error('AI settings inputs not found');
    await aiInputs[0].evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'https://example.test/v1');
    await aiInputs[2].evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'test-model');
    await clickText(page, 'Save AI settings');
    await sleep(300);

    await go(page, '#/generate');
    await page.waitForSelector('.dropzone', { timeout: 10_000 });
    const configPanel = await page.$('.gen-config');
    record('Generate page accepts AI settings', configPanel === null, configPanel ? 'config gate still shown' : 'configured');

    const chipCount = await page.$$eval('.type-chip', (nodes) => nodes.length);
    const selectedBefore = await page.$$eval('.type-chip.is-on', (nodes) => nodes.length);
    await page.evaluate(() => {
      document.querySelectorAll('.type-chip')[5]?.click();
    });
    await sleep(120);
    const selectedAfterOff = await page.$$eval('.type-chip.is-on', (nodes) => nodes.length);
    await page.evaluate(() => {
      document.querySelectorAll('.type-chip')[5]?.click();
    });
    await sleep(120);
    const selectedAfterOn = await page.$$eval('.type-chip.is-on', (nodes) => nodes.length);
    record(
      'Question type picker',
      chipCount === 6 && selectedBefore === 6 && selectedAfterOff === 5 && selectedAfterOn === 6,
      `${chipCount} chips · ${selectedBefore} → ${selectedAfterOff} → ${selectedAfterOn}`,
    );

    await clickText(page, 'View the authoring skill');
    await page.waitForSelector('.sheet .skill-text', { timeout: 6_000 });
    const skillText = await textOf(page, '.sheet .skill-text');
    record(
      'Authoring skill opens',
      skillText.includes('Non-negotiable rules') && skillText.includes('{{blank}}'),
      `${skillText.length} chars`,
    );
    await shot(page, '15-skill.png');
    await page.keyboard.press('Escape');
    await sleep(200);

    const materialInput = await page.$('input[type="file"]');
    if (!materialInput) throw new Error('material input not found');
    await materialInput.uploadFile(path.join(root, 'plugins', 'demo-numeric', 'samples', 'flashcards.csv'));
    await page.waitForSelector('.material', { timeout: 12_000 });
    record('Material ingested', true, (await textOf(page, '.material')).replace(/\s+/g, ' ').slice(0, 70));

    const pdfInput = await page.$('input[type="file"]');
    if (!pdfInput) throw new Error('PDF material input not found');
    await pdfInput.uploadFile(path.join(root, 'docs', 'samples', 'sample-lecture.pdf'));
    await page.waitForFunction(() => document.querySelectorAll('.material').length === 2, {
      timeout: 30_000,
    });
    const pdfMaterial = (await page.$$eval('.material', (nodes) =>
      nodes.map((node) => node.textContent ?? ''),
    )).find((text) => text.includes('sample-lecture.pdf'));
    record(
      'PDF text extracted',
      !!pdfMaterial && pdfMaterial.includes('chars'),
      (pdfMaterial ?? 'not found').replace(/\s+/g, ' ').slice(0, 80),
    );
    await shot(page, '16-generate.png');

    // Mock the provider so the whole generation path can run without a key.
    await page.evaluate(() => {
      const questions = [
        {
          type: 'single',
          prompt: 'Which data structure is last in, first out?',
          options: [
            { id: 'a', text: 'Queue' },
            { id: 'b', text: 'Stack' },
          ],
          answer: { kind: 'single', optionId: 'b' },
          explanation: 'A stack pushes and pops at the same end.',
          tags: ['Stacks'],
          difficulty: 1,
          source: 'flashcards.csv',
        },
        {
          type: 'boolean',
          prompt: 'A queue is first in, first out.',
          answer: { kind: 'boolean', value: true },
          explanation: 'The earliest item added is the first one removed.',
          tags: ['Queues'],
          difficulty: 1,
          source: 'flashcards.csv',
        },
      ];
      const original = window.fetch;
      window.fetch = async (url, init) => {
        if (String(url).includes('/chat/completions')) {
          window.__aiRequestBody = String(init?.body ?? '');
          return new Response(
            JSON.stringify({
              model: 'test-model',
              choices: [
                {
                  message: { content: JSON.stringify({ questions, warnings: [] }) },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return original(url, init);
      };
    });

    await page.click('.gen-grid .field input');
    await page.type('.gen-grid .field input', 'Stacks and queues');
    await page.$eval('.numfield input', (element) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, '2');
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickText(page, 'Generate questions');
    await page.waitForSelector('.gen-preview', { timeout: 20_000 });
    const generated = await page.$$eval('.gen-q', (nodes) => nodes.length);
    const aiPrompt = await page.evaluate(() => window.__aiRequestBody ?? '');
    record(
      'Generation returns validated questions',
      generated === 2 && aiPrompt.includes('Non-negotiable rules') && aiPrompt.includes('flashcards.csv'),
      `${generated} questions · ${aiPrompt.length} request chars`,
    );
    await page
      .waitForFunction(() => !document.querySelector('.toast'), { timeout: 6_000 })
      .catch(() => undefined);
    await shot(page, '19-preview.png');

    await clickText(page, 'Save as deck');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.deck-row__title')].some((node) =>
          (node.textContent ?? '').includes('Stacks and queues'),
        ),
      { timeout: 12_000 },
    );
    record('Generated deck saved to Decks', true, 'Stacks and queues');
    await shot(page, '20-generated-deck.png');

    // --- Code questions: run in practice, answer-only in exams --------
    await openDeckByName(page, 'Systems', 'Practice');
    const codeIndex = await findQuestionByType(page, 'Code');
    record('Code question renders', codeIndex >= 0, `dot ${codeIndex}`);

    await page.click('.code-input');
    await page.type('.code-input', '0');
    await page.click('.code-actions .btn');
    await page.waitForFunction(
      () => (document.querySelector('.code-actions .badge')?.textContent ?? '').includes('/'),
      { timeout: 15_000 },
    );
    const firstBadge = (await textOf(page, '.code-actions .badge')).trim();
    const leftoverFrames = await page.$$eval('iframe[sandbox]', (nodes) => nodes.length);
    record('Sandbox runs the snippet', firstBadge.includes('/') && leftoverFrames === 0, firstBadge);
    await shot(page, '17-code-run.png');

    await page.click('.code-input', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('.code-input', 'input.reduce((sum, n) => sum + n, 0)');
    // No explicit Run: submitting must execute the tests itself.
    await page.evaluate(() => {
      document.querySelector('.session__actions .btn')?.click();
    });
    await page.waitForSelector('.verdict', { timeout: 15_000 });
    await page.waitForFunction(
      () => (document.querySelector('.code-actions .badge')?.textContent ?? '').includes('2/2'),
      { timeout: 15_000 },
    );
    const codeVerdict = (await textOf(page, '.verdict__label')).trim();
    const codeBadge = (await textOf(page, '.code-actions .badge')).trim();
    record(
      'Code answer auto-runs on submit',
      codeVerdict === 'Correct' && codeBadge.includes('2/2'),
      `${codeVerdict} · ${codeBadge}`,
    );

    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 12_000 });

    // A learner script must not be able to forge stdout or a passing result.
    await openDeckByName(page, 'Systems', 'Practice');
    await findQuestionByType(page, 'Code');
    const forgeSnippet =
      "(self.postMessage({ type: 'output', text: String(input.reduce((a, b) => a + b, 0)) + '\\n' }), self.postMessage({ type: 'done', ok: true }), 0)";
    await page.$eval(
      '.code-input',
      (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      },
      forgeSnippet,
    );
    await page.click('.code-actions .btn');
    await page.waitForFunction(
      () => (document.querySelector('.code-actions .badge')?.textContent ?? '').includes('/'),
      { timeout: 15_000 },
    );
    const forgeBadge = (await textOf(page, '.code-actions .badge')).trim();
    record('Learner code cannot forge a pass', !forgeBadge.includes('2/2'), forgeBadge);
    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 12_000 });

    // --- Multiple named blanks and a whole function body -------------
    await openDeckByName(page, 'Coding sandbox', 'Practice');
    const multiIndex = await findQuestionByPrompt(page, 'six blanks');
    const multiLabels = await page.$$eval('.code-blank .field__label', (nodes) =>
      nodes.map((node) => (node.textContent ?? '').trim()),
    );
    record(
      'Six-blank code question renders',
      multiIndex >= 0 && multiLabels.length === 6,
      `${multiLabels.length} blanks: ${multiLabels.join(', ')}`,
    );

    const sixValues = {
      'outer init': 'let i = 0',
      'outer condition': 'i < input.rows',
      'outer step': 'i++',
      'inner init': 'let j = 0',
      'inner condition': 'j < input.cols',
      'inner step': 'j++',
    };
    for (const [label, value] of Object.entries(sixValues)) {
      await page.evaluate(
        (needle, textValue) => {
          const fields = [...document.querySelectorAll('.code-blank')];
          const field = fields.find(
            (node) => (node.querySelector('.field__label')?.textContent ?? '').trim() === needle,
          );
          const textarea = field?.querySelector('textarea');
          if (!textarea) throw new Error(`blank not found: ${needle}`);
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          setter?.call(textarea, textValue);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        },
        label,
        value,
      );
    }
    await sleep(150);
    await page.click('.code-actions .btn');
    await page.waitForFunction(
      () => (document.querySelector('.code-actions .badge')?.textContent ?? '').includes('3/3'),
      { timeout: 20_000 },
    );
    record('Six-blank code runs all tests', true, '3/3');
    await shot(page, '21-multi-code.png');

    const bodyIndex = await findQuestionByPrompt(page, 'entire body of main');
    await page.waitForSelector('.code-input--body', { timeout: 6_000 });
    const bodySolution =
      'const total = input.reduce((sum, n) => sum + n, 0);\nconsole.log(total);';
    await page.$eval(
      '.code-input--body',
      (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      },
      bodySolution,
    );
    await sleep(150);
    await page.click('.code-actions .btn');
    await page.waitForFunction(
      () => (document.querySelector('.code-actions .badge')?.textContent ?? '').includes('2/2'),
      { timeout: 20_000 },
    );
    record('Whole-body code runs all tests', bodyIndex >= 0, '2/2');
    await shot(page, '22-body-code.png');
    await clickText(page, 'End session');
    await page.waitForSelector('.scoreline', { timeout: 12_000 });

    await openDeckByName(page, 'Systems', 'Exam');
    const examCodeIndex = await findQuestionByType(page, 'Code');
    const examRunButtons = await page.$$eval('.code-actions .btn', (nodes) => nodes.length);
    const examNotice = (await textOf(page, '.notice--warn')).trim();
    await page.type('.code-input', '0');
    await sleep(300);
    const examRuns = await page.$$eval('.code-run', (nodes) => nodes.length);
    record(
      'Exam disables code execution',
      examCodeIndex >= 0 && examRunButtons === 0 && examNotice.length > 0 && examRuns === 0,
      `${examRunButtons} run buttons · "${examNotice.slice(0, 40)}"`,
    );
    await shot(page, '18-exam-code.png');
    await go(page, '#/library');

    // --- Account and auth ---------------------------------------------
    await go(page, '#/account');
    await page.waitForSelector('.auth-card', { timeout: 10_000 });
    const authHeading = (await textOf(page, '.auth-card h2')).trim();
    record('Account route redirects to sign-in', authHeading === 'Sign in', authHeading);
    const oauthButtons = await page.$$eval('.auth-oauth__btn', (nodes) => nodes.length);
    record('Auth offers Google and GitHub', oauthButtons === 2, `${oauthButtons} providers`);
    const signInInputs = await page.$$eval('.auth-form input', (nodes) => nodes.length);
    record('Sign-in form', signInInputs === 2, `${signInInputs} inputs`);
    await shot(page, '23-auth.png');

    await go(page, '#/register');
    await page.waitForSelector('.auth-card', { timeout: 10_000 });
    const registerInputs = await page.$$eval('.auth-form input', (nodes) => nodes.length);
    record('Registration form asks for name and email', registerInputs === 4, `${registerInputs} inputs`);

    await go(page, '#/forgot-password');
    await page.waitForSelector('.auth-card', { timeout: 10_000 });
    const forgotInputs = await page.$$eval('.auth-form input', (nodes) => nodes.length);
    record('Forgot-password form', forgotInputs === 1, `${forgotInputs} inputs`);

    await go(page, '#/library');
    await page.waitForSelector('.deck-row', { timeout: 10_000 });

    // --- Settings & languages -----------------------------------------
    await go(page, '#/settings');
    await page.waitForSelector('.seg', { timeout: 10_000 });
    await shot(page, '10-settings.png');
    record('Settings page', true);

    // The text-size control must visibly scale the interface, not just store a value.
    const labelSize = () =>
      page.$eval('.setting__label', (node) => parseFloat(getComputedStyle(node).fontSize));
    const sizeNormal = await labelSize();
    await clickText(page, 'Large', '.seg__btn');
    await sleep(260);
    const sizeLarge = await labelSize();
    await clickText(page, 'Compact', '.seg__btn');
    await sleep(260);
    const sizeCozy = await labelSize();
    await clickText(page, 'Standard', '.seg__btn');
    await sleep(260);
    const sizeRestored = await labelSize();
    record(
      'Text size scales the interface',
      sizeLarge > sizeNormal * 1.05 &&
        sizeCozy < sizeNormal * 0.95 &&
        Math.abs(sizeRestored - sizeNormal) < 0.05,
      `${sizeCozy} → ${sizeNormal} → ${sizeLarge} px (restored ${sizeRestored})`,
    );

    await clickText(page, '繁體中文', '.seg__btn');
    await sleep(300);
    await go(page, '#/today');
    await page.waitForSelector('.page-head', { timeout: 10_000 });
    const lang = await page.evaluate(() => document.documentElement.lang);
    const zhHeading = (await textOf(page, '.page-head h1')).trim();
    record('Chinese interface', lang.startsWith('zh') && zhHeading === '今日', `${lang} / ${zhHeading}`);
    await shot(page, '11-today-zh.png');

    await go(page, '#/settings');
    await page.waitForSelector('.seg', { timeout: 10_000 });
    await clickText(page, 'English', '.seg__btn');
    await clickText(page, 'Light', '.seg__btn');
    await sleep(300);
    await go(page, '#/today');
    await page.waitForSelector('.page-head', { timeout: 10_000 });
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    record('Light theme', theme === 'light', `data-theme=${theme}`);
    await shot(page, '12-today-light.png');

    await go(page, '#/library');
    await page.waitForSelector('.deck-row', { timeout: 10_000 });
    await shot(page, '13-decks-light.png');

    await go(page, '#/mistakes');
    await page.waitForSelector('.page-head', { timeout: 10_000 });
    await shot(page, '14-review.png');
    record('Review page', true);

    record('Page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (error) {
    record('Interrupted', false, error instanceof Error ? error.message : String(error));
    await page.screenshot({ path: path.join(shots, '99-error.png'), fullPage: true }).catch(() => undefined);
  } finally {
    await browser.close();
  }

  await writeFile(path.join(shots, 'report.json'), JSON.stringify({ results, errors }, null, 2), 'utf8');
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed, ${errors.length} page errors`);
  if (failed.length > 0 || errors.length > 0) process.exitCode = 1;
}

void main();
