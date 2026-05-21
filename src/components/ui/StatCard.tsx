import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

type StatCardProps = {
  label: string;
  value: string;
  detail: string;
  className?: string;
};

export function StatCard({ className, detail, label, value }: StatCardProps) {
  return (
    <Card className={cn("p-5 shadow-sm", className)}>
      <Badge tone="neutral">{label}</Badge>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-700">{detail}</p>
    </Card>
  );
}
