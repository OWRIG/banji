CREATE TABLE `exam_awards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_id` integer NOT NULL,
	`compare_exam_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`subject` text NOT NULL,
	`gain` real NOT NULL,
	`by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compare_exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_awards_unique_idx` ON `exam_awards` (`exam_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `exam_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exam_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`subject` text NOT NULL,
	`score` real,
	`status` text,
	`class_rank` integer,
	`school_rank` integer,
	`note` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_scores_unique_idx` ON `exam_scores` (`exam_id`,`student_id`,`subject`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`type` text DEFAULT 'unit' NOT NULL,
	`title` text NOT NULL,
	`date` text,
	`subjects` text NOT NULL,
	`paper_group` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exams_class_idx` ON `exams` (`class_id`);