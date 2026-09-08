import { sql } from "drizzle-orm";
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
  sourceTextbook: text("source_textbook"),
  sourceSchool: text("source_school"),
  checksum: text("checksum"),
  error: text("error"),
  sourceRemovedAt: text("source_removed_at"),
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
  errorCode: text("error_code"),
  nextAttemptAt: text("next_attempt_at"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
}, (table) => [
  index("runs_document_idx").on(table.documentId, table.createdAt),
  index("runs_queue_idx").on(table.status, table.nextAttemptAt),
  uniqueIndex("runs_idempotency_idx").on(table.idempotencyKey),
]);

export const questionFolders = sqliteTable("question_folders", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("question_folders_owner_parent_idx").on(table.ownerId, table.parentId),
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
  needsHumanReview: integer("needs_human_review", { mode: "boolean" }),
  confidence: real("confidence").notNull().default(0),
  score: integer("score").notNull().default(0),
  folderId: text("folder_id").references(() => questionFolders.id, { onDelete: "set null" }),
  parentQuestionId: text("parent_question_id"),
  parentExternalId: text("parent_external_id"),
  variationKind: text("variation_kind"),
  variationReviewStatus: text("variation_review_status"),
  variationReviewJson: text("variation_review_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("questions_document_page_idx").on(table.documentId, table.pageNumber),
  index("questions_type_status_idx").on(table.type, table.status),
  index("questions_folder_idx").on(table.folderId, table.updatedAt),
  index("questions_parent_idx").on(table.parentQuestionId),
  uniqueIndex("questions_document_number_idx").on(table.documentId, table.number),
]);

export const variationRuns = sqliteTable("variation_runs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  sourceQuestionId: text("source_question_id").references(() => questions.id, { onDelete: "set null" }),
  sourceSnapshotHash: text("source_snapshot_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  qualityMode: text("quality_mode").notNull().default("reviewed"),
  requestedCount: integer("requested_count").notNull(),
  difficulty: text("difficulty").notNull(),
  focus: text("focus").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  generatorProfileId: text("generator_profile_id"),
  reviewerProfileId: text("reviewer_profile_id"),
  status: text("status").notNull().default("generating"),
  resultJson: text("result_json"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("variation_runs_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
  index("variation_runs_owner_created_idx").on(table.ownerId, table.createdAt),
  index("variation_runs_source_idx").on(table.sourceQuestionId, table.createdAt),
]);

export const variationCandidates = sqliteTable("variation_candidates", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => variationRuns.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  contentJson: text("content_json").notNull(),
  reviewJson: text("review_json").notNull(),
  status: text("status").notNull().default("awaiting_teacher"),
  promotedQuestionId: text("promoted_question_id").references(() => questions.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("variation_candidates_run_ordinal_idx").on(table.runId, table.ordinal),
  index("variation_candidates_run_status_idx").on(table.runId, table.status),
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
  role: text("role").notNull().default("question"),
  label: text("label").notNull().default("题图"),
  sourceKey: text("source_key"),
  cropKey: text("crop_key"),
  bboxJson: text("bbox_json").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [index("assets_question_idx").on(table.questionId)]);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("tags_name_idx").on(table.name)]);

export const tagCatalog = sqliteTable("tag_catalog", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  subject: text("subject").notNull(),
  stage: text("stage").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("tag_catalog_scope_name_idx").on(table.ownerId, table.subject, table.stage, table.name),
  index("tag_catalog_scope_idx").on(table.ownerId, table.subject, table.stage),
]);

export const questionTags = sqliteTable("question_tags", {
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.questionId, table.tagId] }),
  index("question_tags_tag_idx").on(table.tagId),
]);

export const paperFolders = sqliteTable("paper_folders", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("paper_folders_owner_parent_idx").on(table.ownerId, table.parentId),
]);

export const papers = sqliteTable("papers", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  folderId: text("folder_id").references(() => paperFolders.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  settingsJson: text("settings_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("papers_owner_created_idx").on(table.ownerId, table.createdAt),
  index("papers_owner_folder_idx").on(table.ownerId, table.folderId, table.updatedAt),
]);

export const paperTemplates = sqliteTable("paper_templates", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  stage: text("stage").notNull(),
  kind: text("kind").notNull().default("custom"),
  description: text("description").notNull().default(""),
  configJson: text("config_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("paper_templates_owner_scope_idx").on(table.ownerId, table.subject, table.stage),
  uniqueIndex("paper_templates_owner_name_idx").on(table.ownerId, table.name),
]);

export const answerImports = sqliteTable("answer_imports", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  sourceName: text("source_name").notNull(),
  status: text("status").notNull().default("processing"),
  resultJson: text("result_json"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("answer_imports_document_idx").on(table.documentId, table.createdAt)]);

export const paperItems = sqliteTable("paper_items", {
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  score: integer("score").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.paperId, table.questionId] }),
  index("paper_items_position_idx").on(table.paperId, table.position),
]);

export const teachingClasses = sqliteTable("teaching_classes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  name: text("name").notNull(),
  grade: text("grade").notNull(),
  subject: text("subject").notNull().default("数学"),
  schoolYear: text("school_year").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("teaching_classes_owner_year_name_idx").on(table.ownerId, table.schoolYear, table.name),
  index("teaching_classes_owner_archived_idx").on(table.ownerId, table.archived, table.updatedAt),
]);

export const students = sqliteTable("students", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  studentNo: text("student_no").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("students_owner_number_idx").on(table.ownerId, table.studentNo),
  index("students_owner_name_idx").on(table.ownerId, table.name),
]);

