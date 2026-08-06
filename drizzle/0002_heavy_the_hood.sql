CREATE TABLE `answer_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`document_id` text NOT NULL,
	`source_name` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`result_json` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `answer_imports_document_idx` ON `answer_imports` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `paper_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`stage` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paper_templates_owner_scope_idx` ON `paper_templates` (`owner_id`,`subject`,`stage`);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_templates_owner_name_idx` ON `paper_templates` (`owner_id`,`name`);
--> statement-breakpoint
CREATE TABLE `tag_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`subject` text NOT NULL,
	`stage` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_catalog_scope_name_idx` ON `tag_catalog` (`owner_id`,`subject`,`stage`,`name`);
--> statement-breakpoint
CREATE INDEX `tag_catalog_scope_idx` ON `tag_catalog` (`owner_id`,`subject`,`stage`);
