interface ReportPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportPage({ params }: ReportPageProps) {
  const { id } = await params;

  return (
    <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight text-card-foreground">
        学习报告
      </h1>
      <p className="mt-2 text-muted-foreground">报告 ID：{id}</p>
      <p className="text-muted-foreground">综合各环节表现，生成个性化学习报告与改进建议。</p>
    </div>
  );
}
