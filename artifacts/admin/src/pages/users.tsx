import { useState } from "react";
import { Search, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import { useUsers, useUpdateUser } from "@/hooks/use-admin";
import { formatCurrency, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Users() {
  const { data, isLoading } = useUsers();
  const updateMutation = useUpdateUser();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const handleUpdate = (id: string, updates: any) => {
    updateMutation.mutate({ id, ...updates }, {
      onSuccess: () => {
        toast({ title: "User updated successfully" });
      },
      onError: (err) => {
        toast({ title: "Update failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const users = data?.users || [];
  const filtered = users.filter((u: any) => {
    const matchesSearch = 
      (u.name?.toLowerCase() || "").includes(search.toLowerCase()) || 
      (u.phone || "").includes(search);
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-display font-bold text-foreground">Users</h1>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="px-3 py-1.5 text-sm font-semibold">
            {filtered.length} Users
          </Badge>
        </div>
      </div>

      <Card className="p-4 rounded-2xl border-border/50 shadow-sm flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or phone..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl bg-muted/30 border-border/50"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-11 rounded-xl bg-muted/30 border-border/50">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="rider">Rider</SelectItem>
              <SelectItem value="vendor">Vendor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="rounded-2xl border-border/50 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">User Info</TableHead>
                <TableHead className="font-semibold">Phone</TableHead>
                <TableHead className="font-semibold">Role</TableHead>
                <TableHead className="font-semibold text-right">Wallet</TableHead>
                <TableHead className="font-semibold text-center">Status</TableHead>
                <TableHead className="font-semibold text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No users found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((user: any) => (
                  <TableRow key={user.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                          {(user.name || "U")[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{user.name || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground font-mono">{user.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{user.phone}</TableCell>
                    <TableCell>
                      <Select 
                        value={user.role} 
                        onValueChange={(val) => handleUpdate(user.id, { role: val })}
                      >
                        <SelectTrigger className="w-28 h-8 text-xs font-semibold uppercase tracking-wider">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customer">Customer</SelectItem>
                          <SelectItem value="rider">Rider</SelectItem>
                          <SelectItem value="vendor">Vendor</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right font-bold text-foreground">
                      {formatCurrency(user.walletBalance)}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Switch 
                          checked={user.isActive} 
                          onCheckedChange={(val) => handleUpdate(user.id, { isActive: val })}
                        />
                        {user.isActive ? 
                          <CheckCircle2 className="w-4 h-4 text-green-500" /> : 
                          <XCircle className="w-4 h-4 text-red-500" />
                        }
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
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