export const classStudents = sqliteTable("class_students", {
  classId: text("class_id").notNull().references(() => teachingClasses.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "restrict" }),
  seatNumber: text("seat_number"),
  joinedAt: text("joined_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.classId, table.studentId] }),
  index("class_students_student_idx").on(table.studentId, table.classId),
]);

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  assignmentCode: text("assignment_code").notNull(),
  status: text("status").notNull().default("active"),
  dueAt: text("due_at"),
  totalScore: real("total_score").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("assignments_code_idx").on(table.assignmentCode),
  index("assignments_owner_status_idx").on(table.ownerId, table.status, table.updatedAt),
  index("assignments_paper_idx").on(table.paperId, table.createdAt),
]);

export const assignmentClasses = sqliteTable("assignment_classes", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  classId: text("class_id").notNull().references(() => teachingClasses.id, { onDelete: "restrict" }),
}, (table) => [
  primaryKey({ columns: [table.assignmentId, table.classId] }),
  index("assignment_classes_class_idx").on(table.classId, table.assignmentId),
]);

export const assignmentItems = sqliteTable("assignment_items", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  maxScore: real("max_score").notNull().default(0),
  snapshotJson: text("snapshot_json").notNull(),
}, (table) => [
  primaryKey({ columns: [table.assignmentId, table.questionId] }),
  uniqueIndex("assignment_items_position_idx").on(table.assignmentId, table.position),
]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  classId: text("class_id").notNull().references(() => teachingClasses.id, { onDelete: "restrict" }),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("assigned"),
  totalScore: real("total_score"),
  teacherComment: text("teacher_comment").notNull().default(""),
  submittedAt: text("submitted_at"),
  gradedAt: text("graded_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("submissions_assignment_class_student_idx").on(table.assignmentId, table.classId, table.studentId),
  index("submissions_assignment_status_idx").on(table.assignmentId, table.status, table.updatedAt),
  index("submissions_student_idx").on(table.studentId, table.updatedAt),
]);

export const submissionScores = sqliteTable("submission_scores", {
  submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  score: real("score").notNull().default(0),
  comment: text("comment").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.submissionId, table.questionId] }),
  index("submission_scores_question_idx").on(table.questionId, table.submissionId),
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
  inputPricePerMillion: real("input_price_per_million"),
  outputPricePerMillion: real("output_price_per_million"),
  cachedInputPricePerMillion: real("cache_price_per_million"),
  cachedOutputPricePerMillion: real("cached_output_price_per_million"),
  lastTestStatus: text("last_test_status"),
  lastTestMessage: text("last_test_message"),
  lastTestedAt: text("last_tested_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("model_profiles_owner_idx").on(table.ownerId, table.enabled),
  uniqueIndex("model_profiles_owner_name_idx").on(table.ownerId, table.displayName),
]);

export const bankImports = sqliteTable("bank_imports", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  sourceName: text("source_name").notNull(),
  packageId: text("package_id"),
  questionCount: integer("question_count").notNull().default(0),
  status: text("status").notNull().default("processing"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("bank_imports_owner_created_idx").on(table.ownerId, table.createdAt),
  uniqueIndex("bank_imports_active_package_idx")
    .on(table.ownerId, table.packageId)
    .where(sql`${table.status} IN ('processing', 'complete')`),
]);

export const modelUsageEvents = sqliteTable("model_usage_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("local-demo"),
  modelProfileId: text("model_profile_id"),
  documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
  pageNumber: integer("page_number"),
  pageCount: integer("page_count").notNull().default(1),
  purpose: text("purpose").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  cachedOutputTokens: integer("cached_output_tokens").notNull().default(0),
  inputPricePerMillion: real("input_price_per_million"),
  outputPricePerMillion: real("output_price_per_million"),
  cachedInputPricePerMillion: real("cache_price_per_million"),
  cachedOutputPricePerMillion: real("cached_output_price_per_million"),
  costCny: real("cost_cny"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("model_usage_owner_created_idx").on(table.ownerId, table.createdAt),
  index("model_usage_profile_created_idx").on(table.modelProfileId, table.createdAt),
  index("model_usage_document_idx").on(table.documentId),
]);

export const appSettings = sqliteTable("app_settings", {
  ownerId: text("owner_id").primaryKey(),
  teacherMode: text("teacher_mode").notNull().default("personal"),
  selectedModelProfileId: text("selected_model_profile_id"),
  extractionConcurrency: integer("extraction_concurrency").notNull().default(2),
  extractionPaused: integer("extraction_paused", { mode: "boolean" }).notNull().default(false),
  extractionPauseReason: text("extraction_pause_reason"),
  extractionPausedAt: text("extraction_paused_at"),
  extractionFailureStreak: integer("extraction_failure_streak").notNull().default(0),
  preferredRegion: text("preferred_region"),
  preferredTextbook: text("preferred_textbook"),
  preferredGradesJson: text("preferred_grades_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

export const documentJobs = sqliteTable("document_jobs", {
  documentId: text("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().default("local-demo"),
  profileId: text("profile_id"),
  status: text("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(0),
  attempt: integer("attempt").notNull().default(0),
  nextAttemptAt: text("next_attempt_at"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  lastError: text("last_error"),
  questionTotal: integer("question_total"),
  completedQuestionNumbersJson: text("completed_question_numbers_json").notNull().default("[]"),
  streamPhase: text("stream_phase").notNull().default("queued"),
  lastStreamEventAt: text("last_stream_event_at"),
  streamMessage: text("stream_message"),
  queuedAt: text("queued_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("document_jobs_queue_idx").on(table.status, table.nextAttemptAt, table.queuedAt),
  index("document_jobs_owner_idx").on(table.ownerId, table.status),
]);
