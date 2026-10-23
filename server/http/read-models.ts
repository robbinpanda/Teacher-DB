import { getAuthoringDocument } from "../services/authoring-output";
import { requestEducationScope } from "../../lib/education-scope";
import { z } from "zod";
import * as questions from "../../lib/question-repository";
import * as school from "../../lib/school-workflow";
import { getPaperLibrary } from "../../lib/paper-library";
import { getPaperTemplates } from "../../lib/paper-template-repository";
import { verifyPaperExportToken } from "../../lib/paper-export-token";
import { requestOwner } from "../../lib/server";
import { result, toResponse } from "../core/result";

const querySchema = z.object({
  resource: z.enum(["document-page", "documents", "bank", "review", "approved-questions", "paper", "uploaded-paper", "paper-library", "paper-templates", "teacher-mode", "classes", "class", "assignments", "assignment", "paper-print", "authoring-document", "authoring-print"]),
  id: z.string().min(1).max(100).optional(),
  token: z.string().max(2000).optional(),
  ids: z.array(z.string().min(1).max(100)).max(2000).optional(),
  subject: z.string().max(60).optional(),
  stage: z.enum(["primary", "middle", "high"]).optional(),
}).strict();

export async function readModel(request: Request) {
  const payload = querySchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return toResponse(result({ error: "页面数据请求格式无效" }, { status: 400 }));
  const query = payload.data;
  const ownerId = requestOwner(request);
  const idResources = ["review", "paper", "uploaded-paper", "class", "assignment", "paper-print", "authoring-document", "authoring-print"];
  if (idResources.includes(query.resource) && !query.id) return toResponse(result({ error: "缺少资源编号" }, { status: 400 }));
  const scope = requestEducationScope(request);
  let data: unknown;
  switch (query.resource) {
    case "document-page": data = await questions.getDocumentPage(ownerId, { scope }); break;
    case "documents": data = (await questions.getDocumentPage(ownerId, { scope })).documents; break;
    case "bank": data = await questions.getBankData(ownerId, scope); break;
    case "review": data = await questions.getReviewData(query.id!, ownerId); break;
    case "approved-questions": data = await questions.getApprovedQuestions(ownerId, query.ids, scope); break;
    case "paper": data = await questions.getPaperData(query.id!, ownerId); break;
    case "uploaded-paper": data = await questions.getUploadedPaperData(query.id!, ownerId); break;
    case "paper-library": data = await getPaperLibrary(ownerId, scope); break;
    case "paper-templates": data = await getPaperTemplates(ownerId, query.subject, query.stage); break;
    case "teacher-mode": data = await school.getTeacherMode(ownerId); break;
    case "classes": data = await school.listTeachingClasses(ownerId); break;
    case "class": data = await school.getTeachingClass(ownerId, query.id!); break;
    case "assignments": data = await school.listAssignments(ownerId); break;
    case "assignment": data = await school.getAssignmentDetail(ownerId, query.id!); break;
    case "authoring-document": data = await getAuthoringDocument(ownerId, query.id!, query.subject && query.stage ? { subject: query.subject, stage: query.stage } : scope); break;
    case "authoring-print": {
      const claims = verifyPaperExportToken(query.token, `authoring:${query.id!}`);
      if (!claims) return toResponse(result({ error: "打印授权无效或已过期" }, { status: 404 }));
      try { data = await getAuthoringDocument(claims.ownerId, query.id!, undefined, true); }
      catch (error) { return toResponse(result({ error: error instanceof Error ? error.message : "作品尚不能导出" }, { status: 409 })); }
      break;
    }
    case "paper-print": {
      const claims = verifyPaperExportToken(query.token, query.id!);
      if (!claims) return toResponse(result({ error: "打印授权无效或已过期" }, { status: 404 }));
      data = await questions.getPaperPrintData(query.id!, claims.ownerId);
      break;
    }
  }
  return Response.json({ data }, { headers: { "cache-control": "no-store" } });
}
