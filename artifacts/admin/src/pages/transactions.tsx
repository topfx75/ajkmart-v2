import { useState } from "react";
import { useTransactions } from "@/hooks/use-admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt, TrendingUp, TrendingDown, DollarSign, Search, RefreshCw, User, Download, CalendarDays } from "lucide-react";
import { useLanguage } from "@/lib/useLanguage";
import { tDual, type TranslationKey } from "@workspace/i18n";

function exportTxnCSV(txns: any[]) {
  const header = "ID,User,Phone,Type,Amount,Description,Date";
  const rows = txns.map((t: any) =>
    [t.id, t.userName || "", t.userPhone || "", t.type, t.amount, (t.description || "").replace(/,/g, ";"), t.createdAt?.slice(0,10) || ""].join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `transactions-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

export default function Transactions() {
  const { language } = useLanguage();
  const T = (key: TranslationKey) => tDual(key, language);
  const { data, isLoading, refetch, isFetching } = useTransactions();
  const [search, setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");

  const transactions = data?.transactions || [];
  const filtered = transactions.filter((t: any) => {
    const q = search.toLowerCase();
    const matchSearch =
      (t.description || "").toLowerCase().includes(q) ||
      (t.userName || "").toLowerCase().includes(q) ||
      (t.userPhone || "").includes(q) ||
      t.userId.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q);
    const matchType = typeFilter === "all" || t.type === typeFilter;
    const matchDate = (!dateFrom || new Date(t.createdAt) >= new Date(dateFrom))
                   && (!dateTo   || new Date(t.createdAt) <= new Date(dateTo + "T23:59:59"));
    return matchSearch && matchType && matchDate;
  });

  const filteredCredits = filtered.filter((t: any) => t.type === "credit").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const filteredDebits  = filtered.filter((t: any) => t.type === "debit").reduce((s: number, t: any) => s + Number(t.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-sky-100 text-sky-600 rounded-xl flex items-center justify-center">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">{T("walletTransactions")}</h1>
            <p className="text-muted-foreground text-sm">{T("walletTxnSubtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportTxnCSV(filtered)} className="h-9 rounded-xl gap-2 self-start sm:self-auto">
            <Download className="w-4 h-4" /> {T("csvExport")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9 rounded-xl gap-2 self-start sm:self-auto">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} /> {T("refresh")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-2xl border-none bg-gradient-to-br from-primary to-blue-700 text-white shadow-lg">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-white/80 text-xs font-medium">{T("totalTransactions")}</p>
              <p className="text-xl font-bold">{transactions.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-green-200 bg-green-50 shadow-sm">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-green-700/80 text-xs font-medium">{T("totalCredits")}</p>
              <p className="text-xl font-bold text-green-700">{formatCurrency(data?.totalCredit || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-red-200 bg-red-50 shadow-sm">
          <CardContent className="p-5 flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
              <TrendingDown className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-red-700/80 text-xs font-medium">{T("totalDebits")}</p>
              <p className="text-xl font-bold text-red-700">{formatCurrency(data?.totalDebit || 0)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter-scoped summary row */}
      {(dateFrom || dateTo || typeFilter !== "all" || search) && (
        <div className="flex items-center gap-4 p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm">
          <span className="font-semibold text-sky-800">Filtered summary:</span>
          <span className="text-sky-700">{filtered.length} txns</span>
          <span className="text-green-700 font-bold">+{formatCurrency(filteredCredits)}</span>
          <span className="text-red-700 font-bold">−{formatCurrency(filteredDebits)}</span>
          <span className="text-sky-700 font-bold">Net: {formatCurrency(filteredCredits - filteredDebits)}</span>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4 rounded-2xl border-border/50 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by user name, phone, or description..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-11 rounded-xl bg-muted/30 border-border/50"
            />
          </div>
          <div className="flex gap-2">
            {[
              { value: "all", label: T("allTypes") },
              { value: "credit", label: `▲ ${T("creditLabel")}` },
              { value: "debit", label: `▼ ${T("debitLabel")}` }
            ].map(t => (
              <button
                key={t.value}
                onClick={() => setTypeFilter(t.value)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${
                  typeFilter === t.value
                    ? t.value === "credit" ? "bg-green-600 text-white border-green-600"
                    : t.value === "debit" ? "bg-red-600 text-white border-red-600"
                    : "bg-primary text-white border-primary"
                    : "bg-muted/30 border-border/50 text-muted-foreground hover:border-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 rounded-xl bg-muted/30 text-xs w-32" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="h-9 rounded-xl bg-muted/30 text-xs w-32" />
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-primary hover:underline">{T("clearFilter")}</button>}
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[580px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{T("txnId")}</TableHead>
                <TableHead>{T("user")}</TableHead>
                <TableHead>{T("description")}</TableHead>
                <TableHead>{T("type")}</TableHead>
                <TableHead className="text-right">{T("amount")}</TableHead>
                <TableHead className="text-right">{T("date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">{T("loading")}</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">{T("noTransactions")}</TableCell></TableRow>
              ) : (
                filtered.map((t: any) => (
                  <TableRow key={t.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {t.id.slice(-8).toUpperCase()}
                    </TableCell>
                    <TableCell>
                      {t.userName ? (
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-sky-600" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{t.userName}</p>
                            <p className="text-xs text-muted-foreground">{t.userPhone}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">{t.userId.slice(-6).toUpperCase()}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate text-sm">{t.description}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={t.type === 'credit'
                          ? 'bg-green-50 text-green-700 border-green-200 uppercase text-[10px] font-bold'
                          : 'bg-red-50 text-red-700 border-red-200 uppercase text-[10px] font-bold'
                        }
                      >
                        {t.type === 'credit' ? `▲ ${T("creditLabel")}` : `▼ ${T("debitLabel")}`}
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
