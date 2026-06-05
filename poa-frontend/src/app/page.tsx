"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-8 flex items-center gap-4">
        <Image
          src="/logo.png"
          alt="POA Logo"
          width={240}
          height={240}
          className="w-60 h-60"
          priority
        />
      </div>

      <h1 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl animate-float gradient-text">
        GlimpSay：AI实景英语交际学习平台
      </h1>

      <p className="mt-3 text-lg font-bold text-primary">
        看见真实场景，开口自然发生。
      </p>

      <div className="mt-6 max-w-xl">
        <p className="text-base leading-relaxed text-muted-foreground">
          GlimpSay 将你身边的校园、餐厅、商店、街角变成英语交际课堂。
          只需拍下眼前场景，AI 就能识别语境、生成任务，并与你展开真实对话练习；
        </p>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-primary p-4 text-center shadow-lg shadow-primary/30">
            <div className="text-3xl font-bold text-primary-foreground">7</div>
            <div className="text-sm text-primary-foreground/90">维度评估</div>
          </div>
          <div className="rounded-xl bg-accent p-4 text-center shadow-lg shadow-accent/30">
            <div className="text-3xl font-bold text-accent-foreground">AI</div>
            <div className="text-sm text-accent-foreground/90">实时诊断</div>
          </div>
          <div className="rounded-xl bg-primary p-4 text-center shadow-lg shadow-primary/30">
            <div className="text-3xl font-bold text-primary-foreground">∞</div>
            <div className="text-sm text-primary-foreground/90">迭代练习</div>
          </div>
        </div>
      </div>

      <Button
        className="mt-10 shadow-lg shadow-primary/30"
        variant="default"
        size="lg"
        onClick={() => {
          const keepKeys = ["poa_scenarios", "currentScenarioId"];
          for (const key of Object.keys(localStorage)) {
            if (!keepKeys.includes(key) && !key.startsWith("NEXT_")) {
              localStorage.removeItem(key);
            }
          }
          router.push("/scenario");
        }}
      >
        开始体验
      </Button>
    </div>
  );
}
