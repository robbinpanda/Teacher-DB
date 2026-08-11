CREATE TABLE `model_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`model_profile_id` text,
	`document_id` text,
	`page_number` integer,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`input_price_per_million` real,
	`output_price_per_million` real,
	`cache_price_per_million` real,
	`cost_usd` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `model_usage_owner_created_idx` ON `model_usage_events` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `model_usage_profile_created_idx` ON `model_usage_events` (`model_profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `model_usage_document_idx` ON `model_usage_events` (`document_id`);--> statement-breakpoint
ALTER TABLE `model_profiles` ADD `input_price_per_million` real;--> statement-breakpoint
ALTER TABLE `model_profiles` ADD `output_price_per_million` real;--> statement-breakpoint
ALTER TABLE `model_profiles` ADD `cache_price_per_million` real;