CREATE TABLE `variation_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`content_json` text NOT NULL,
	`review_json` text NOT NULL,
	`status` text DEFAULT 'awaiting_teacher' NOT NULL,
	`promoted_question_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `variation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promoted_question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variation_candidates_run_ordinal_idx` ON `variation_candidates` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `variation_candidates_run_status_idx` ON `variation_candidates` (`run_id`,`status`);--> statement-breakpoint
CREATE TABLE `variation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`source_question_id` text,
	`source_snapshot_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`quality_mode` text DEFAULT 'reviewed' NOT NULL,
	`requested_count` integer NOT NULL,
	`difficulty` text NOT NULL,
	`focus` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`generator_profile_id` text,
	`reviewer_profile_id` text,
	`status` text DEFAULT 'generating' NOT NULL,
	`result_json` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`source_question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variation_runs_owner_idempotency_idx` ON `variation_runs` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `variation_runs_owner_created_idx` ON `variation_runs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `variation_runs_source_idx` ON `variation_runs` (`source_question_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `questions` ADD `variation_review_status` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `variation_review_json` text;