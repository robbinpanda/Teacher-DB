import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ClassManager } from "../../components/ClassManager";
import { getTeacherMode, getTeachingClass, listTeachingClasses } from "../../lib/backend-data";

export const metadata = { title: "班级学生 · 拣题" };

export default async function ClassesPage() {
  const requestHeaders = await headers();
  const ownerId = requestHeaders.get("oai-authenticated-user-id") ?? "local-demo";
  if (await getTeacherMode(ownerId) !== "school") redirect("/");
  const classes = await listTeachingClasses(ownerId);
  const firstClass = classes.find((item) => !item.archived);
  const initialDetail = firstClass ? await getTeachingClass(ownerId, firstClass.id) : null;
  return <ClassManager initialClasses={classes} initialDetail={initialDetail} />;
}
