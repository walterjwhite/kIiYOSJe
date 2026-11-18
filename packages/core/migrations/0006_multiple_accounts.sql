ALTER TABLE `signals` ADD `account` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `account` text;--> statement-breakpoint
CREATE INDEX `signals_account_idx` ON `signals` (`account`);
