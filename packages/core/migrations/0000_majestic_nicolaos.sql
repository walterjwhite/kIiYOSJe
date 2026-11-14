CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`thought_id` text,
	`signal_id` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`adapter` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`thought_id`) REFERENCES `thoughts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signal_id`) REFERENCES `signals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `directions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_value` text NOT NULL,
	`posture` text NOT NULL,
	`standard` text NOT NULL,
	`autonomy` text DEFAULT 'observe' NOT NULL,
	`confidence_min` real DEFAULT 0.7 NOT NULL,
	`guards` text,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text DEFAULT (datetime('now')) NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`adapter` text NOT NULL,
	`external_id` text NOT NULL,
	`thread_id` text,
	`sender` text NOT NULL,
	`recipients` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`received_at` text NOT NULL,
	`urgency_hint` real,
	`disposition` text DEFAULT 'new' NOT NULL,
	`thought_id` text,
	`direction_id` text,
	`dedupe_key` text NOT NULL,
	FOREIGN KEY (`thought_id`) REFERENCES `thoughts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signals_dedupe_key_idx` ON `signals` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `thoughts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'seedling' NOT NULL,
	`direction_id` text,
	`next_action` text,
	`review_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON UPDATE no action ON DELETE no action
);
