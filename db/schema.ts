import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const engineeringNotes = sqliteTable("engineering_notes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  relativePath: text("relative_path").notNull(),
  modifiedTime: text("modified_time").notNull(),
  content: text("content").notNull(),
});

export const engineeringSync = sqliteTable("engineering_sync", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
