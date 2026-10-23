export type MeasuredPaperBlock = {
  sectionId: string;
  contentHeight: number;
  headingHeight: number;
  answer: boolean;
  minimumBlank: number;
  /** A single narrow image row also provides writing space to its right. */
  sideAnswerHeight?: number;
};

export type PaperPageItem = { index: number; heading: boolean; blank: number; continuation?: boolean };
export type PaperPageLayout = { header: boolean; columns: PaperPageItem[][]; answers?: PaperPageItem[] };

/** All dimensions are CSS pixels measured at the actual paper width, after fonts/images load. */
export function paginatePaper(blocks: MeasuredPaperBlock[], pageHeight: number, headerHeight: number, gap: number, columnCount = 1) {
  const pages: PaperPageLayout[] = [];
  let answerPage = blocks[0]?.answer ?? false;
  let page: PaperPageLayout = { header: true, columns: Array.from({ length: answerPage ? 1 : columnCount }, () => []) };
  pages.push(page);
  let column = 0;
  let used = headerHeight;
  let columnHeights = page.columns.map(() => headerHeight);
  let previousSection = "";
  const newPage = (answer: boolean) => {
    answerPage = answer;
    page = { header: false, columns: Array.from({ length: answer ? 1 : columnCount }, () => []) };
    pages.push(page);
    column = 0;
    used = 0;
    columnHeights = page.columns.map(() => 0);
    previousSection = "";
  };
  const advance = (answer: boolean) => {
    if (!answer && answer === answerPage && column + 1 < page.columns.length) {
      column += 1;
      used = page.header ? headerHeight : 0;
      previousSection = "";
    } else newPage(answer);
  };
  const currentItems = () => page.answers ?? page.columns[column];
  blocks.forEach((block, index) => {
    if (block.answer !== answerPage) {
      if (block.answer) {
        // Reuse the remaining full-width space below the tallest objective column.
        used = Math.max(...columnHeights);
        if (page.columns.length > 1) page.answers = [];
        answerPage = true;
        previousSection = "";
      } else newPage(false);
    }
    let heading = previousSection !== block.sectionId;
    const size = () => {
      const headingHeight = heading ? block.headingHeight : 0;
      const sideAnswerHeight = Math.min(block.contentHeight, Math.max(0, block.sideAnswerHeight ?? 0));
      // Do not count the same image row as both full-width question content and
      // required blank space. Keep its physical height so the next question cannot overlap it.
      // Each answer question occupies at least half a page. Long prompts also
      // receive an equally tall writing area, including usable space beside a narrow image.
      const blank = block.answer ? Math.max(0, block.contentHeight - 2 * sideAnswerHeight,
        block.minimumBlank, pageHeight / 2 - headingHeight - block.contentHeight) : 0;
      return { blank, height: headingHeight + block.contentHeight + blank + (block.answer ? 0 : gap) };
    };
    let dimensions = size();
    if (used + dimensions.height > pageHeight + 0.5 && (currentItems().length || (block.answer && page.columns.some(items => items.length)))) {
      advance(block.answer);
      heading = true;
      dimensions = size();
    }
    // Preserve the required writing area when a long question needs a continuation.
    if (used + dimensions.height > pageHeight + 0.5 && page.header && headerHeight > 0 && block.contentHeight + (heading ? block.headingHeight : 0) > pageHeight - used) {
      newPage(block.answer);
      heading = true;
      dimensions = size();
    }
    const promptHeight = block.contentHeight + (heading ? block.headingHeight : 0);
    const blank = block.answer ? Math.min(dimensions.blank, Math.max(0, pageHeight - used - promptHeight)) : 0;
    currentItems().push({ index, heading, blank });
    used += promptHeight + blank + (block.answer ? 0 : gap);
    if (!page.answers) columnHeights[column] = used;
    previousSection = block.sectionId;
    let remainingBlank = Math.max(0, dimensions.blank - blank);
    while (remainingBlank > 0.5) {
      newPage(true);
      const part = Math.min(remainingBlank, pageHeight - 28);
      page.columns[0].push({ index, heading: false, blank: part, continuation: true });
      used = part + 28;
      previousSection = block.sectionId;
      remainingBlank -= part;
    }
  });
  return pages;
}
