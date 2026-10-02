CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`status` text NOT NULL,
	`provider` text,
	`payload` text NOT NULL,
	`result` text,
	`error` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`updated` integer NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`data` text NOT NULL,
	`updated` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
