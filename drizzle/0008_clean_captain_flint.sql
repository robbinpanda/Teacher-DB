CREATE TABLE `bank_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`source_name` text NOT NULL,
	`package_id` text,
	`question_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bank_imports_owner_created_idx` ON `bank_imports` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `question_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `question_folders_owner_parent_idx` ON `question_folders` (`owner_id`,`parent_id`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `preferred_region` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `preferred_textbook` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `preferred_grades_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `question_assets` ADD `role` text DEFAULT 'question' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `question_total` integer;--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `completed_question_numbers_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `stream_phase` text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `last_stream_event_at` text;--> statement-breakpoint
ALTER TABLE `document_jobs` ADD `stream_message` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_textbook` text;--> statement-breakpoint
ALTER TABLE `model_usage_events` ADD `page_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `folder_id` text REFERENCES question_folders(id);--> statement-breakpoint
ALTER TABLE `questions` ADD `parent_question_id` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `variation_kind` text;--> statement-breakpoint
CREATE INDEX `questions_folder_idx` ON `questions` (`folder_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `questions_parent_idx` ON `questions` (`parent_question_id`);