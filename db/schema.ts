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
  sourceYear: integer("source_year"),
  sourceExamType: text("source_exam_type"),
  sourceRegion: text("source_region"),
  sourceSchool: text("source_school"),
  checksum: text("checksum"),
  error: text("error"),
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
  status: text("status").notNull().default("ready"),
  checksum: text("checksum"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("pages_document_number_idx").on(table.documentId, table.pageNumber),
]);

export const extractionRuns = sqliteTable("extraction_runs", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
  pageNumber: integer("page_number"),
  modelProfileId: text("model_profile_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull(),
  attempt: integer("attempt").notNull().default(1),
  idempotencyKey: text("idempotency_key"),
  rawJson: text("raw_json"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [
  index("runs_document_idx").on(table.documentId, table.createdAt),
  uniqueIndex("runs_idempotency_idx").on(table.idempotencyKey),
]);

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

export const questionRegions = sqliteTable("question_regions", {
  id: text("id").primaryKey(),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
  pageNumber: integer("page_number").notNull(),
  bboxJson: text("bbox_json").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("question_regions_question_page_idx").on(table.questionId, table.pageNumber),
  index("question_regions_page_idx").on(table.pageId),
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

export const modelProfiles = sqliteTable("model_profiles", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  displayName: text("display_name").notNull(),
  provider: text("provider").notNull().default("openai-compatible"),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyIv: text("api_key_iv"),
  apiKeyMask: text("api_key_mask"),
  isManaged: integer("is_managed", { mode: "boolean" }).notNull().default(false),
  isMultimodal: integer("is_multimodal", { mode: "boolean" }).notNull().default(true),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  timeoutMs: integer("timeout_ms").notNull().default(90000),
  lastTestStatus: text("last_test_status"),
  lastTestMessage: text("last_test_message"),
  lastTestedAt: text("last_tested_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("model_profiles_owner_idx").on(table.ownerId, table.enabled),
  uniqueIndex("model_profiles_owner_name_idx").on(table.ownerId, table.displayName),
]);

export const appSettings = sqliteTable("app_settings", {
  ownerId: text("owner_id").primaryKey(),
  selectedModelProfileId: text("selected_model_profile_id"),
  updatedAt: text("updated_at").notNull(),
});
