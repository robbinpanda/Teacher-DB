export type AnalyticsItem = { questionId: string; position: number; maxScore: number; tags: string[] };
export type AnalyticsSubmission = {
  studentId: string;
  studentName: string;
  status: string;
  scores: Record<string, number>;
};

export function calculateAssignmentAnalytics(items: AnalyticsItem[], submissions: AnalyticsSubmission[]) {
  const graded = submissions.filter((submission) => submission.status === "graded");
  const studentRows = graded.map((submission) => {
    const earned = items.reduce((sum, item) => sum + Math.min(item.maxScore, Math.max(0, submission.scores[item.questionId] ?? 0)), 0);
    const maximum = items.reduce((sum, item) => sum + item.maxScore, 0);
    return { studentId: submission.studentId, studentName: submission.studentName, earned, maximum, rate: maximum ? earned / maximum : 0 };
  }).sort((left, right) => right.earned - left.earned || left.studentName.localeCompare(right.studentName, "zh-CN"));
  const questionRows = items.map((item) => {
    const earned = graded.reduce((sum, submission) => sum + Math.min(item.maxScore, Math.max(0, submission.scores[item.questionId] ?? 0)), 0);
    const maximum = item.maxScore * graded.length;
    return { questionId: item.questionId, position: item.position, earned, maximum, rate: maximum ? earned / maximum : 0, tags: item.tags };
  });
  const tagAccumulator = new Map<string, { earned: number; maximum: number }>();
  questionRows.forEach((question) => question.tags.forEach((tag) => {
    const current = tagAccumulator.get(tag) ?? { earned: 0, maximum: 0 };
    current.earned += question.earned;
    current.maximum += question.maximum;
    tagAccumulator.set(tag, current);
  }));
  const tagRows = [...tagAccumulator].map(([tag, value]) => ({
    tag,
    ...value,
    rate: value.maximum ? value.earned / value.maximum : 0,
  })).sort((left, right) => left.rate - right.rate || left.tag.localeCompare(right.tag, "zh-CN"));
  const classMaximum = studentRows.reduce((sum, student) => sum + student.maximum, 0);
  const classEarned = studentRows.reduce((sum, student) => sum + student.earned, 0);
  return {
    gradedCount: graded.length,
    assignedCount: submissions.length,
    classAverageRate: classMaximum ? classEarned / classMaximum : 0,
    students: studentRows,
    questions: questionRows,
    tags: tagRows,
    weakQuestionIds: questionRows.filter((question) => question.rate < 0.7).map((question) => question.questionId),
  };
}
