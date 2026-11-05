CREATE TABLE `check_expectations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`check_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `checks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `check_expectations_unique_idx` ON `check_expectations` (`check_id`,`student_id`);--> statement-breakpoint
ALTER TABLE `checks` ADD `missing_deadline` text;