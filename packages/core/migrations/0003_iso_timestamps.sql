PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`thought_id` text,
	`signal_id` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`adapter` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`thought_id`) REFERENCES `thoughts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signal_id`) REFERENCES `signals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_actions`("id", "thought_id", "signal_id", "kind", "payload", "status", "adapter", "created_at", "sent_at") SELECT "id", "thought_id", "signal_id", "kind", "payload", "status", "adapter", CASE WHEN length("created_at") = 19 AND "created_at" NOT LIKE '%Z' THEN replace("created_at", ' ', 'T') || '.000Z' ELSE "created_at" END, "sent_at" FROM `actions`;--> statement-breakpoint
DROP TABLE `actions`;--> statement-breakpoint
ALTER TABLE `__new_actions` RENAME TO `actions`;--> statement-breakpoint
CREATE TABLE `__new_directions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_value` text NOT NULL,
	`posture` text NOT NULL,
	`standard` text NOT NULL,
	`autonomy` text DEFAULT 'observe' NOT NULL,
	`confidence_min` real DEFAULT 0.7 NOT NULL,
	`guards` text,
	`match_prompt` text,
	`response_prompt` text,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_directions`("id", "name", "scope_kind", "scope_value", "posture", "standard", "autonomy", "confidence_min", "guards", "match_prompt", "response_prompt", "enabled", "version", "created_at", "updated_at") SELECT "id", "name", "scope_kind", "scope_value", "posture", "standard", "autonomy", "confidence_min", "guards", "match_prompt", "response_prompt", "enabled", "version", CASE WHEN length("created_at") = 19 AND "created_at" NOT LIKE '%Z' THEN replace("created_at", ' ', 'T') || '.000Z' ELSE "created_at" END, CASE WHEN length("updated_at") = 19 AND "updated_at" NOT LIKE '%Z' THEN replace("updated_at", ' ', 'T') || '.000Z' ELSE "updated_at" END FROM `directions`;--> statement-breakpoint
DROP TABLE `directions`;--> statement-breakpoint
ALTER TABLE `__new_directions` RENAME TO `directions`;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "at", "actor", "kind", "payload") SELECT "id", CASE WHEN length("at") = 19 AND "at" NOT LIKE '%Z' THEN replace("at", ' ', 'T') || '.000Z' ELSE "at" END, "actor", "kind", "payload" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
CREATE TABLE `__new_thoughts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'seedling' NOT NULL,
	`direction_id` text,
	`next_action` text,
	`review_at` text,
	`escalate_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`direction_id`) REFERENCES `directions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_thoughts`("id", "title", "body", "state", "direction_id", "next_action", "review_at", "escalate_by", "created_at", "updated_at") SELECT "id", "title", "body", "state", "direction_id", "next_action", "review_at", "escalate_by", CASE WHEN length("created_at") = 19 AND "created_at" NOT LIKE '%Z' THEN replace("created_at", ' ', 'T') || '.000Z' ELSE "created_at" END, CASE WHEN length("updated_at") = 19 AND "updated_at" NOT LIKE '%Z' THEN replace("updated_at", ' ', 'T') || '.000Z' ELSE "updated_at" END FROM `thoughts`;--> statement-breakpoint
DROP TABLE `thoughts`;--> statement-breakpoint
ALTER TABLE `__new_thoughts` RENAME TO `thoughts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
