ALTER TABLE `model_profiles` ADD `cached_output_price_per_million` real;--> statement-breakpoint
ALTER TABLE `model_usage_events` ADD `cached_output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `model_usage_events` ADD `cached_output_price_per_million` real;