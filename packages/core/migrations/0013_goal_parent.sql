ALTER TABLE `thoughts` ADD `parent_id` text REFERENCES thoughts(id);
