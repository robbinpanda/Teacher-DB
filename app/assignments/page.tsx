import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AssignmentList } from "../../components/AssignmentList";
import { getTeacherMode, listAssignments } from "../../lib/school-workflow";

export const metadata = { title: "作业批改 · 拣题" };

export default async function AssignmentsPage() {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  if (await getTeacherMode(ownerId) !== "school") redirect("/");
  return <AssignmentList initialAssignments={await listAssignments(ownerId)} />;
}
