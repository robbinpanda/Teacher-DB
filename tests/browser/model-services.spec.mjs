import { test, expect } from '@playwright/test';

test('服务选择显示对应字段，OpenCode 只填模型名和 Key 即可保存并重新编辑', async ({ page }) => {
  await page.goto('/settings/models');
  await page.getByRole('radio', { name: '设置OpenCode模型' }).check();
  await expect(page.getByLabel('API Base URL', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toHaveCount(0);
  await page.getByLabel('Model Name', { exact: true }).fill('kimi-k2.6');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-browser-key');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('加密保存');
  const card = page.locator('.model-profile-card').filter({ hasText: 'OpenCode · kimi-k2.6' });
  await expect(card).toContainText('https://opencode.ai/inference/openai/v1');
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('radio', { name: '设置OpenCode模型' })).toBeChecked();
  await page.getByLabel('Model Name', { exact: true }).fill('qwen3.8-flash');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(card).toContainText('Anthropic Messages');
  await expect(card).toContainText('https://opencode.ai/inference/anthropic/v1');
  await page.getByRole('radio', { name: '设置自定义模型' }).check();
  await expect(page.getByLabel('API Base URL', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '设置OpenRouter模型' }).check();
  await expect(page.getByLabel('API Base URL', { exact: true })).toHaveCount(0);
  await page.getByLabel('Model Name', { exact: true }).fill('xiaomi/mimo-v2.6-flash');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-router-key');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await expect(page.locator('.model-profile-card').filter({ hasText: 'OpenRouter · xiaomi/mimo-v2.6-flash' })).toContainText('https://openrouter.ai/api/v1');
  await page.getByRole('radio', { name: '设置OpenCode模型' }).check();
  await page.screenshot({ path: 'tmp/opencode-model-settings.png', fullPage: true });
});

test('后端拒绝未知 OpenCode 模型，并保留自定义地址与协议', async ({ request }) => {
  const invalid = await request.post('/api/model-profiles', { data: { service: 'opencode', model: 'not-supported', apiKey: 'fixture' } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toContain('尚未适配');
  const custom = await request.post('/api/model-profiles', { data: { service: 'custom', displayName: '自定义协议验证', model: 'fixture', apiKey: 'fixture', provider: 'anthropic-messages', baseUrl: 'https://custom.example/v1' } });
  expect(custom.status()).toBe(201);
  const { profile } = await custom.json();
  expect(profile.provider).toBe('anthropic-messages'); expect(profile.baseUrl).toBe('https://custom.example/v1');
  expect(profile.service).toBe('custom'); expect(profile.apiKeyCiphertext).toBeUndefined();
});
