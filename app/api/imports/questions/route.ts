import { getSqlite, sqliteTransaction } from "../../../../db";
import { ensureDatabase } from "../../../../db/bootstrap";
import { deleteFile, putFile } from "../../../../lib/file-storage";
import { validateImportedImage } from "../../../../lib/imported-image";
import { MAX_PACKAGE_BYTES, readQuestionPackage } from "../../../../lib/question-package";
import { now, requestOwner } from "../../../../lib/server";
import { readFormDataPayload } from "../../../../lib/request-payload";

export const runtime = "nodejs";

function cleanFolderName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "共享题库";
}

function extension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function POST(request: Request) {
  await ensureDatabase();
  const ownerId = requestOwner(request);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PACKAGE_BYTES + 1024 * 1024) {
    return Response.json({ error: "共享包不能超过 50 MB" }, { status: 413 });
  }
  let importId = "";
  const storedKeys: string[] = [];
  try {
    const parsed = await readFormDataPayload(request);
    if (!parsed.ok) return parsed.response;
    const form = parsed.value;
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择 .jianti 共享包" }, { status: 400 });
    if (file.size > MAX_PACKAGE_BYTES) return Response.json({ error: "共享包不能超过 50 MB" }, { status: 413 });
    if (!file.name.toLowerCase().endsWith(".jianti")) return Response.json({ error: "仅支持拣题导出的 .jianti 文件" }, { status: 400 });
    const questionPackage = readQuestionPackage(new Uint8Array(await file.arrayBuffer()));
    const timestamp = now();
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    getSqlite().prepare(
      `UPDATE bank_imports SET status = 'failed', error = '上次导入意外中断，可安全重试', updated_at = ?
        WHERE owner_id = ? AND package_id = ? AND status = 'processing' AND updated_at < ?`,
    ).run(timestamp, ownerId, questionPackage.packageId, staleBefore);
    const duplicate = getSqlite().prepare(
      "SELECT id, status FROM bank_imports WHERE owner_id = ? AND package_id = ? AND status IN ('processing', 'complete')",
    ).get(ownerId, questionPackage.packageId);
    if (duplicate) return Response.json({ error: "这个共享包正在导入或已经导入过，为避免重复题目，本次未再次导入" }, { status: 409 });

    importId = crypto.randomUUID();
    getSqlite().prepare(
      `INSERT INTO bank_imports (id, owner_id, source_name, package_id, question_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'processing', ?, ?)`,
    ).run(importId, ownerId, file.name.slice(0, 180), questionPackage.packageId, timestamp, timestamp);

    const questionIds = new Map(questionPackage.questions.map((question) => [question.externalId, crypto.randomUUID()]));
    const assetRecords = new Map<string, Array<{ id: string; key: string; asset: (typeof questionPackage.questions)[number]["assets"][number] }>>();
    for (const question of questionPackage.questions) {
      const id = questionIds.get(question.externalId)!;
      const records = [];
      for (const asset of question.assets) {
        const assetId = crypto.randomUUID();
        const key = `imports/${importId}/${id}/${assetId}.${extension(asset.mimeType)}`;
        const bytes = Buffer.from(asset.data, "base64");
        await validateImportedImage(bytes, asset.mimeType);
        await putFile(key, bytes);
        storedKeys.push(key);
        records.push({ id: assetId, key, asset });
      }
      assetRecords.set(question.externalId, records);
    }

    const documentIds = new Map<string, string>();
    for (const question of questionPackage.questions) {
      if (!documentIds.has(question.source.documentKey)) documentIds.set(question.source.documentKey, crypto.randomUUID());
    }

    const outcome = sqliteTransaction((sqlite) => {
      let rootName = `导入 · ${cleanFolderName(questionPackage.title)}`.slice(0, 80);
      const existingNames = new Set((sqlite.prepare(
        "SELECT name FROM question_folders WHERE owner_id = ? AND parent_id IS NULL",
      ).all(ownerId) as Array<{ name: string }>).map((row) => row.name.toLocaleLowerCase("zh-CN")));
      if (existingNames.has(rootName.toLocaleLowerCase("zh-CN"))) {
        rootName = `${rootName.slice(0, 65)} · ${timestamp.slice(0, 10)}`;
      }
      const rootId = crypto.randomUUID();
      sqlite.prepare(
        "INSERT INTO question_folders (id, owner_id, parent_id, name, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)",
      ).run(rootId, ownerId, rootName, timestamp, timestamp);
      const folderIds = new Map<string, string>();
      for (const question of questionPackage.questions) {
        let parentId = rootId;
        let pathKey = "";
        for (const rawPart of question.folderPath) {
          const part = cleanFolderName(rawPart);
          pathKey += `/${part}`;
          const known = folderIds.get(pathKey);
          if (known) { parentId = known; continue; }
          const id = crypto.randomUUID();
          sqlite.prepare(
            "INSERT INTO question_folders (id, owner_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(id, ownerId, parentId, part, timestamp, timestamp);
          folderIds.set(pathKey, id);
          parentId = id;
        }
      }

      for (const [sourceKey, documentId] of documentIds) {
        const question = questionPackage.questions.find((item) => item.source.documentKey === sourceKey)!;
        sqlite.prepare(
          `INSERT INTO documents
            (id, owner_id, name, mime_type, status, page_count, subject, grade, source_year, source_exam_type,
             source_region, source_textbook, source_school, source_removed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'application/x-jianti-import', 'complete', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          documentId, ownerId, question.source.documentName, question.source.subject, question.source.grade,
          question.source.year, question.source.examType, question.source.region, question.source.textbook,
          question.source.school, timestamp, timestamp, timestamp,
        );
      }

      for (const question of questionPackage.questions) {
        const id = questionIds.get(question.externalId)!;
        const pathKey = question.folderPath.map(cleanFolderName).map((part) => `/${part}`).join("");
        const folderId = pathKey ? folderIds.get(pathKey)! : rootId;
        sqlite.prepare(
          `INSERT INTO questions
            (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json,
             status, needs_human_review, confidence, score, folder_id, parent_question_id, parent_external_id, variation_kind,
             variation_review_status, variation_review_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'approved', 0, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, documentIds.get(question.source.documentKey), question.number, question.type, question.stem,
          JSON.stringify(question.options), question.answer, question.analysis,
          JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }), folderId,
          null,
          question.parentExternalId,
          question.variationKind, question.variationReview?.status ?? null,
          question.variationReview ? JSON.stringify(question.variationReview) : null, timestamp, timestamp,
        );
        for (const tag of question.tags) {
          sqlite.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(crypto.randomUUID(), tag, timestamp);
          sqlite.prepare("INSERT OR IGNORE INTO question_tags (question_id, tag_id) SELECT ?, id FROM tags WHERE name = ?").run(id, tag);
        }
        for (const [position, record] of (assetRecords.get(question.externalId) ?? []).entries()) {
          sqlite.prepare(
            `INSERT INTO question_assets
              (id, question_id, page_id, kind, role, label, source_key, crop_key, bbox_json, position, created_at)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            record.id, id, record.asset.kind, record.asset.role, record.asset.label, record.key, record.key,
            JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }), position, timestamp,
          );
        }
      }
      for (const question of questionPackage.questions) {
        const parentQuestionId = question.parentExternalId ? questionIds.get(question.parentExternalId) : undefined;
        if (!parentQuestionId) continue;
        sqlite.prepare("UPDATE questions SET parent_question_id = ? WHERE id = ?")
          .run(parentQuestionId, questionIds.get(question.externalId));
      }
      sqlite.prepare(
        "UPDATE bank_imports SET question_count = ?, status = 'complete', updated_at = ? WHERE id = ? AND owner_id = ?",
      ).run(questionPackage.questions.length, timestamp, importId, ownerId);
      return { rootFolderId: rootId, rootFolderName: rootName };
    });
    return Response.json({
      imported: questionPackage.questions.length,
      packageTitle: questionPackage.title,
      rootFolderId: outcome.rootFolderId,
      rootFolderName: outcome.rootFolderName,
    }, { status: 201 });
  } catch (error) {
    await Promise.allSettled(storedKeys.map((key) => deleteFile(key)));
    if (importId) {
      getSqlite().prepare(
        "UPDATE bank_imports SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      ).run((error instanceof Error ? error.message : "导入失败").slice(0, 1000), now(), importId, ownerId);
    }
    const message = error instanceof Error ? error.message : "题库共享包导入失败";
    const duplicate = /bank_imports_active_package_idx|UNIQUE constraint failed: bank_imports\.owner_id, bank_imports\.package_id/i.test(message);
    return Response.json({
      error: duplicate ? "这个共享包正在导入或已经导入过，为避免重复题目，本次未再次导入" : message,
    }, { status: duplicate ? 409 : 400 });
  }
}
