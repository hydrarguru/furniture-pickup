CREATE TABLE `request_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_request_links_request` ON `request_links` (`request_id`);