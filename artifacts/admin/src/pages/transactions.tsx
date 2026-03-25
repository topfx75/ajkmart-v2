import { useTransactions } from "@/hooks/use-admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt } from "lucide-react";

export default function Transactions() {
  const { data, isLoading } = useTransactions();
  const transactions = data?.transactions || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-sky-100 text-sky-600 rounded-xl flex items-center justify-center">
          <Receipt className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Wallet Transactions</h1>
          <p className="text-muted-foreground text-sm">History of all digital wallet movements</p>
        </div>
      </div>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Transaction ID</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : transactions.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No transactions found.</TableCell></TableRow>
              ) : (
                transactions.map((t: any) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {t.id.slice(-8).toUpperCase()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.userId.slice(-6).toUpperCase()}</TableCell>
                    <TableCell className="font-medium">{t.description}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={t.type === 'credit' ? 'bg-green-50 text-green-700 border-green-200 uppercase text-[10px]' : 'bg-red-50 text-red-700 border-red-200 uppercase text-[10px]'}>
                        {t.type}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-bold ${t.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                      {t.type === 'credit' ? '+' : '-'}{formatCurrency(t.amount)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(t.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
