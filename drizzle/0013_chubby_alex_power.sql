CREATE TABLE `teaching_skill_trials` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content_snapshot` text NOT NULL,
	`recognition_json` text NOT NULL,
	`review_json` text NOT NULL,
	`human_verdict` text DEFAULT 'pending' NOT NULL,
	`human_notes` text DEFAULT '' NOT NULL,
	`model_name` text NOT NULL,
	`reviewer_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `teaching_skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `teaching_skill_trials_skill_idx` ON `teaching_skill_trials` (`skill_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `teaching_skill_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`document_id` text NOT NULL,
	`run_id` text NOT NULL,
	`skill_id` text,
	`revision` integer,
	`content_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `teaching_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject` text NOT NULL,
	`grade` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`sample_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `teaching_skills_owner_scope_idx` ON `teaching_skills` (`owner_id`,`subject`,`grade`);--> statement-breakpoint
CREATE UNIQUE INDEX `teaching_skills_active_idx` ON `teaching_skills` (`owner_id`,`subject`,`grade`) WHERE "teaching_skills"."active" = 1;--> statement-breakpoint
ALTER TABLE `questions` ADD `missing_images_json` text DEFAULT '[]' NOT NULL;