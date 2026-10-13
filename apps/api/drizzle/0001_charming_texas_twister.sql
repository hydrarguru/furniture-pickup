CREATE INDEX `idx_requests_email_created` ON `requests` (`email`,`created_at`);--> statement-breakpoint
ALTER TABLE `requests` DROP COLUMN `code_hash`;