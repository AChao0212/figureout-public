import { Suspense } from "react";
import FiguresSearch from "./FiguresSearch";

export default function FiguresPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-8 text-center text-gray-400">搜尋中...</div>}>
      <FiguresSearch />
    </Suspense>
  );
}
