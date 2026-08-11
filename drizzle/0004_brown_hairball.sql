ALTER TABLE `app_settings` ADD `extraction_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `extraction_pause_reason` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `extraction_paused_at` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `extraction_failure_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT INTO `app_settings`
  (`owner_id`, `extraction_paused`, `extraction_pause_reason`, `extraction_paused_at`, `extraction_failure_streak`, `updated_at`)
SELECT `owner_id`, 1,
  '检测到多份试卷同时处于退避状态，已暂停全部识别。请检查网络或模型 API 后点击“全部开始”。',
  datetime('now'), 3, datetime('now')
FROM `document_jobs` WHERE `status` = 'retry_wait'
GROUP BY `owner_id` HAVING COUNT(*) >= 3
ON CONFLICT(`owner_id`) DO UPDATE SET
  `extraction_paused` = 1,
  `extraction_pause_reason` = excluded.`extraction_pause_reason`,
  `extraction_paused_at` = excluded.`extraction_paused_at`,
  `extraction_failure_streak` = MAX(`app_settings`.`extraction_failure_streak`, 3),
  `updated_at` = excluded.`updated_at`;--> statement-breakpoint
UPDATE `document_jobs` SET `status` = 'paused', `next_attempt_at` = NULL,
  `lease_owner` = NULL, `lease_expires_at` = NULL, `finished_at` = NULL,
  `updated_at` = datetime('now')
WHERE `status` IN ('queued', 'retry_wait', 'failed') AND `owner_id` IN (
  SELECT `owner_id` FROM `app_settings` WHERE `extraction_paused` = 1
);--> statement-breakpoint
UPDATE `extraction_runs` SET `status` = 'paused', `next_attempt_at` = NULL,
  `lease_owner` = NULL, `lease_expires_at` = NULL, `finished_at` = NULL
WHERE `status` <> 'complete' AND `status` <> 'running' AND `document_id` IN (
  SELECT `document_id` FROM `document_jobs` WHERE `status` = 'paused'
);
