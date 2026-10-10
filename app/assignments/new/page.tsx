import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AssignmentCreator } from "../../../components/AssignmentCreator";
import { getPaperLibrary } from "../../../lib/backend-data";
import { getTeacherMode, listTeachingClasses } from "../../../lib/backend-data";

export const metadata = { title: "布置作业 · 拣题" };

export default async function NewAssignmentPage({ searchParams }: { searchParams: Promise<{ paper?: string }> }) {
  const query = await searchParams;
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  if (await getTeacherMode(ownerId) !== "school") redirect("/");
  const [classes, library] = await Promise.all([listTeachingClasses(ownerId), getPaperLibrary(ownerId)]);
  return <AssignmentCreator classes={classes.filter((item) => !item.archived)} papers={library.papers} initialPaperId={query.paper ?? null} />;
}
