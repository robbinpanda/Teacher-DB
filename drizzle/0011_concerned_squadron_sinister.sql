CREATE TABLE `assignment_classes` (
	`assignment_id` text NOT NULL,
	`class_id` text NOT NULL,
	PRIMARY KEY(`assignment_id`, `class_id`),
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `teaching_classes`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `assignment_classes_class_idx` ON `assignment_classes` (`class_id`,`assignment_id`);--> statement-breakpoint
CREATE TABLE `assignment_items` (
	`assignment_id` text NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`max_score` real DEFAULT 0 NOT NULL,
	`snapshot_json` text NOT NULL,
	PRIMARY KEY(`assignment_id`, `question_id`),
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_items_position_idx` ON `assignment_items` (`assignment_id`,`position`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`paper_id` text NOT NULL,
	`title` text NOT NULL,
	`assignment_code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`due_at` text,
	`total_score` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_code_idx` ON `assignments` (`assignment_code`);--> statement-breakpoint
CREATE INDEX `assignments_owner_status_idx` ON `assignments` (`owner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `assignments_paper_idx` ON `assignments` (`paper_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `class_students` (
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`seat_number` text,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`class_id`, `student_id`),
	FOREIGN KEY (`class_id`) REFERENCES `teaching_classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `class_students_student_idx` ON `class_students` (`student_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`student_no` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_owner_number_idx` ON `students` (`owner_id`,`student_no`);--> statement-breakpoint
CREATE INDEX `students_owner_name_idx` ON `students` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `submission_scores` (
	`submission_id` text NOT NULL,
	`question_id` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`submission_id`, `question_id`),
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `submission_scores_question_idx` ON `submission_scores` (`question_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text DEFAULT 'assigned' NOT NULL,
	`total_score` real,
	`teacher_comment` text DEFAULT '' NOT NULL,
	`submitted_at` text,
	`graded_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `teaching_classes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_assignment_class_student_idx` ON `submissions` (`assignment_id`,`class_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `submissions_assignment_status_idx` ON `submissions` (`assignment_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `submissions_student_idx` ON `submissions` (`student_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `teaching_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'local-demo' NOT NULL,
	`name` text NOT NULL,
	`grade` text NOT NULL,
	`subject` text DEFAULT '数学' NOT NULL,
	`school_year` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teaching_classes_owner_year_name_idx` ON `teaching_classes` (`owner_id`,`school_year`,`name`);--> statement-breakpoint
CREATE INDEX `teaching_classes_owner_archived_idx` ON `teaching_classes` (`owner_id`,`archived`,`updated_at`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `teacher_mode` text DEFAULT 'personal' NOT NULL;