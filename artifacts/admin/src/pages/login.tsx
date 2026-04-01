import { useState } from "react";
import { useLocation } from "wouter";
import { ShoppingBag, Lock, ArrowRight, Loader2 } from "lucide-react";
import { useAdminLogin } from "@/hooks/use-admin";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login() {
  const [secret, setSecret] = useState("");
  const [, setLocation] = useLocation();
  const login = useAdminLogin();
  const { toast } = useToast();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;

    login.mutate(secret, {
      onSuccess: (data) => {
        if (data.success && data.token) {
          localStorage.setItem("ajkmart_admin_token", data.token);
          toast({ title: "Welcome back", description: "Successfully logged into admin panel." });
          setLocation("/dashboard");
        }
      },
      onError: (err) => {
        toast({ 
          title: "Access Denied", 
          description: err.message, 
          variant: "destructive" 
        });
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/login-bg.png`} 
          alt="Background" 
          className="w-full h-full object-cover opacity-40 mix-blend-overlay"
        />
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-400/20 blur-[120px]" />
      </div>

      <div className="w-full max-w-md p-6 sm:p-8 z-10">
        <div className="bg-card rounded-3xl p-8 sm:p-10 shadow-2xl shadow-black/5 border border-border/50 animate-in zoom-in-95 duration-500">
          <div className="flex flex-col items-center text-center mb-10">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-primary/30">
              <ShoppingBag className="w-8 h-8 text-white" />
            </div>
            <h1 className="font-display text-3xl font-bold text-foreground">AJKMart Admin</h1>
            <p className="text-muted-foreground mt-2 font-medium">Enter your secret key to access</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground ml-1">Admin Secret</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-muted-foreground" />
                </div>
                <Input
                  type="password"
                  placeholder="Enter secret key..."
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  className="pl-11 h-14 rounded-xl border-2 bg-background/50 focus:bg-background transition-colors text-lg"
                  autoComplete="current-password"
                  autoFocus
                />
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={login.isPending || !secret.trim()}
              className="w-full h-14 rounded-xl text-base font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 transition-all"
            >
              {login.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Access Dashboard
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
          </form>
        </div>
        
        <p className="text-center text-sm text-muted-foreground mt-8">
          AJKMart Admin © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
