import { z } from "zod";
import { ensureDatabase } from "../../../../../../db/bootstrap";
import { requestOwner } from "../../../../../../lib/server";
import { requestEducationScope } from "../../../../../../lib/education-scope";
import { classificationSchema } from "../../../../../../lib/question-classification";
import { readClassificationBatch,controlClassificationBatch,confirmClassificationBatch } from "../../../../../services/classification-batches";
type Context={params:Promise<{batchId:string}>};
export async function GET(request:Request,context:Context){
  await ensureDatabase();const batch=readClassificationBatch(requestOwner(request),requestEducationScope(request),(await context.params).batchId);
  return batch?Response.json({batch}):Response.json({error:"标注任务不存在"},{status:404});
}
export async function POST(request:Request,context:Context){
  await ensureDatabase();
  const data=z.union([z.object({action:z.enum(["pause","resume","retry"]),revision:z.number().int().positive()}).strict(),
    z.object({action:z.literal("confirm"),items:z.array(z.object({questionId:z.string().max(100),fingerprint:z.string().max(100),classification:classificationSchema})).min(1).max(200)}).strict()]).safeParse(await request.json().catch(()=>null));
  if(!data.success)return Response.json({error:"标注操作格式无效"},{status:400});
  const owner=requestOwner(request),scope=requestEducationScope(request),id=(await context.params).batchId;
  try {return Response.json({batch:data.data.action==='confirm'?confirmClassificationBatch(owner,scope,id,data.data.items):controlClassificationBatch(owner,scope,id,data.data.revision,data.data.action)});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"标注操作失败"},{status:409});}
}
