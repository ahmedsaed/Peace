ALTER TABLE `accounts` ADD `credit_limit` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `foreign_fee_bp` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `cash_fee_bp` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `statement_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `due_day` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `is_adjustment` integer DEFAULT false NOT NULL;