import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AssignmentWorkspace, type AssignmentDetail } from "../../../components/AssignmentWorkspace";
import { getAssignmentDetail, getTeacherMode } from "../../../lib/school-workflow";

export const metadata = { title: "作业批改与学情 · 拣题" };

export default async function AssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  if (await getTeacherMode(ownerId) !== "school") redirect("/");
  const detail = await getAssignmentDetail(ownerId, (await params).assignmentId).catch(() => null);
  if (!detail) notFound();
  return <AssignmentWorkspace initialDetail={detail as unknown as AssignmentDetail} />;
}
