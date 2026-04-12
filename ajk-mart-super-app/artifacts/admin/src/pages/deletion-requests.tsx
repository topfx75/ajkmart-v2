import { useState } from "react";
import { useDeletionRequests, useApproveDeletion, useDenyDeletion } from "@/hooks/use-admin";
import { formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, Search, CheckCircle2, XCircle, AlertTriangle, User, Clock, Loader2 } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 border-yellow-300",
  approved: "bg-green-100 text-green-700 border-green-300",
  denied: "bg-red-100 text-red-700 border-red-300",
};

export default function DeletionRequests() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [denyNote, setDenyNote] = useState("");
  const [showDenyForm, setShowDenyForm] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);

  const { data, isLoading } = useDeletionRequests(statusFilter);
  const approveMutation = useApproveDeletion();
  const denyMutation = useDenyDeletion();

  const requests = (data?.requests ?? []).filter((r: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (r.userName || "").toLowerCase().includes(q) ||
      (r.userPhone || "").includes(q) ||
      (r.userEmail || "").toLowerCase().includes(q) ||
      (r.reason || "").toLowerCase().includes(q);
  });

  const pendingCount = data?.requests?.filter((r: any) => r.status === "pending").length ?? 0;

  const handleApprove = () => {
    if (!selected) return;
    approveMutation.mutate({ id: selected.id }, {
      onSuccess: () => {
        toast({ title: "Account deleted successfully" });
        setSelected(null);
        setShowApproveConfirm(false);
      },
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  const handleDeny = () => {
    if (!selected || !denyNote.trim()) return;
    denyMutation.mutate({ id: selected.id, note: denyNote.trim() }, {
      onSuccess: () => {
        toast({ title: "Request denied — user notified" });
        setSelected(null);
        setShowDenyForm(false);
        setDenyNote("");
      },
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 sm:w-12 sm:h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center shrink-0">
            <Trash2 className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Deletion Requests</h1>
            <p className="text-muted-foreground text-xs sm:text-sm">Review and process account deletion requests</p>
          </div>
        </div>
        {pendingCount > 0 && (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300 text-sm px-3 py-1">
            <Clock className="w-3.5 h-3.5 mr-1" /> {pendingCount} pending
          </Badge>
        )}
      </div>

      <Card className="p-3 sm:p-4 rounded-2xl border-border/50 shadow-sm flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, email, or reason..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-10 rounded-xl bg-muted/30 border-border/50 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { key: "pending", label: "Pending", cls: "border-yellow-300 text-yellow-700 bg-yellow-50" },
            { key: "all", label: "All", cls: "border-border/50 text-muted-foreground" },
            { key: "approved", label: "Approved", cls: "border-green-300 text-green-700 bg-green-50" },
            { key: "denied", label: "Denied", cls: "border-red-300 text-red-600 bg-red-50" },
          ].map(({ key, label, cls }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                statusFilter === key ? "bg-primary text-white border-primary" : `bg-muted/30 ${cls}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">User</TableHead>
                <TableHead className="font-semibold">Reason</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold text-right">Requested</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : requests.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No deletion requests found.</TableCell></TableRow>
              ) : (
                requests.map((r: any) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                          <User className="w-3.5 h-3.5 text-red-600" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{r.userName || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{r.userPhone || r.userEmail || "No contact"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <p className="text-sm truncate">{r.reason || "No reason provided"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] font-bold uppercase ${STATUS_STYLES[r.status] || ""}`}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "pending" && (
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setSelected(r); setShowApproveConfirm(true); setShowDenyForm(false); }}
                            className="h-7 text-xs text-green-600 hover:text-green-700"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setSelected(r); setShowDenyForm(true); setShowApproveConfirm(false); }}
                            className="h-7 text-xs text-red-600 hover:text-red-700"
                          >
                            <XCircle className="w-3 h-3 mr-1" /> Deny
                          </Button>
                        </div>
                      )}
                      {r.status !== "pending" && r.adminNote && (
                        <p className="text-xs text-muted-foreground italic truncate max-w-[150px]">{r.adminNote}</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={showApproveConfirm && !!selected} onOpenChange={open => { if (!open) { setShowApproveConfirm(false); setSelected(null); } }}>
        <DialogContent className="w-[95vw] max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Confirm Account Deletion
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                <p className="text-sm font-bold text-red-700">This action is irreversible!</p>
                <p className="text-xs text-red-600">
                  User <strong>{selected.userName || selected.userPhone}</strong> will be permanently deleted.
                  All personal data will be scrambled and sessions revoked.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setShowApproveConfirm(false); setSelected(null); }}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleApprove}
                  disabled={approveMutation.isPending}
                >
                  {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
                  Delete Account
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDenyForm && !!selected} onOpenChange={open => { if (!open) { setShowDenyForm(false); setSelected(null); setDenyNote(""); } }}>
        <DialogContent className="w-[95vw] max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-500" /> Deny Deletion Request
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Denying the request for <strong>{selected.userName || selected.userPhone}</strong>.
                The user will be notified with your reason.
              </p>
              <Textarea
                placeholder="Reason for denial (required)..."
                value={denyNote}
                onChange={e => setDenyNote(e.target.value)}
                rows={3}
                className="rounded-xl"
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setShowDenyForm(false); setSelected(null); setDenyNote(""); }}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleDeny}
                  disabled={denyMutation.isPending || !denyNote.trim()}
                >
                  {denyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Deny Request
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
