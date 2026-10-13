import { test, expect } from '@playwright/test';

test('普通四个模型、Go 五个模型，切换地址并独立保存、重新编辑', async ({ page }) => {
  await page.goto('/settings/models');
  await page.getByRole('radio', { name: '设置OpenCode Go 套餐模型', exact: true }).check();
  const modelSelect = page.getByRole('combobox', { name: 'Model Name', exact: true });
  await expect(modelSelect.locator('option:not([disabled])')).toHaveText(['GPT 6 Luna', 'Claude Haiku 5.5', 'MiMo 2.6 Flash', 'DeepSeek 4.1 Flash', 'GLM 5.3 Flash']);
  await page.getByRole('combobox', { name: 'Model Name', exact: true }).selectOption('glm-5.3-flash');
  const preview = page.getByLabel('预设接口地址', { exact: true });
  await expect(preview).toContainText('Chat Completions');
  await expect(preview).toContainText('https://opencode.ai/inference/go/v1/chat/completions');
  await page.getByRole('radio', { name: '设置OpenCode 普通付费模型', exact: true }).check();
  await expect(preview).toContainText('Chat Completions');
  await expect(preview).toContainText('https://opencode.ai/inference/openai/v1/chat/completions');
  await expect(modelSelect.locator('option:not([disabled])')).toHaveText(['GPT 6 Luna', 'Claude Haiku 5.5', 'DeepSeek 4.1 Flash', 'GLM 5.3 Flash']);
  await page.getByRole('radio', { name: '设置OpenCode Go 套餐模型', exact: true }).check();
  await expect(modelSelect).toHaveValue('glm-5.3-flash');
  await modelSelect.selectOption('mimo-v2.6-flash');
  await page.getByRole('radio', { name: '设置OpenCode 普通付费模型', exact: true }).check();
  await expect(modelSelect).toHaveValue('');
  await page.getByRole('radio', { name: '设置OpenCode Go 套餐模型', exact: true }).check();
  await modelSelect.selectOption('mimo-v2.6-flash');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-go-browser-key');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  const card = page.locator('.model-profile-card').filter({ hasText: 'OpenCode Go 套餐 · mimo-v2.6-flash' });
  await expect(card).toContainText('https://opencode.ai/inference/go/v1');
  await page.reload();
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('radio', { name: '设置OpenCode Go 套餐模型', exact: true })).toBeChecked();
  await page.getByRole('combobox', { name: 'Model Name', exact: true }).selectOption('glm-5.3-flash');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(card).toContainText('Chat Completions');
  await expect(card).toContainText('glm-5.3-flash');
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(preview).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/opencode-go-model-settings.png', fullPage: true });
});

test('服务选择显示对应字段，OpenCode 只填模型名和 Key 即可保存并重新编辑', async ({ page }) => {
  await page.goto('/settings/models');
  await page.getByRole('radio', { name: '设置OpenCode 普通付费模型' }).check();
  await expect(page.getByLabel('API Base URL', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Model Name', exact: true }).selectOption('deepseek-v4.1-flash');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-browser-key');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('加密保存');
  const card = page.locator('.model-profile-card').filter({ hasText: 'OpenCode 普通付费 · deepseek-v4.1-flash' });
  await expect(card).toContainText('https://opencode.ai/inference/openai/v1');
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('radio', { name: '设置OpenCode 普通付费模型' })).toBeChecked();
  await page.getByRole('combobox', { name: 'Model Name', exact: true }).selectOption('glm-5.3-flash');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(card).toContainText('Chat Completions');
  await expect(card).toContainText('https://opencode.ai/inference/openai/v1');
  await page.getByRole('radio', { name: '设置自定义模型' }).check();
  await expect(page.getByLabel('API Base URL', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '设置OpenRouter模型' }).check();
  await expect(page.getByLabel('API Base URL', { exact: true })).toHaveCount(0);
  await page.getByLabel('Model Name', { exact: true }).fill('xiaomi/mimo-v2.6-flash');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-router-key');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.locator('.model-profile-card').filter({ hasText: 'OpenRouter · xiaomi/mimo-v2.6-flash' })).toContainText('https://openrouter.ai/api/v1');
  await page.getByRole('radio', { name: '设置OpenCode 普通付费模型' }).check();
  await page.screenshot({ path: 'tmp/opencode-model-settings.png', fullPage: true });
});

test('后端拒绝未知 OpenCode 模型，并保留自定义地址与协议', async ({ request }) => {
  const invalid = await request.post('/api/model-profiles', { data: { service: 'opencode', model: 'not-supported', apiKey: 'fixture' } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toContain('尚未适配');
  for (const service of ['opencode', 'opencode-go']) {
    const removed = await request.post('/api/model-profiles', { data: { service, model: 'kimi-k2.6', apiKey: 'fixture' } });
    expect(removed.status()).toBe(400);
  }
  const custom = await request.post('/api/model-profiles', { data: { service: 'custom', displayName: '自定义协议验证', model: 'fixture', apiKey: 'fixture', provider: 'anthropic-messages', baseUrl: 'https://custom.example/v1' } });
  expect(custom.status()).toBe(201);
  const { profile } = await custom.json();
  expect(profile.provider).toBe('anthropic-messages'); expect(profile.baseUrl).toBe('https://custom.example/v1');
  expect(profile.service).toBe('custom'); expect(profile.apiKeyCiphertext).toBeUndefined();
});
