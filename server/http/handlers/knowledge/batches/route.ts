import { z } from "zod";
import { ensureDatabase } from "../../../../../db/bootstrap";
import { requestOwner } from "../../../../../lib/server";
import { requestEducationScope } from "../../../../../lib/education-scope";
import { createClassificationBatch, listClassificationBatches } from "../../../../services/classification-batches";
export async function GET(request:Request){await ensureDatabase();return Response.json({batches:listClassificationBatches(requestOwner(request),requestEducationScope(request))});}
export async function POST(request:Request){
  const parsed=z.object({questionIds:z.array(z.string().min(1).max(100)).min(1).max(200),profileId:z.string().min(1).max(100).optional()}).strict().safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"请选择 1–200 道题目及可用模型"},{status:400});
  try{return Response.json({batch:await createClassificationBatch(requestOwner(request),requestEducationScope(request),parsed.data.questionIds,parsed.data.profileId)},{status:201});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"创建标注任务失败"},{status:400});}
}
