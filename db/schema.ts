import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  originalKey: text("original_key"),
  status: text("status").notNull().default("uploading"),
  pageCount: integer("page_count").notNull().default(0),
  subject: text("subject"),
  grade: text("grade"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("documents_owner_created_idx").on(table.ownerId, table.createdAt),
  index("documents_status_idx").on(table.status),
]);

export const pages = sqliteTable("pages", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  storageKey: text("storage_key").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("pages_document_number_idx").on(table.documentId, table.pageNumber),
]);

export const extractionRuns = sqliteTable("extraction_runs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  rawJson: text("raw_json"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("runs_document_idx").on(table.documentId, table.createdAt)]);

export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  type: text("type").notNull(),
  stem: text("stem").notNull(),
  optionsJson: text("options_json"),
  answer: text("answer").notNull().default(""),
  analysis: text("analysis").notNull().default(""),
  pageNumber: integer("page_number").notNull(),
  bboxJson: text("bbox_json").notNull(),
  status: text("status").notNull().default("pending"),
  confidence: real("confidence").notNull().default(0),
  score: integer("score").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("questions_document_page_idx").on(table.documentId, table.pageNumber),
  index("questions_type_status_idx").on(table.type, table.status),
]);

export const assets = sqliteTable("question_assets", {
  id: text("id").primaryKey(),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  label: text("label").notNull().default("题图"),
  sourceKey: text("source_key"),
  cropKey: text("crop_key"),
  bboxJson: text("bbox_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("assets_question_idx").on(table.questionId)]);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("tags_name_idx").on(table.name)]);

export const questionTags = sqliteTable("question_tags", {
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.questionId, table.tagId] }),
  index("question_tags_tag_idx").on(table.tagId),
]);

export const papers = sqliteTable("papers", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  settingsJson: text("settings_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("papers_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const paperItems = sqliteTable("paper_items", {
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  score: integer("score").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.paperId, table.questionId] }),
  index("paper_items_position_idx").on(table.paperId, table.position),
]);

