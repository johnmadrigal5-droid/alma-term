CREATE TABLE `tunnels` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`bind_host` text NOT NULL,
	`bind_port` integer NOT NULL,
	`target_host` text,
	`target_port` integer,
	`auto_start` integer DEFAULT false NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
