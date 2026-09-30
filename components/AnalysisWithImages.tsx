import Image from "next/image";
import type { ReactNode } from "react";
import type { QuestionAsset } from "../lib/types";
import { analysisImageParts } from "../lib/analysis-images";
import { MathText } from "./MathText";

export function AnalysisWithImages({ text, assets, renderAsset }: {
  text: string; assets: QuestionAsset[]; renderAsset?: (asset: QuestionAsset) => ReactNode;
}) {
  const images = assets.filter(a => a.role === "answer");
  return <div className="analysis-with-images">{analysisImageParts(text, images.length).map((part, index) => {
    if ("text" in part) return part.text ? <MathText key={index} text={part.text} /> : null;
    const asset = images[part.image];
    return <div key={index} className="analysis-inline-image">{renderAsset ? renderAsset(asset) : asset.url
      ? <figure><Image src={asset.url} width={asset.width ?? 720} height={asset.height ?? 480} alt={asset.label || "解析配图"} unoptimized style={{ maxWidth: "100%", height: "auto" }} /><figcaption>{asset.label}</figcaption></figure>
      : <span>解析配图待补充：{asset.label}</span>}</div>;
  })}</div>;
}
