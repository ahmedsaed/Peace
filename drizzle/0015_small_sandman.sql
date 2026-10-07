CREATE TABLE `chat_messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`content` text,
	`meta` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
