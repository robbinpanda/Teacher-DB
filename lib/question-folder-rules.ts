export const MAX_QUESTION_FOLDER_DEPTH = 8;

export function assertQuestionFolderMoveDepth(ancestorDepth: number, subtreeDepth: number) {
  if (!Number.isInteger(ancestorDepth) || ancestorDepth < 0 || !Number.isInteger(subtreeDepth) || subtreeDepth < 1) {
    throw new Error("文件夹层级数据无效");
  }
  if (ancestorDepth + subtreeDepth > MAX_QUESTION_FOLDER_DEPTH) {
    throw new Error(`移动后文件夹将超过 ${MAX_QUESTION_FOLDER_DEPTH} 层，请先调整子文件夹结构`);
  }
}
