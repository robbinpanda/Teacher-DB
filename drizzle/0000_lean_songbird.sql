CREATE TABLE `question_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`page_id` text,
	`kind` text NOT NULL,
	`label` text DEFAULT '题图' NOT NULL,
	`source_key` text,
	`crop_key` text,
	`bbox_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assets_question_idx` ON `question_assets` (`question_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`original_key` text,
	`status` text DEFAULT 'uploading' NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`subject` text,
	`grade` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `documents_owner_created_idx` ON `documents` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `documents_status_idx` ON `documents` (`status`);--> statement-breakpoint
CREATE TABLE `extraction_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`raw_json` text,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_document_idx` ON `extraction_runs` (`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`storage_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_document_number_idx` ON `pages` (`document_id`,`page_number`);--> statement-breakpoint
CREATE TABLE `paper_items` (
	`paper_id` text NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`paper_id`, `question_id`),
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `paper_items_position_idx` ON `paper_items` (`paper_id`,`position`);--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `papers_owner_created_idx` ON `papers` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `question_tags` (
	`question_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`question_id`, `tag_id`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_tags_tag_idx` ON `question_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`number` text NOT NULL,
	`type` text NOT NULL,
	`stem` text NOT NULL,
	`options_json` text,
	`answer` text DEFAULT '' NOT NULL,
	`analysis` text DEFAULT '' NOT NULL,
	`page_number` integer NOT NULL,
	`bbox_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_document_page_idx` ON `questions` (`document_id`,`page_number`);--> statement-breakpoint
CREATE INDEX `questions_type_status_idx` ON `questions` (`type`,`status`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_idx` ON `tags` (`name`);