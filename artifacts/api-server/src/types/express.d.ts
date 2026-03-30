import type { InferSelectModel } from "drizzle-orm";
import type { ridesTable } from "@workspace/db/schema";

declare global {
  namespace Express {
    interface Request {
      customerId?: string;
      customerPhone?: string;
      customerUser?: Record<string, unknown>;
      vendorId?: string;
      vendorUser?: Record<string, unknown>;
      riderId?: string;
      riderUser?: Record<string, unknown>;
      adminId?: string;
      adminRole?: string;
      adminName?: string;
      adminIp?: string;
      ride?: InferSelectModel<typeof ridesTable>;
    }
  }
}
