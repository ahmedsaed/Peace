ALTER TABLE `transactions` ADD `reverses_id` text;--> statement-breakpoint
CREATE INDEX `idx_tx_reverses` ON `transactions` (`reverses_id`);