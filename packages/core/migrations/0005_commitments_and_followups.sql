ALTER TABLE `thoughts` ADD `commitment` text;--> statement-breakpoint
ALTER TABLE `thoughts` ADD `disputed_reason` text;--> statement-breakpoint
ALTER TABLE `thoughts` ADD `awaiting_reply_at` text;--> statement-breakpoint
ALTER TABLE `signals` ADD `awaiting_reply_at` text;--> statement-breakpoint
ALTER TABLE `signals` ADD `reply_received_at` text;--> statement-breakpoint
CREATE INDEX `signals_thread_id_idx` ON `signals` (`thread_id`);
