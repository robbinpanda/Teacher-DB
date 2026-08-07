export function resolveExtractionPage(rawPage: unknown, availablePages: number[], fallbackPage: number) {
  const page = Number(rawPage ?? fallbackPage);
  if (availablePages.includes(page)) return page;

  // 部分视觉模型会把随请求发送的图片编号成 1、2，而不是使用原卷真实页码。
  // 只有在该编号不是实际页码、且能明确映射到本次图片序号时才纠正。
  if (Number.isInteger(page) && page >= 1 && page <= availablePages.length) {
    return availablePages[page - 1];
  }
  return page;
}

export function selectPrimaryExtractionRegion<T extends { page: number }>(regions: T[], currentPage: number) {
  return regions.find((region) => region.page === currentPage) ?? regions[0];
}
