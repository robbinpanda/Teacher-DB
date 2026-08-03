CREATE TABLE `question_regions` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`page_id` text,
	`page_number` integer NOT NULL,
	`bbox_json` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_regions_question_page_idx` ON `question_regions` (`question_id`,`page_number`);--> statement-breakpoint
CREATE INDEX `question_regions_page_idx` ON `question_regions` (`page_id`);
