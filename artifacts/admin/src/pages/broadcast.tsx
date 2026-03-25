import { useState } from "react";
import { Megaphone, Send, Bell } from "lucide-react";
import { useBroadcast } from "@/hooks/use-admin";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Broadcast() {
  const broadcastMutation = useBroadcast();
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    title: "",
    body: "",
    type: "system",
    icon: "notifications-outline"
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.body) return;
    
    broadcastMutation.mutate(formData, {
      onSuccess: (data) => {
        toast({ title: "Broadcast Sent!", description: `Sent to ${data.sent} active users.` });
        setFormData({ title: "", body: "", type: "system", icon: "notifications-outline" });
      },
      onError: (err) => {
        toast({ title: "Failed to send", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center">
          <Megaphone className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Broadcast</h1>
          <p className="text-muted-foreground text-sm">Send push notifications to all users</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="rounded-3xl border-border/50 shadow-lg shadow-black/5">
          <CardContent className="p-6 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground">Notification Title</label>
                <Input 
                  required 
                  placeholder="e.g., Flash Sale is Live!" 
                  value={formData.title} 
                  onChange={e => setFormData({...formData, title: e.target.value})} 
                  className="h-12 rounded-xl text-base bg-muted/30 focus:bg-background"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-bold text-foreground">Message Body</label>
                <Textarea 
                  required 
                  placeholder="Type your message here..." 
                  value={formData.body} 
                  onChange={e => setFormData({...formData, body: e.target.value})} 
                  className="min-h-[120px] rounded-xl text-base bg-muted/30 focus:bg-background resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">Type</label>
                  <Select value={formData.type} onValueChange={v => setFormData({...formData, type: v})}>
                    <SelectTrigger className="h-12 rounded-xl bg-muted/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System</SelectItem>
                      <SelectItem value="promotional">Promotional</SelectItem>
                      <SelectItem value="alert">Alert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-bold text-foreground">Icon</label>
                  <Select value={formData.icon} onValueChange={v => setFormData({...formData, icon: v})}>
                    <SelectTrigger className="h-12 rounded-xl bg-muted/30">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="notifications-outline">Default Bell</SelectItem>
                      <SelectItem value="gift-outline">Gift Box</SelectItem>
                      <SelectItem value="warning-outline">Warning</SelectItem>
                      <SelectItem value="megaphone-outline">Megaphone</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button 
                type="submit" 
                disabled={broadcastMutation.isPending || !formData.title || !formData.body} 
                className="w-full h-14 rounded-xl text-base font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all mt-4"
              >
                {broadcastMutation.isPending ? "Sending..." : "Send to All Users"}
                {!broadcastMutation.isPending && <Send className="w-5 h-5 ml-2" />}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Live Preview */}
        <div>
          <h3 className="text-lg font-bold mb-4 ml-1">Live Preview</h3>
          <div className="w-full max-w-[340px] h-[650px] bg-gray-900 rounded-[3rem] p-4 shadow-2xl relative mx-auto border-8 border-gray-800 flex flex-col overflow-hidden">
            {/* Phone Notch */}
            <div className="absolute top-0 inset-x-0 h-6 w-32 bg-gray-800 rounded-b-3xl mx-auto z-20"></div>
            
            {/* Phone Screen */}
            <div className="flex-1 bg-gray-50 rounded-[2rem] overflow-hidden pt-12 p-4 relative">
              {/* Notification Banner */}
              <div className="w-full bg-white rounded-2xl p-4 shadow-xl border border-gray-100 animate-in slide-in-from-top-4 fade-in duration-500 flex gap-3 relative overflow-hidden">
                {formData.type === 'promotional' && (
                  <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                )}
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bell className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">
                    {formData.title || "Notification Title"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                    {formData.body || "This is how your message will appear to users on their mobile devices."}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-2 font-medium">just now • AJKMart</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
