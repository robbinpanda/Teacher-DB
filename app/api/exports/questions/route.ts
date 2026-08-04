import { getApprovedQuestions } from "../../../../lib/question-repository";
import { requestOwner } from "../../../../lib/server";

export const runtime = "nodejs";

function sourceLabel(question: Awaited<ReturnType<typeof getApprovedQuestions>>[number]) {
  return [question.source.year, question.source.region, question.source.school, question.source.examType]
    .filter(Boolean)
    .join(" · ") || question.source.documentName;
}

function toMarkdown(questions: Awaited<ReturnType<typeof getApprovedQuestions>>) {
  const sections = questions.map((question, index) => {
    const options = question.options?.map((option) => `- ${option.key}. ${option.content}`).join("\n") ?? "";
    const assets = question.assets.map((asset) => asset.url ? `![${asset.label}](${asset.url})` : "").filter(Boolean).join("\n");
    return [
      `## ${index + 1}. ${question.stem}`,
      "",
      `- 题型：${question.type}`,
      `- 来源：${sourceLabel(question)}`,
      `- 标签：${question.tags.join("、") || "无"}`,
      options ? `\n${options}` : "",
      assets ? `\n${assets}` : "",
      "",
      `**答案：** ${question.answer || "未填写"}`,
      "",
      `**解析：** ${question.analysis || "未填写"}`,
    ].filter((line) => line !== "").join("\n");
  });
  return `# 题库导出\n\n共 ${questions.length} 道题。公式保留 LaTeX 源码。\n\n${sections.join("\n\n---\n\n")}\n`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  if (!new Set(["json", "markdown"]).has(format)) {
    return Response.json({ error: "format 仅支持 json 或 markdown" }, { status: 400 });
  }
  const ids = (url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 500);
  const questions = await getApprovedQuestions(requestOwner(request), ids.length ? ids : undefined);
  const filename = `question-bank-${new Date().toISOString().slice(0, 10)}`;
  if (format === "markdown") {
    return new Response(toMarkdown(questions), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }
  return new Response(JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), count: questions.length, questions }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.json"`,
    },
  });
}
