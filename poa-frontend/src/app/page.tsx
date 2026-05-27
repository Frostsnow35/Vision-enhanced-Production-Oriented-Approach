"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        GlimpSay：AI实景英语交际学习平台
      </h1>

      <p className="mt-3 text-lg font-medium text-muted-foreground">
        看见真实场景，开口自然发生。
      </p>

      <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
        GlimpSay 将你身边的校园、餐厅、商店、街角变成英语交际课堂。
        只需拍下眼前场景，AI 就能识别语境、生成任务，并与你展开真实对话练习；
        对话结束后，系统从语言准确性、表达流畅度、语用得体性等七个维度诊断表现，
        精准指出短板，推送少量但有效的输入与练习。
        随后，你将在同一场景中完成新的交际任务，用二次表达看见自己的真实进步。
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
