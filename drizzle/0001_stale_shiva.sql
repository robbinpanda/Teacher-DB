CREATE TABLE `app_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`selected_model_profile_id` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`display_name` text NOT NULL,
	`provider` text DEFAULT 'openai-compatible' NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`api_key_ciphertext` text,
	`api_key_iv` text,
	`api_key_mask` text,
	`is_managed` integer DEFAULT false NOT NULL,
	`is_multimodal` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`timeout_ms` integer DEFAULT 90000 NOT NULL,
	`last_test_status` text,
	`last_test_message` text,
	`last_tested_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_profiles_owner_idx` ON `model_profiles` (`owner_id`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `model_profiles_owner_name_idx` ON `model_profiles` (`owner_id`,`display_name`);--> statement-breakpoint
ALTER TABLE `documents` ADD `source_year` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_exam_type` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_region` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_school` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `checksum` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `error` text;--> statement-breakpoint
ALTER TABLE `extraction_runs` ADD `page_id` text REFERENCES pages(id);--> statement-breakpoint
ALTER TABLE `extraction_runs` ADD `page_number` integer;--> statement-breakpoint
ALTER TABLE `extraction_runs` ADD `model_profile_id` text;--> statement-breakpoint
ALTER TABLE `extraction_runs` ADD `attempt` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `extraction_runs` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `extraction_runs` ADD `finished_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_idempotency_idx` ON `extraction_runs` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `pages` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `checksum` text;