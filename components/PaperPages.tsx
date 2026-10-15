"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { paginatePaper, type PaperPageItem, type PaperPageLayout } from "../lib/paper-pagination";

export type PaperBlock = {
  id: string;
  number: string;
  sectionId: string;
  heading: ReactNode;
  content: ReactNode;
  answer: boolean;
  minimumBlank: number;
};

export function PaperPages({ className, variables, header, binding, blocks, footerText, showPageNumber, columns }: {
  className: string;
  variables: CSSProperties;
  header: ReactNode;
  binding: ReactNode;
  blocks: PaperBlock[];
  footerText: string;
  showPageNumber: boolean;
  columns: number;
}) {
  const measureRef = useRef<HTMLElement>(null);
  const [pages, setPages] = useState<PaperPageLayout[]>([]);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    let active = true;
    let frame = 0;
    const measure = () => {
      if (!active) return;
      const body = root.querySelector<HTMLElement>(".paper-page-body")!;
      const headerElement = root.querySelector<HTMLElement>(".paper-measure-header")!;
      const styles = getComputedStyle(root);
      const gap = parseFloat(getComputedStyle(root.querySelector(".paper-measure-gap")!).height);
      const available = parseFloat(styles.minHeight) - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom) - (footerText || showPageNumber ? 32 : 0);
      const measurements = Array.from(body.querySelectorAll<HTMLElement>(".paper-measure-block")).map((element, index) => ({
        sectionId: blocks[index].sectionId,
        contentHeight: element.querySelector<HTMLElement>(".paper-question-content")!.offsetHeight,
        headingHeight: element.querySelector<HTMLElement>(".paper-heading-wrap")!.offsetHeight,
        answer: blocks[index].answer,
        minimumBlank: blocks[index].minimumBlank,
      }));
      setPages(paginatePaper(measurements, available, headerElement.offsetHeight, gap, columns));
      setReady(true);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root.querySelectorAll(".paper-question-content, .paper-heading-wrap, .paper-measure-header").forEach(element => observer.observe(element));
    const images = Array.from(root.querySelectorAll("img"));
    images.forEach(img => { img.addEventListener("load", schedule); img.addEventListener("error", schedule); });
    void document.fonts.ready.then(schedule);
    // Measure synchronously for print snapshots; font/image changes trigger another pass.
    measure();
    window.addEventListener("beforeprint", measure);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      images.forEach(img => { img.removeEventListener("load", schedule); img.removeEventListener("error", schedule); });
      window.removeEventListener("beforeprint", measure);
    };
  }, [blocks, columns, footerText, header, showPageNumber, variables]);

  const footer = (page: number) => (footerText || showPageNumber) && <footer><span>{footerText}</span>{showPageNumber && <b>第 {page} 页</b>}</footer>;
  const renderItem = (item: PaperPageItem, position: number) => {
    const block = blocks[item.index];
    if (!block) return null;
    return <section key={`${block.id}-${position}`} className={`paper-question${block.answer ? " paper-answer-question" : ""}`} data-question-id={block.id} data-continuation={item.continuation || undefined}>
      {item.heading && <div className="paper-heading-wrap">{block.heading}</div>}
      {item.continuation ? <div className="paper-answer-continuation">第 {block.number} 题作答区（续）</div> : <div className="paper-question-content">{block.content}</div>}
      {block.answer && <div className="answer-space" aria-label={`第 ${block.number} 题作答留白`} style={{ height: item.blank }} />}
    </section>;
  };
  return <>
    <article ref={measureRef} className={`paper-sheet ${className} paper-measure`} style={variables} aria-hidden="true" inert>
      <div className="paper-page-body">
        <div className="paper-measure-header">{header}</div>
        <div className="paper-measure-gap" />
        {blocks.map(block => <div className="paper-measure-block" key={block.id} style={{ width: block.answer || columns === 1 ? "100%" : "calc((100% - 10mm) / 2)" }}>
          <div className="paper-heading-wrap">{block.heading}</div>
          <div className="paper-question-content">{block.content}</div>
        </div>)}
      </div>
    </article>
    <div className="printable-paper" data-pagination-ready={ready ? "true" : "false"}>
      {pages.map((page, pageIndex) => <article key={pageIndex} className={`paper-sheet paper-paginated ${className}`} style={variables}>
        {binding}
        <div className="paper-page-body">
          {page.header && <div className="paper-page-header">{header}</div>}
          <div className="paper-page-columns" style={{ gridTemplateColumns: `repeat(${page.columns.length}, minmax(0, 1fr))` }}>
            {page.columns.map((items, column) => <div key={column}>{items.map(renderItem)}</div>)}
          </div>
          {page.answers && <div className="paper-page-answers">{page.answers.map(renderItem)}</div>}
        </div>
        {footer(pageIndex + 1)}
      </article>)}
    </div>
  </>;
}
