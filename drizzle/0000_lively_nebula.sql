CREATE TABLE `engineering_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`relative_path` text NOT NULL,
	`modified_time` text NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `engineering_sync` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
