"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        视觉语言模型赋能POA英语实景交际闭环
      </h1>

      <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
        POA（产出导向法）英语学习闭环，融合视觉语言模型技术，
        通过场景驱动、任务引导、初次产出、促成学习、二次产出、评价与报告七个环节，
        构建沉浸式英语实景交际学习体验，助力学习者实现语言能力的螺旋式提升。
      </p>

      <Button
        className="mt-10"
        size="lg"
        onClick={() => router.push("/scenario")}
      >
        开始体验
      </Button>
    </div>
  );
}
