import "server-only";
import { remapAnalysisImages } from "./analysis-images";

import { gzipSync } from "node:zlib";
import { getSqlite } from "../db";
import { getFile } from "./file-storage";
import {
  MAX_PACKAGE_ASSETS,
  MAX_PACKAGE_BYTES,
  sha256,
  type QuestionPackage,
  type SharedQuestion,
  type SharedQuestionAsset,
} from "./question-package-format";
import type { QuestionWithSource } from "./types";

export {
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_ASSETS,
  QUESTION_PACKAGE_MIME,
  readQuestionPackage,
  type QuestionPackage,
  type SharedQuestion,
  type SharedQuestionAsset,
} from "./question-package-format";

function folderPath(ownerId: string, folderId: string | null | undefined) {
  const sqlite = getSqlite();
  const names: string[] = [];
  const visited = new Set<string>();
  let current = folderId ?? null;
  while (current && names.length < 8 && !visited.has(current)) {
    visited.add(current);
    const row = sqlite.prepare(
      "SELECT parent_id AS parentId, name FROM question_folders WHERE id = ? AND owner_id = ?",
    ).get(current, ownerId) as { parentId: string | null; name: string } | undefined;
    if (!row) break;
    names.unshift(row.name);
    current = row.parentId;
  }
  return names;
}

function assetMime(key: string) {
  const extension = key.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png" as const;
  if (extension === "webp") return "image/webp" as const;
  return "image/jpeg" as const;
}

export async function createQuestionPackage(ownerId: string, questions: QuestionWithSource[], title = "共享题库") {
  if (!questions.length) throw new Error("没有可导出的题目");
  if (questions.length > 1000) throw new Error("单个共享包最多包含 1000 道题");
  let assetBytes = 0;
  let assetCount = 0;
  const shared: SharedQuestion[] = [];
  for (const question of questions) {
    const assets: SharedQuestionAsset[] = [];
    for (const asset of question.assets) {
      if (!asset.cropKey) continue;
      assetCount += 1;
      if (assetCount > MAX_PACKAGE_ASSETS) throw new Error(`单个共享包最多包含 ${MAX_PACKAGE_ASSETS} 张图片`);
      const bytes = await getFile(asset.cropKey);
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error(`题目 ${question.number} 的单张图片超过 8 MB`);
      assetBytes += bytes.byteLength;
      if (assetBytes > 80 * 1024 * 1024) throw new Error("共享包内图片总量不能超过 80 MB");
      assets.push({
        kind: asset.kind,
        role: asset.role,
        label: asset.label.slice(0, 80),
        mimeType: assetMime(asset.cropKey),
        data: bytes.toString("base64"),
        sha256: sha256(bytes),
      });
    }
    shared.push({
      externalId: question.id,
      parentExternalId: question.parentQuestionId ?? question.parentExternalId ?? null,
      variationKind: question.variationKind ?? null,
      variationReview: question.variationReview ?? null,
      folderPath: folderPath(ownerId, question.folderId),
      number: question.number,
      type: question.type,
      stem: question.stem,
      options: question.options ?? [],
      answer: question.answer,
      analysis: remapAnalysisImages(question.analysis, question.assets, question.assets.filter(asset => asset.cropKey)),
      tags: question.tags,
      source: {
        documentKey: question.source.documentId,
        documentName: question.source.documentName,
        subject: question.source.subject,
        grade: question.source.grade,
        year: question.source.year ?? null,
        examType: question.source.examType ?? null,
        region: question.source.region ?? null,
        textbook: question.source.textbook ?? null,
        school: question.source.school ?? null,
      },
      assets,
    });
  }
  const value: QuestionPackage = {
    format: "jianti-question-bank",
    schemaVersion: 1,
    packageId: crypto.randomUUID(),
    title: title.trim().slice(0, 80) || "共享题库",
    exportedAt: new Date().toISOString(),
    questionCount: shared.length,
    questions: shared,
  };
  const encoded = gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 });
  if (encoded.byteLength > MAX_PACKAGE_BYTES) throw new Error("共享包压缩后超过 50 MB，请减少题目后分批导出");
  return { bytes: encoded, value };
}
