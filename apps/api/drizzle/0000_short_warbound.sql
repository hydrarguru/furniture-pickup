CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label_sv` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_label_sv_unique` ON `categories` (`label_sv`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_email_unique` ON `employees` (`email`);--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`item_id` text,
	`s3_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `images_s3_key_unique` ON `images` (`s3_key`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`title` text NOT NULL,
	`category_id` integer,
	`description` text,
	`condition` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pending_uploads` (
	`s3_key` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL,
	`ip_hash` text
);
--> statement-breakpoint
CREATE TABLE `request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`employee_id` text,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'unverified' NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`street` text NOT NULL,
	`postcode` text NOT NULL,
	`city` text NOT NULL,
	`access_notes` text,
	`has_elevator` integer,
	`floor` integer,
	`message` text,
	`consent_at` text NOT NULL,
	`verified_at` text,
	`seen_at` text,
	`token_hash` text NOT NULL,
	`token_expires` text NOT NULL,
	`code_hash` text,
	`confirmed_start` text,
	`confirmed_end` text,
	`staff_message` text,
	`assigned_to` text,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`assigned_to`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "requests_status_check" CHECK("requests"."status" IN ('unverified','new','in_progress','accepted','declined','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_requests_status_created` ON `requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_requests_closed_at` ON `requests` (`closed_at`) WHERE "requests"."closed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_requests_token_hash` ON `requests` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `time_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`date` text NOT NULL,
	`part` text NOT NULL,
	`from_time` text,
	`to_time` text,
	`note` text,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
